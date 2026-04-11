/**
 * Deployment execution orchestrator.
 *
 * Implements the multi-step deployment pipeline: deploy worker, update routing,
 * and handle failure rollback. Extracted from DeploymentService
 * to keep the main service file focused on coordination.
 */
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import type { ServiceRuntimeConfigState } from "../platform/worker-desired-state.ts";
import type { Deployment, DeploymentEnv } from "./models.ts";
import {
  createDeploymentProvider,
  parseDeploymentTargetConfig,
} from "./provider.ts";
import {
  createDeploymentProviderRegistry,
  resolveDeploymentProviderConfigsFromEnv,
} from "../../../platform/deployment-providers.ts";
import {
  getDeploymentById,
  getDeploymentEvents,
  getDeploymentServiceId,
  getServiceDeploymentBasics,
  logDeploymentEvent,
  updateDeploymentRecord,
} from "./store.ts";
import { executeDeploymentStep, updateDeploymentState } from "./state.ts";
import {
  applyRoutingDbUpdates,
  applyRoutingToHostnames,
  buildRoutingTarget,
  collectHostnames,
  fetchServiceWithDomains,
  restoreRoutingSnapshot,
  type RoutingSnapshot,
  snapshotRouting,
} from "./routing.ts";
import { rollbackDeploymentSteps } from "./rollback.ts";
import { deployments, getDb, services } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { CF_COMPATIBILITY_DATE } from "../../../shared/constants/index.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { InternalError, NotFoundError } from "takos-common/errors";
import {
  extractErrorMessage,
  parseRuntimeConfig,
  resolveDeploymentArtifactRef,
} from "./artifact-refs.ts";
import {
  decryptBindings,
  getBundleContent,
  getWasmContent,
  verifyBundleIntegrity,
} from "./artifact-io.ts";
import {
  buildProbeUrl,
  DEFAULT_READINESS_PATH,
  describeReadinessFailure,
  probeWorkerReadiness,
} from "./readiness-probe.ts";

/**
 * Execute a deployment through all pipeline steps (deploy_worker, update_routing, finalize).
 *
 * This is the core orchestration extracted from DeploymentService.executeDeployment.
 */
export async function executeDeploymentPipeline(
  env: DeploymentEnv,
  encryptionKey: string,
  deploymentId: string,
): Promise<Deployment> {
  const deployment = await getDeploymentById(env.DB, deploymentId);

  if (!deployment) {
    throw new NotFoundError(`Deployment ${deploymentId}`);
  }

  if (deployment.status === "success" || deployment.status === "rolled_back") {
    return deployment;
  }

  const completedStepNames = (await getDeploymentEvents(env.DB, deploymentId))
    .filter((event) => event.event_type === "step_completed" && event.step_name)
    .map((event) => event.step_name as string);

  await updateDeploymentState(
    env.DB,
    deploymentId,
    "in_progress",
    deployment.deploy_state,
  );
  const deploymentServiceId = getDeploymentServiceId(deployment);

  let workerHostname: string | null = null;
  let deploymentArtifactRef: string | null = null;
  let routingRollbackSnapshot: RoutingSnapshot | null = null;

  try {
    const serviceBasics = await getServiceDeploymentBasics(
      env.DB,
      deploymentServiceId,
    );
    if (!serviceBasics.exists) {
      throw new NotFoundError("Worker");
    }

    workerHostname = serviceBasics.hostname;
    deploymentArtifactRef = resolveDeploymentArtifactRef({
      serviceId: deploymentServiceId,
      version: deployment.version,
      target: parseDeploymentTargetConfig(deployment),
      persistedArtifactRef: deployment.artifact_ref,
    });

    const deployArtifactRef = deploymentArtifactRef;
    const providerRegistry = createDeploymentProviderRegistry(
      resolveDeploymentProviderConfigsFromEnv(
        env as unknown as Record<string, unknown>,
      ),
    );
    const provider = createDeploymentProvider(deployment, {
      cloudflareEnv: env,
      orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
      orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
      providerRegistry,
    });

    if (!deployArtifactRef) {
      throw new InternalError("Deployment artifact ref is missing");
    }

    const isContainerDeploy = deployment.artifact_kind === "container-image";

    if (!completedStepNames.includes("deploy_worker")) {
      await executeDeploymentStep(
        env.DB,
        deploymentId,
        "deploying_worker",
        "deploy_worker",
        async () => {
          let bundleContent: string | undefined;
          let wasmContent: ArrayBuffer | null = null;

          if (!isContainerDeploy) {
            bundleContent = await getBundleContent(env, deployment);
            await verifyBundleIntegrity(bundleContent, deployment);
            wasmContent = deployment.wasm_r2_key
              ? await getWasmContent(env, deployment)
              : null;
          }

          const runtimeConfig = parseRuntimeConfig(
            deployment.runtime_config_snapshot_json,
          );
          const compatibilityDate = runtimeConfig.compatibility_date ||
            CF_COMPATIBILITY_DATE;
          const compatibilityFlags =
            runtimeConfig.compatibility_flags.length > 0
              ? runtimeConfig.compatibility_flags
              : wasmContent
              ? ["nodejs_compat"]
              : [];

          const bindings =
            (!isContainerDeploy && deployment.bindings_snapshot_encrypted)
              ? await decryptBindings(encryptionKey, deployment)
              : [];
          const deployResult = await provider.deploy({
            deployment,
            artifactRef: deployArtifactRef,
            bundleContent,
            wasmContent,
            runtime: {
              profile: isContainerDeploy ? "container-service" : "workers",
              bindings,
              config: {
                compatibility_date: compatibilityDate,
                compatibility_flags: compatibilityFlags,
                limits: runtimeConfig.limits,
              },
            },
          });

          // Store resolved endpoint from container provider in provider_state_json
          if (deployResult?.resolvedEndpoint) {
            const providerState = safeJsonParseOrDefault<
              Record<string, unknown>
            >(
              deployment.provider_state_json,
              {},
            );
            providerState.resolved_endpoint = deployResult.resolvedEndpoint;
            if (deployResult.logsRef) {
              providerState.logs_ref = deployResult.logsRef;
            }
            await updateDeploymentRecord(env.DB, deploymentId, {
              providerStateJson: JSON.stringify(providerState),
            });
            // Update in-memory deployment for routing step
            deployment.provider_state_json = JSON.stringify(providerState);
          }
        },
      );
      completedStepNames.push("deploy_worker");
    }

    // -----------------------------------------------------------------------
    // Worker readiness probe
    //
    // spec (`docs/apps/manifest.md` / `docs/apps/workers.md` /
    // `docs/architecture/control-plane.md` の "Worker readiness"):
    //   - kernel が deploy 時に Worker に対して GET <readiness path> を probe する
    //   - default path は `/`、manifest の `compute.<name>.readiness` で override 可
    //   - **HTTP 200 OK のみ** を ready とみなす
    //   - 201/204/3xx (redirect)/4xx/5xx は fail
    //   - timeout は hard-coded で 10 秒
    //   - 失敗したら deploy fail-fast (worker は起動扱いされず、routing は更新されない)
    //
    // Service / Container は manifest の `healthCheck` field を使うため、ここでは
    // skip する。Worker (`isContainerDeploy === false`) のみで実行する。
    // -----------------------------------------------------------------------
    if (
      !isContainerDeploy &&
      !completedStepNames.includes("probe_readiness")
    ) {
      await executeDeploymentStep(
        env.DB,
        deploymentId,
        "deploying_worker",
        "probe_readiness",
        async () => {
          const deploymentTarget = parseDeploymentTargetConfig(deployment);
          const readinessPath = deploymentTarget.readiness?.path ??
            DEFAULT_READINESS_PATH;

          // Probe URL の base を resolve する。
          // - worker deploys: services.hostname (例: my-app.takos.app)
          // - container providers: ここでは到達しない (isContainerDeploy guard 済み)
          if (!workerHostname) {
            // hostname 未割り当ての worker (まだ routing が無い空 deploy など) は
            // probe を skip する。kernel-managed worker (api / dispatch / docs) で
            // hostname が常に存在するケースでは到達しない。
            return;
          }

          const baseUrl = workerHostname.startsWith("http://") ||
              workerHostname.startsWith("https://")
            ? workerHostname
            : `https://${workerHostname}`;
          const probeUrl = buildProbeUrl(baseUrl, readinessPath);

          const outcome = await probeWorkerReadiness({
            baseUrl,
            path: readinessPath,
          });

          if (!outcome.ok) {
            // fail-fast: throw して executeDeploymentStep の catch に rollback を委ねる。
            // 上位 catch は rollbackDeploymentSteps を呼び、routing は更新されない。
            throw new InternalError(
              describeReadinessFailure(probeUrl, outcome),
            );
          }
        },
      );
      completedStepNames.push("probe_readiness");
    }

    if (!completedStepNames.includes("update_routing")) {
      await executeDeploymentStep(
        env.DB,
        deploymentId,
        "routing",
        "update_routing",
        async () => {
          const db = getDb(env.DB);

          const serviceRouteRecord = await fetchServiceWithDomains(
            env,
            deploymentServiceId,
          );

          if (!serviceRouteRecord) {
            throw new NotFoundError("Worker");
          }

          const hostnameList = collectHostnames(serviceRouteRecord);

          if (hostnameList.length === 0) {
            return;
          }

          routingRollbackSnapshot = await snapshotRouting(env, hostnameList);

          if (env.WORKER_BUNDLES && routingRollbackSnapshot) {
            const snapshotKey = `deployment-snapshots/${deploymentId}.json`;
            await env.WORKER_BUNDLES.put(
              snapshotKey,
              JSON.stringify(routingRollbackSnapshot),
            );
          }

          const nowIso = new Date().toISOString();
          const promoteToActive = deployment.routing_status !== "canary";

          let activeDeployment = null;
          if (!promoteToActive && serviceRouteRecord.activeDeploymentId) {
            activeDeployment = await db.select({
              id: deployments.id,
              artifactRef: deployments.artifactRef,
              targetJson: deployments.targetJson,
              routingStatus: deployments.routingStatus,
            })
              .from(deployments)
              .where(eq(deployments.id, serviceRouteRecord.activeDeploymentId))
              .get() ?? null;
          }

          // For container deploys, inject the resolved endpoint as the routing target
          let deploymentTarget = parseDeploymentTargetConfig(deployment);
          if (isContainerDeploy) {
            const providerState = safeJsonParseOrDefault<
              Record<string, unknown>
            >(
              deployment.provider_state_json,
              {},
            );
            const resolvedEp = providerState.resolved_endpoint as {
              base_url?: string;
            } | undefined;
            if (resolvedEp?.base_url) {
              deploymentTarget = {
                ...deploymentTarget,
                endpoint: { kind: "http-url", base_url: resolvedEp.base_url },
              };
            }
          }

          const routingCtx = {
            deploymentId,
            deploymentVersion: deployment.version,
            deployArtifactRef,
            deploymentTarget,
            serviceRouteRecord,
            desiredRoutingStatus: deployment.routing_status,
            desiredRoutingWeight: deployment.routing_weight,
            activeDeployment,
          };

          const { target, auditDetails } = buildRoutingTarget(
            routingCtx,
            hostnameList,
          );

          await applyRoutingToHostnames(env, hostnameList, target);

          try {
            await applyRoutingDbUpdates(env, routingCtx, nowIso);
          } catch (dbErr) {
            if (routingRollbackSnapshot) {
              await restoreRoutingSnapshot(env, routingRollbackSnapshot).catch(
                (e) => {
                  logError(
                    "Failed to restore routing snapshot during rollback",
                    e,
                    { module: "deployment" },
                  );
                },
              );
            }
            throw dbErr;
          }

          await logDeploymentEvent(
            env.DB,
            deploymentId,
            "routing_updated",
            "update_routing",
            promoteToActive
              ? "Promoted deployment to active routing"
              : "Configured canary routing",
            {
              actorAccountId: deployment.deployed_by ?? null,
              details: auditDetails,
            },
          );
        },
      );
      completedStepNames.push("update_routing");
    }

    const finishedAt = new Date().toISOString();
    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: "completed",
      status: "success",
      completedAt: finishedAt,
      updatedAt: finishedAt,
    });
    try {
      const db = getDb(env.DB);
      await db.update(services)
        .set({
          status: "deployed",
          updatedAt: finishedAt,
        })
        .where(eq(services.id, deploymentServiceId))
        .run();
    } catch (e) {
      logError(
        "Failed to update service status to deployed (non-critical)",
        e,
        { module: "deployment" },
      );
    }

    await logDeploymentEvent(
      env.DB,
      deploymentId,
      "completed",
      null,
      "Deployment completed successfully",
    );

    // Clean up routing snapshot after successful deployment
    if (env.WORKER_BUNDLES) {
      const snapshotKey = `deployment-snapshots/${deploymentId}.json`;
      await env.WORKER_BUNDLES.delete(snapshotKey).catch((e: unknown) => {
        logError("Failed to clean up deployment snapshot (non-critical)", e, {
          module: "deployment",
        });
      });
    }

    const finalDeployment = await getDeploymentById(env.DB, deploymentId);
    if (!finalDeployment) {
      throw new InternalError(
        `Deployment ${deploymentId} not found after successful completion`,
      );
    }
    return finalDeployment;
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    const now = new Date().toISOString();

    await rollbackDeploymentSteps({
      env,
      deploymentId,
      deployment,
      completedStepNames,
      routingRollbackSnapshot,
      workerHostname,
      deploymentArtifactRef,
      provider: createDeploymentProvider(deployment, {
        cloudflareEnv: env,
        orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
        orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
        providerRegistry: createDeploymentProviderRegistry(
          resolveDeploymentProviderConfigsFromEnv(
            env as unknown as Record<string, unknown>,
          ),
        ),
      }),
    });

    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: "failed",
      status: "failed",
      stepError: errorMessage,
      updatedAt: now,
    });
    const currentService = await getServiceDeploymentBasics(
      env.DB,
      deploymentServiceId,
    );
    if (!currentService.activeDeploymentId) {
      try {
        const db = getDb(env.DB);
        await db.update(services)
          .set({
            status: "failed",
            updatedAt: now,
          })
          .where(eq(services.id, deploymentServiceId))
          .run();
      } catch (e) {
        logError(
          "Failed to update service status to failed (non-critical)",
          e,
          { module: "deployment" },
        );
      }
    }

    await logDeploymentEvent(
      env.DB,
      deploymentId,
      "failed",
      deployment.current_step,
      errorMessage,
    );

    throw error;
  }
}
