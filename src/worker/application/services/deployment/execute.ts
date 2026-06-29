/**
 * Deployment execution orchestrator.
 *
 * Implements the multi-step deployment pipeline: deploy workload, update routing,
 * and handle failure rollback. Extracted from DeploymentService
 * to keep the main service file focused on coordination.
 */
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import type { Deployment, DeploymentEnv, DeploymentEvent } from "./models.ts";
import {
  createDeploymentBackend,
  type DeploymentBackend,
  parseDeploymentBackendConfig,
} from "./backend.ts";
import type { DeploymentBackendQueueConsumerSyncInput } from "./backend-contracts.ts";
import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import {
  claimDeploymentForExecution,
  getDeploymentById,
  getDeploymentCancellationRequestedAt,
  getDeploymentEvents,
  getDeploymentServiceId,
  getServiceDeploymentBasics,
  logDeploymentEvent,
  updateDeploymentRecord,
} from "./store.ts";
import { executeDeploymentStep } from "./state.ts";
import {
  applyRoutingDbUpdates,
  applyRoutingToHostnames,
  buildRoutingTarget,
  collectHostnames,
  fetchServiceWithDomains,
  restoreRoutingSnapshot,
  type RoutingSnapshot,
  runRoutingMutationWithRollback,
  snapshotRouting,
} from "./routing.ts";
import { rollbackDeploymentSteps } from "./rollback.ts";
import { deployments, getDb, services } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { CF_COMPATIBILITY_DATE } from "../../../shared/constants/index.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  AppError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import {
  buildWorkersRuntime,
  extractErrorMessage,
  parseRuntimeConfig,
  resolveDeploymentArtifactRef,
} from "./artifact-refs.ts";
import {
  decryptBindings,
  getBundleContent,
  getEnvVars,
  getWasmContent,
  verifyBundleIntegrity,
} from "./artifact-io.ts";
import {
  buildProbeUrl,
  DEFAULT_READINESS_PATH,
  describeReadinessFailure,
  probeWorkerReadiness,
} from "./readiness-probe.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  combineSignals,
  throwIfAborted,
} from "@takos/worker-platform-utils/abort";

/**
 * Default signal used when callers do not pass one. Never aborts — keeps
 * existing call sites behavior-preserving. Lazily created: workerd disallows
 * constructing AbortController in module global scope (I/O-context-bound),
 * so eager init fails Cloudflare upload validation.
 */
let neverAbortSignal: AbortSignal | undefined;
function getNeverAbortSignal(): AbortSignal {
  neverAbortSignal ??= new AbortController().signal;
  return neverAbortSignal;
}

/**
 * Interval between DB polls for the `cancellation_requested_at` flag, in ms.
 *
 * 15 s is the documented worst-case delivery latency between the cancel
 * route writing the flag and a pipeline running in a different isolate
 * observing it at its next phase boundary. The poll is a single indexed
 * SELECT per deployment per interval, so the DB cost is negligible.
 *
 * This is best-effort: usually under 30 s end-to-end, but not a contractual
 * guarantee. See the cancel route docstring for the consistency contract.
 */
const CANCELLATION_POLL_INTERVAL_MS = 15_000;

function deploymentCancelledMessage(context: string): string {
  return `deployment-cancelled (${context})`;
}

type CancellationPoller = {
  /** Combined signal: union of the external signal and the DB-poll signal. */
  signal: AbortSignal;
  /** Stop the background poll loop. Safe to call multiple times. */
  stop: () => void;
};

/**
 * Start a background poller that aborts an internal controller when the
 * DB-backed `cancellation_requested_at` flag becomes non-null. The returned
 * signal is the union of the external signal (in-process registry) and the
 * poll-driven signal (DB-backed), via `combineSignals`.
 *
 * The poll uses a single indexed SELECT and short-circuits as soon as it
 * observes a non-null timestamp. Cross-isolate cancellation is honored
 * within ~`CANCELLATION_POLL_INTERVAL_MS` of the cancel route writing the
 * flag — best effort, not contractual.
 */
function startCancellationPoller(
  env: DeploymentEnv,
  deploymentId: string,
  externalSignal: AbortSignal,
  intervalMs: number = CANCELLATION_POLL_INTERVAL_MS,
): CancellationPoller {
  const dbController = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      void poll();
    }, intervalMs);
  };

  const poll = async (): Promise<void> => {
    if (stopped) return;
    try {
      const requestedAt = await getDeploymentCancellationRequestedAt(
        env.DB,
        deploymentId,
      );
      if (stopped) return;
      if (requestedAt != null) {
        dbController.abort(
          new AppError(
            deploymentCancelledMessage(
              `deployment-pipeline:db-poll:${deploymentId}`,
            ),
          ),
        );
        stop();
        return;
      }
    } catch (error) {
      // Transient DB errors during polling must not fail the deploy. Log
      // and continue — the next poll attempt retries.
      logWarn("Cancellation poller observed a transient error", {
        module: "deployment",
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    scheduleNext();
  };

  scheduleNext();
  const signal = combineSignals(externalSignal, dbController.signal);
  return { signal, stop };
}

function mergeRuntimeEnvVars(
  envVars: Record<string, string>,
  bindings: WorkerBinding[],
): Record<string, string> {
  const merged = { ...envVars };
  for (const binding of bindings) {
    if (binding.type === "plain_text" || binding.type === "secret_text") {
      merged[binding.name] = binding.text ?? "";
    }
  }
  return merged;
}

export function resolveCompletedStepNames(
  events: DeploymentEvent[],
): string[] {
  const completed = new Set<string>();
  for (const event of events) {
    if (!event.step_name) continue;
    if (event.event_type === "step_completed") {
      completed.add(event.step_name);
      continue;
    }
    if (event.event_type === "rollback_step") {
      completed.delete(event.step_name);
    }
  }
  return [...completed];
}

export function resolveCandidateBaseUrlFromBackendState(
  backendStateJson: string | null | undefined,
): string | null {
  const backendState = safeJsonParseOrDefault<Record<string, unknown>>(
    backendStateJson ?? "{}",
    {},
  );
  const endpoint = backendState.resolved_endpoint;
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    return null;
  }
  const baseUrl = (endpoint as Record<string, unknown>).base_url;
  return typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : null;
}

type QueueConsumerSyncPlan = {
  syncInput: DeploymentBackendQueueConsumerSyncInput;
  rollbackInput: DeploymentBackendQueueConsumerSyncInput;
};

async function buildQueueConsumerSyncPlan(input: {
  env: DeploymentEnv;
  encryptionKey: string;
  deployment: Deployment;
  deployArtifactRef: string;
  activeDeploymentId: string | null;
}): Promise<QueueConsumerSyncPlan> {
  const runtimeConfig = parseRuntimeConfig(
    input.deployment.runtime_config_snapshot_json,
  );
  const bindings = input.deployment.bindings_snapshot_encrypted
    ? await decryptBindings(input.encryptionKey, input.deployment)
    : [];
  const previousDeployment = input.activeDeploymentId &&
      input.activeDeploymentId !== input.deployment.id
    ? await getDeploymentById(input.env.DB, input.activeDeploymentId)
    : null;
  const previousBindings = previousDeployment?.bindings_snapshot_encrypted
    ? await decryptBindings(input.encryptionKey, previousDeployment)
    : [];
  const previousRuntimeConfig = previousDeployment
    ? parseRuntimeConfig(previousDeployment.runtime_config_snapshot_json)
    : null;
  const currentRuntime = buildWorkersRuntime(runtimeConfig, bindings);
  const previousRuntime = previousRuntimeConfig
    ? buildWorkersRuntime(previousRuntimeConfig, previousBindings)
    : null;

  return {
    syncInput: {
      deployment: input.deployment,
      artifactRef: input.deployArtifactRef,
      runtime: currentRuntime,
      previousDeployment,
      previousArtifactRef: previousDeployment?.artifact_ref ?? null,
      previousRuntime,
    },
    rollbackInput: previousDeployment?.artifact_ref
      ? {
        deployment: previousDeployment,
        artifactRef: previousDeployment.artifact_ref,
        runtime: previousRuntime ?? {
          profile: "workers",
          bindings: previousBindings,
        },
        previousDeployment: input.deployment,
        previousArtifactRef: input.deployArtifactRef,
        previousRuntime: currentRuntime,
      }
      : {
        deployment: { ...input.deployment, target_json: "{}" } as Deployment,
        artifactRef: input.deployArtifactRef,
        runtime: {
          profile: "workers",
          bindings: [],
        },
        previousDeployment: input.deployment,
        previousArtifactRef: input.deployArtifactRef,
        previousRuntime: currentRuntime,
      },
  };
}

/**
 * Execute a deployment through all pipeline steps (deploy_worker, update_routing, finalize).
 *
 * This is the core orchestration extracted from DeploymentService.executeDeployment.
 */
export async function executeDeploymentPipeline(
  env: DeploymentEnv,
  encryptionKey: string,
  deploymentId: string,
  signal: AbortSignal = getNeverAbortSignal(),
): Promise<Deployment> {
  // Phase boundary: lock — check cancellation before any work.
  throwIfAborted(signal, `deployment-pipeline:lock:${deploymentId}`);

  const deployment = await getDeploymentById(env.DB, deploymentId);

  if (!deployment) {
    throw new NotFoundError(`Deployment ${deploymentId}`);
  }

  if (deployment.status === "success" || deployment.status === "rolled_back") {
    return deployment;
  }

  // Phase boundary: preflight — after loading, before state transition.
  const preflightContext = `deployment-pipeline:preflight:${deploymentId}`;
  throwIfAborted(signal, preflightContext);
  if (deployment.cancellation_requested_at != null) {
    const message = deploymentCancelledMessage(preflightContext);
    const now = new Date().toISOString();
    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: "failed",
      status: "failed",
      stepError: message,
      cancellationRequestedAt: null,
      updatedAt: now,
    });
    await logDeploymentEvent(
      env.DB,
      deploymentId,
      "failed",
      deployment.current_step,
      message,
    ).catch((error: unknown) => {
      logError("Failed to log deployment cancellation", error, {
        module: "deployment",
      });
    });
    throw new AppError(message);
  }

  // Atomically claim the deployment before doing any work. This is the choke
  // point that makes execution idempotent against an Idempotency-Key replay or a
  // duplicate queue dispatch: only one runner can transition pending/failed ->
  // in_progress, so a second concurrent invocation for the same deploymentId
  // exits here instead of re-running the provider deploy and routing swap.
  const claimed = await claimDeploymentForExecution(env.DB, deploymentId);
  if (!claimed) {
    return (await getDeploymentById(env.DB, deploymentId)) ?? deployment;
  }

  const completedStepNames = resolveCompletedStepNames(
    await getDeploymentEvents(env.DB, deploymentId),
  );
  const deploymentServiceId = getDeploymentServiceId(deployment);

  // Start the cross-isolate cancellation poller now that we have committed
  // to running the pipeline. `pipelineSignal` is the union of the
  // caller-provided in-process signal and a DB-driven signal that fires
  // within ~`CANCELLATION_POLL_INTERVAL_MS` of the cancel route writing
  // `cancellation_requested_at`. Phase boundaries below use this combined
  // signal via the synchronous `throwIfAborted` helper.
  const poller = startCancellationPoller(env, deploymentId, signal);
  const pipelineSignal = poller.signal;

  let workerHostname: string | null = null;
  let deploymentArtifactRef: string | null = null;
  let routingRollbackSnapshot: RoutingSnapshot | null = null;
  let candidateBaseUrl: string | null = null;
  let queueConsumerRollbackBackend: DeploymentBackend | null = null;
  let queueConsumerRollbackInput:
    | DeploymentBackendQueueConsumerSyncInput
    | null = null;
  let queueConsumersSynced = false;

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
      target: parseDeploymentBackendConfig(deployment),
      persistedArtifactRef: deployment.artifact_ref,
    });

    const deployArtifactRef = deploymentArtifactRef;
    const backend = createDeploymentBackend(deployment, {
      cloudflareEnv: env,
      orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
      orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
    });
    queueConsumerRollbackBackend = backend;

    if (!deployArtifactRef) {
      throw new InternalError("Deployment artifact ref is missing");
    }

    const isContainerDeploy = deployment.artifact_kind === "container-image";

    // Phase boundary: prepare — backend and artifact ref resolved, about to
    // call provider.
    throwIfAborted(
      pipelineSignal,
      `deployment-pipeline:prepare:${deploymentId}`,
    );

    if (!completedStepNames.includes("deploy_worker")) {
      // Phase boundary: pre-commit — about to invoke provider deploy. Note
      // that the provider call itself (backend.deploy) may not honor
      // cancellation mid-call — see module docs on per-provider behavior.
      throwIfAborted(
        pipelineSignal,
        `deployment-pipeline:pre-commit:deploy_worker:${deploymentId}`,
      );
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

          const bindings = deployment.bindings_snapshot_encrypted
            ? await decryptBindings(encryptionKey, deployment)
            : [];
          const envVars = await getEnvVars(encryptionKey, deployment);
          const deployResult = await backend.deploy({
            deployment,
            artifactRef: deployArtifactRef,
            bundleContent,
            wasmContent,
            runtime: {
              profile: isContainerDeploy ? "container-service" : "workers",
              bindings: isContainerDeploy ? [] : bindings,
              envVars: isContainerDeploy
                ? mergeRuntimeEnvVars(envVars, bindings)
                : envVars,
              config: {
                compatibility_date: compatibilityDate,
                compatibility_flags: compatibilityFlags,
                limits: runtimeConfig.limits,
              },
            },
            // Thread the combined pipeline signal into the provider call so
            // drivers can propagate in-process or DB-polled cancellation into
            // their fetch/RPC. Drivers without an outgoing call still honor a
            // pre-aborted signal; see `DeploymentBackendDeployInput.signal`.
            signal: pipelineSignal,
          });

          // Store resolved endpoint from container backend in backend_state_json
          if (deployResult?.resolvedEndpoint) {
            candidateBaseUrl = deployResult.resolvedEndpoint.base_url;
            const backendState = safeJsonParseOrDefault<
              Record<string, unknown>
            >(
              deployment.backend_state_json,
              {},
            );
            backendState.resolved_endpoint = deployResult.resolvedEndpoint;
            if (deployResult.logsRef) {
              backendState.logs_ref = deployResult.logsRef;
            }
            await updateDeploymentRecord(env.DB, deploymentId, {
              backendStateJson: JSON.stringify(backendState),
            });
            // Update in-memory deployment for routing step
            deployment.backend_state_json = JSON.stringify(backendState);
          }
        },
      );
      completedStepNames.push("deploy_worker");
    }

    // -----------------------------------------------------------------------
    // Workload readiness probe
    //
    // Readiness contract (canonical: readiness-probe.ts). Note this probe only
    // runs when the backend returns a resolvable endpoint; WfP-managed worker
    // deploys return none and the probe is skipped (see the skip branch below):
    //   - kernel が deploy 時に workload に対して GET <readiness path> を probe する
    //   - default path は `/`、manifest の `compute.<name>.readiness` で override 可
    //   - **HTTP 200 OK のみ** を ready とみなす
    //   - 201/204/3xx (redirect)/4xx/5xx は fail
    //   - timeout は hard-coded で 10 秒
    //   - 失敗したら deploy fail-fast (workload は起動扱いされず、routing は更新されない)
    //
    // Service / Container は manifest の `healthCheck` field を使うため、ここでは
    // skip する。bundle workload (`isContainerDeploy === false`) のみで実行する。
    // -----------------------------------------------------------------------
    // Phase boundary: post-commit (provider deploy returned, readiness next).
    throwIfAborted(
      pipelineSignal,
      `deployment-pipeline:post-commit:${deploymentId}`,
    );

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
          const deploymentTarget = parseDeploymentBackendConfig(deployment);
          const readinessPath = deploymentTarget.readiness?.path ??
            DEFAULT_READINESS_PATH;

          // Workload readiness must probe the candidate deployment, not the
          // currently routed hostname. If the backend cannot expose a candidate
          // URL (e.g. WFP-managed workers), skip the probe instead of checking
          // the existing route.
          candidateBaseUrl ??= resolveCandidateBaseUrlFromBackendState(
            deployment.backend_state_json,
          );
          if (!candidateBaseUrl) {
            logWarn(
              "Skipping worker readiness probe: candidate URL unavailable",
              {
                module: "deployment",
                deploymentId,
              },
            );
            return;
          }

          const baseUrl = candidateBaseUrl.startsWith("http://") ||
              candidateBaseUrl.startsWith("https://")
            ? candidateBaseUrl
            : `https://${candidateBaseUrl}`;
          const probeUrl = buildProbeUrl(baseUrl, readinessPath);

          const outcome = await probeWorkerReadiness({
            baseUrl,
            path: readinessPath,
            externalSignal: pipelineSignal,
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

    const shouldSyncQueueConsumers = !isContainerDeploy &&
      !!backend.syncQueueConsumers &&
      deployment.routing_status !== "canary";
    const queueConsumerSyncPlan = shouldSyncQueueConsumers
      ? await buildQueueConsumerSyncPlan({
        env,
        encryptionKey,
        deployment,
        deployArtifactRef,
        activeDeploymentId: serviceBasics.activeDeploymentId,
      })
      : null;
    if (queueConsumerSyncPlan) {
      queueConsumerRollbackInput = queueConsumerSyncPlan.rollbackInput;
      queueConsumersSynced = completedStepNames.includes(
        "sync_queue_consumers",
      );
    }

    if (
      queueConsumerSyncPlan &&
      backend.syncQueueConsumers &&
      !completedStepNames.includes("sync_queue_consumers")
    ) {
      throwIfAborted(
        pipelineSignal,
        `deployment-pipeline:pre-commit:sync_queue_consumers:${deploymentId}`,
      );
      await executeDeploymentStep(
        env.DB,
        deploymentId,
        "setting_bindings",
        "sync_queue_consumers",
        async () => {
          await backend.syncQueueConsumers?.({
            ...queueConsumerSyncPlan.syncInput,
            signal: pipelineSignal,
          });
          queueConsumersSynced = true;
        },
      );
      completedStepNames.push("sync_queue_consumers");
    }

    if (!completedStepNames.includes("update_routing")) {
      // Phase boundary: commit — about to swap routing. After this point we
      // intentionally stop checking the signal: a routing swap is a single
      // atomic-ish DB mutation that must either complete or get rolled back
      // via the catch handler.
      throwIfAborted(
        pipelineSignal,
        `deployment-pipeline:commit:update_routing:${deploymentId}`,
      );
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

          routingRollbackSnapshot = hostnameList.length > 0
            ? await snapshotRouting(env, hostnameList)
            : [];

          if (
            env.WORKER_BUNDLES &&
            routingRollbackSnapshot &&
            routingRollbackSnapshot.length > 0
          ) {
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
          let deploymentTarget = parseDeploymentBackendConfig(deployment);
          if (isContainerDeploy) {
            const backendState = safeJsonParseOrDefault<
              Record<string, unknown>
            >(
              deployment.backend_state_json,
              {},
            );
            const resolvedEp = backendState.resolved_endpoint as {
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

          await runRoutingMutationWithRollback(
            env,
            routingRollbackSnapshot,
            () => applyRoutingToHostnames(env, hostnameList, target),
            {
              module: "deployment",
              message:
                "Failed to restore routing snapshot during deployment routing update (non-critical)",
            },
          );

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

    // Phase boundary: finalize — routing committed, marking success. Once we
    // reach this point we deliberately do not honor cancellation: rolling
    // back a committed routing swap is more disruptive than letting the
    // cleanup complete.
    const finishedAt = new Date().toISOString();
    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: "completed",
      status: "success",
      completedAt: finishedAt,
      cancellationRequestedAt: null,
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

    if (
      queueConsumersSynced &&
      queueConsumerRollbackBackend?.syncQueueConsumers &&
      queueConsumerRollbackInput
    ) {
      await queueConsumerRollbackBackend.syncQueueConsumers(
        queueConsumerRollbackInput,
      ).catch(async (queueRollbackError: unknown) => {
        logError(
          "Failed to restore queue consumers after deployment failure",
          queueRollbackError,
          { module: "deployment" },
        );
        await logDeploymentEvent(
          env.DB,
          deploymentId,
          "rollback_failed",
          "sync_queue_consumers",
          `Failed to restore queue consumers: ${
            extractErrorMessage(queueRollbackError)
          }`,
        ).catch((logErrorEvent) => {
          logError(
            "Failed to log queue consumer rollback failure",
            logErrorEvent,
            { module: "deployment" },
          );
        });
      });
    }

    await rollbackDeploymentSteps({
      env,
      deploymentId,
      deployment,
      completedStepNames,
      routingRollbackSnapshot,
      workerHostname,
      deploymentArtifactRef,
      backend: createDeploymentBackend(deployment, {
        cloudflareEnv: env,
        orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
        orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
      }),
    });

    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: "failed",
      status: "failed",
      stepError: errorMessage,
      cancellationRequestedAt: null,
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
  } finally {
    poller.stop();
  }
}
