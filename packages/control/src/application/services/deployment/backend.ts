import { WFPService } from "../../../platform/backends/cloudflare/wfp.ts";
import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { normalizeDeployRuntime } from "./backend-contracts.ts";
import type {
  DeploymentBackend,
  DeploymentBackendQueueConsumerSyncInput,
  PersistedDeploymentBackendContract,
} from "./backend-contracts.ts";
import type { Deployment } from "./models.ts";
import type { DeploymentTargetQueueConsumer } from "./models.ts";
import type {
  DeploymentBackendFactoryConfig,
  OciDeploymentOrchestratorConfig,
  OrchestratedDeploymentBackendConfig,
} from "./backend-registry.ts";
import { resolveDeploymentBackendFactory } from "./backend-registry.ts";
import {
  parseDeploymentBackendConfig,
  targetContainsContainerImage,
} from "./backend-targets.ts";

export type {
  DeploymentBackend,
  DeploymentBackendDeployInput,
  DeploymentBackendDeployResult,
  DeploymentBackendRuntimeInput,
  PersistedDeploymentBackendContract,
  WfpDeploymentBackendEnv,
} from "./backend-contracts.ts";
export {
  parseDeploymentBackendConfig,
  serializeDeploymentBackendTarget,
} from "./backend-targets.ts";

export function createWorkersDispatchDeploymentBackend(
  wfp: WFPService,
): DeploymentBackend {
  function resolveQueueConsumers(input: {
    artifactRef: string;
    deployment: Deployment;
    bindings: WorkerBinding[];
  }): Array<{
    queueName: string;
    input: {
      scriptName: string;
      deadLetterQueue?: string;
      settings?: DeploymentTargetQueueConsumer["settings"];
    };
  }> {
    const target = parseDeploymentBackendConfig(input.deployment);
    const consumers = target.queue_consumers ?? [];
    return consumers.map((consumer) => {
      const queueName = resolveQueueNameForConsumer(consumer, input.bindings);
      const deadLetterQueue = resolveDeadLetterQueueName(
        consumer.dead_letter_queue,
        input.bindings,
      );
      return {
        queueName,
        input: {
          scriptName: input.artifactRef,
          ...(deadLetterQueue ? { deadLetterQueue } : {}),
          ...(consumer.settings ? { settings: consumer.settings } : {}),
        },
      };
    });
  }

  async function syncQueueConsumers(
    input: DeploymentBackendQueueConsumerSyncInput,
  ): Promise<void> {
    const runtime = normalizeDeployRuntime({
      deployment: input.deployment,
      artifactRef: input.artifactRef,
      wasmContent: null,
      runtime: input.runtime,
    });
    const desired = resolveQueueConsumers({
      deployment: input.deployment,
      artifactRef: input.artifactRef,
      bindings: runtime.bindings,
    });

    const previousArtifactRef = input.previousArtifactRef?.trim() ||
      input.previousDeployment?.artifact_ref?.trim() || "";
    const previous = input.previousDeployment && previousArtifactRef
      ? resolveQueueConsumers({
        deployment: input.previousDeployment,
        artifactRef: previousArtifactRef,
        bindings: input.previousRuntime?.bindings ?? [],
      })
      : [];
    const previousByQueueName = new Map(
      previous.map((consumer) => [consumer.queueName, consumer]),
    );
    const previousQueueNames = new Set(previousByQueueName.keys());
    const desiredQueueNames = new Set(
      desired.map((consumer) => consumer.queueName),
    );
    const desiredByQueueName = new Map(
      desired.map((consumer) => [consumer.queueName, consumer]),
    );

    try {
      for (const consumer of desired) {
        const previousConsumer = previousByQueueName.get(consumer.queueName);
        await wfp.queues.upsertQueueConsumerByQueueName(consumer.queueName, {
          scriptName: consumer.input.scriptName,
          ...(previousConsumer
            ? { replaceScriptName: previousConsumer.input.scriptName }
            : {}),
          ...(consumer.input.deadLetterQueue
            ? { deadLetterQueue: consumer.input.deadLetterQueue }
            : {}),
          ...(consumer.input.settings
            ? { settings: consumer.input.settings }
            : {}),
        });
      }

      for (const consumer of previous) {
        if (desiredQueueNames.has(consumer.queueName)) {
          const desiredConsumer = desiredByQueueName.get(consumer.queueName);
          if (
            desiredConsumer &&
            desiredConsumer.input.scriptName !== consumer.input.scriptName
          ) {
            await wfp.queues.deleteQueueConsumerByQueueName(
              consumer.queueName,
              { scriptName: consumer.input.scriptName },
            );
          }
          continue;
        }
        await wfp.queues.deleteQueueConsumerByQueueName(consumer.queueName, {
          scriptName: previousArtifactRef,
        });
      }
    } catch (error) {
      await restorePreviousQueueConsumers({
        wfp,
        desired,
        previous,
        previousQueueNames,
      });
      throw error;
    }
  }

  return {
    name: "workers-dispatch",
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      const target = parseDeploymentBackendConfig(input.deployment);
      const cloudflareMetadata = target.cloudflare;
      if (input.wasmContent) {
        await wfp.workers.createWorkerWithWasm(
          input.artifactRef,
          input.bundleContent || "",
          input.wasmContent,
          {
            bindings: runtime.bindings as Array<{
              type: string;
              name: string;
              id?: string;
              bucket_name?: string;
              namespace_id?: string;
              text?: string;
            }>,
            compatibility_date: runtime.compatibilityDate,
            compatibility_flags: runtime.compatibilityFlags,
            limits: runtime.limits,
            containers: cloudflareMetadata?.containers,
            migrations: cloudflareMetadata?.migrations,
          },
        );
        return;
      }

      await wfp.workers.createWorker({
        workerName: input.artifactRef,
        workerScript: input.bundleContent || "",
        bindings: runtime.bindings,
        compatibility_date: runtime.compatibilityDate,
        compatibility_flags: runtime.compatibilityFlags,
        limits: runtime.limits,
        containers: cloudflareMetadata?.containers,
        migrations: cloudflareMetadata?.migrations,
      });
    },
    async assertRollbackTarget(artifactRef) {
      const exists = await wfp.workers.workerExists(artifactRef);
      if (!exists) {
        throw new Error(
          `Rollback target artifact not found in WFP: ${artifactRef}`,
        );
      }
    },
    async cleanupDeploymentArtifact(artifactRef: string) {
      await wfp.workers.deleteWorker(artifactRef);
    },
    syncQueueConsumers,
  };
}

async function restorePreviousQueueConsumers(input: {
  wfp: WFPService;
  desired: Array<{
    queueName: string;
    input: {
      scriptName: string;
      deadLetterQueue?: string;
      settings?: DeploymentTargetQueueConsumer["settings"];
    };
  }>;
  previous: Array<{
    queueName: string;
    input: {
      scriptName: string;
      deadLetterQueue?: string;
      settings?: DeploymentTargetQueueConsumer["settings"];
    };
  }>;
  previousQueueNames: Set<string>;
}): Promise<void> {
  const desiredByQueueName = new Map(
    input.desired.map((consumer) => [consumer.queueName, consumer]),
  );
  for (const consumer of input.previous) {
    const desiredConsumer = desiredByQueueName.get(consumer.queueName);
    await input.wfp.queues.upsertQueueConsumerByQueueName(consumer.queueName, {
      scriptName: consumer.input.scriptName,
      ...(desiredConsumer
        ? { replaceScriptName: desiredConsumer.input.scriptName }
        : {}),
      ...(consumer.input.deadLetterQueue
        ? { deadLetterQueue: consumer.input.deadLetterQueue }
        : {}),
      ...(consumer.input.settings ? { settings: consumer.input.settings } : {}),
    }).catch((restoreError: unknown) => {
      logWarn("Failed to restore previous Queue consumer after sync failure", {
        module: "deployment",
        queueName: consumer.queueName,
        error: restoreError instanceof Error
          ? restoreError.message
          : String(restoreError),
      });
    });
  }

  for (const consumer of input.desired) {
    if (input.previousQueueNames.has(consumer.queueName)) continue;
    await input.wfp.queues.deleteQueueConsumerByQueueName(consumer.queueName, {
      scriptName: consumer.input.scriptName,
    }).catch((deleteError: unknown) => {
      logWarn("Failed to delete new Queue consumer after sync failure", {
        module: "deployment",
        queueName: consumer.queueName,
        error: deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      });
    });
  }
}

function resolveQueueNameForConsumer(
  consumer: DeploymentTargetQueueConsumer,
  bindings: WorkerBinding[],
): string {
  if (consumer.queue) return consumer.queue;
  const bindingName = consumer.binding?.trim();
  const binding = bindings.find((entry) =>
    entry.type === "queue" && entry.name === bindingName
  );
  const queueName = binding?.queue_name?.trim();
  if (!queueName) {
    throw new Error(
      `Queue trigger binding "${bindingName}" does not resolve to a queue binding`,
    );
  }
  return queueName;
}

function resolveDeadLetterQueueName(
  value: string | undefined,
  bindings: WorkerBinding[],
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const binding = bindings.find((entry) =>
    entry.type === "queue" && entry.name === trimmed
  );
  return binding?.queue_name?.trim() || trimmed;
}

export function createRuntimeHostDeploymentBackend(): DeploymentBackend {
  return {
    name: "runtime-host",
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      if (runtime.profile !== "workers") {
        throw new Error(
          "runtime-host backend only supports workers runtime profiles",
        );
      }
      if (!input.bundleContent || input.bundleContent.trim().length === 0) {
        throw new Error("runtime-host deployment requires a worker bundle");
      }
      // runtime-host resolves active deployments lazily from DB + WORKER_BUNDLES.
      // Creating the deployment row and storing the bundle is sufficient here.
    },
    async assertRollbackTarget(_artifactRef) {
      // runtime-host loads rollback targets from Takos-managed deployment records.
    },
  };
}

export function createOciDeploymentBackend(
  deployment: Pick<Deployment, "backend_name" | "target_json" | "space_id">,
  config?: OciDeploymentOrchestratorConfig,
): DeploymentBackend {
  return createOrchestratedDeploymentBackend(deployment, {
    backendName: "oci",
    orchestratorUrl: config?.orchestratorUrl,
    orchestratorToken: config?.orchestratorToken,
    fetchImpl: config?.fetchImpl,
  });
}

function createOrchestratedDeploymentBackend(
  deployment: Pick<Deployment, "backend_name" | "target_json" | "space_id">,
  config: OrchestratedDeploymentBackendConfig,
): DeploymentBackend {
  const target = parseDeploymentBackendConfig(deployment);
  const fetchImpl = config.fetchImpl ?? fetch;
  const routeRef = target.endpoint?.kind === "service-ref"
    ? target.endpoint.ref.trim()
    : target.route_ref?.trim() ?? "";

  return {
    name: config.backendName,
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      const serviceRef = target.endpoint?.kind === "service-ref"
        ? target.endpoint.ref.trim()
        : target.route_ref?.trim() || input.artifactRef;
      if (!serviceRef) {
        throw new Error(
          "OCI deployment target requires route_ref or service-ref endpoint",
        );
      }

      const exposedPort = target.artifact?.exposed_port;
      if (
        exposedPort != null &&
        (!Number.isFinite(exposedPort) || exposedPort <= 0)
      ) {
        throw new Error(
          "OCI deployment target exposed_port must be a positive integer",
        );
      }

      const externalBaseUrl = target.endpoint?.kind === "http-url"
        ? target.endpoint.base_url
        : null;
      const orchestratorUrl = config.orchestratorUrl?.trim();
      const imageRef = target.artifact?.image_ref?.trim();
      const healthPath = target.artifact?.health_path?.trim() || "/health";
      const healthInterval = target.artifact?.health_interval;
      const healthTimeout = target.artifact?.health_timeout;
      const healthUnhealthyThreshold = target.artifact
        ?.health_unhealthy_threshold;

      if (!imageRef) {
        if (externalBaseUrl) {
          return {
            resolvedEndpoint: {
              kind: "http-url" as const,
              base_url: externalBaseUrl,
            },
          };
        }
        throw new Error(
          "OCI deployment target requires artifact.image_ref or endpoint.base_url",
        );
      }

      if (!orchestratorUrl) {
        throw new Error("OCI deployment target requires OCI_ORCHESTRATOR_URL");
      }

      const deployUrl = orchestratorUrl.endsWith("/")
        ? `${orchestratorUrl}deploy`
        : `${orchestratorUrl}/deploy`;

      const backendPayload =
        config.backendName === "oci" && !config.backendConfig ? undefined : {
          name: config.backendName,
          ...(config.backendConfig ? { config: config.backendConfig } : {}),
        };

      const response = await fetchImpl(deployUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.orchestratorToken
            ? { Authorization: `Bearer ${config.orchestratorToken}` }
            : {}),
        },
        body: JSON.stringify({
          deployment_id: input.deployment.id,
          space_id: input.deployment.space_id,
          artifact_ref: input.artifactRef,
          ...(backendPayload ? { backend: backendPayload } : {}),
          target: {
            route_ref: target.route_ref ?? serviceRef,
            endpoint: {
              kind: externalBaseUrl ? "http-url" : "service-ref",
              ...(externalBaseUrl
                ? { base_url: externalBaseUrl }
                : { ref: serviceRef }),
            },
            artifact: {
              image_ref: imageRef,
              exposed_port: exposedPort ?? undefined,
              health_path: healthPath,
              health_interval: healthInterval ?? undefined,
              health_timeout: healthTimeout ?? undefined,
              health_unhealthy_threshold: healthUnhealthyThreshold ??
                undefined,
            },
          },
          runtime: {
            profile: runtime.profile,
            compatibility_date: runtime.compatibilityDate,
            compatibility_flags: runtime.compatibilityFlags,
            limits: runtime.limits ?? null,
            env_vars: runtime.envVars,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch((err) => {
          logWarn("Failed to read error response body", {
            module: "oci-backend",
            error: err instanceof Error ? err.message : String(err),
          });
          return "";
        });
        throw new Error(
          `OCI deployment orchestrator failed with ${response.status}: ${
            body.slice(0, 300)
          }`,
        );
      }

      const responseBody = await response.json().catch((err) => {
        logWarn("Failed to parse deployment orchestrator JSON response", {
          module: "oci-backend",
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }) as {
        resolved_endpoint?: { kind: string; base_url: string };
        logs_ref?: string;
      } | null;

      if (responseBody?.resolved_endpoint?.base_url) {
        return {
          resolvedEndpoint: {
            kind: "http-url" as const,
            base_url: responseBody.resolved_endpoint.base_url,
          },
          logsRef: responseBody.logs_ref,
        };
      }
      return;
    },
    async assertRollbackTarget(_artifactRef) {
      // OCI rollback validity is external to Takos; routing can still point at the artifact ref.
    },
    async cleanupDeploymentArtifact(artifactRef: string) {
      const cleanupRouteRef = routeRef || artifactRef.trim();
      if (!cleanupRouteRef || !config.orchestratorUrl?.trim()) {
        return;
      }
      const removeUrl = config.orchestratorUrl.endsWith("/")
        ? `${config.orchestratorUrl}services/${
          encodeURIComponent(cleanupRouteRef)
        }/remove`
        : `${config.orchestratorUrl}/services/${
          encodeURIComponent(cleanupRouteRef)
        }/remove`;
      const response = await fetchImpl(
        `${removeUrl}?space_id=${encodeURIComponent(deployment.space_id)}`,
        {
          method: "POST",
          headers: {
            ...(config.orchestratorToken
              ? { Authorization: `Bearer ${config.orchestratorToken}` }
              : {}),
          },
        },
      );
      if (!response.ok && response.status !== 404) {
        const body = await response.text().catch((err) => {
          logWarn("Failed to read cleanup error response body", {
            module: "oci-backend",
            error: err instanceof Error ? err.message : String(err),
          });
          return "";
        });
        throw new Error(
          `OCI deployment cleanup failed with ${response.status}: ${
            body.slice(0, 300)
          }`,
        );
      }
    },
  };
}

export function createDeploymentBackend(
  deployment: Pick<Deployment, "backend_name" | "target_json" | "space_id">,
  config: DeploymentBackendFactoryConfig = {},
): DeploymentBackend {
  const deploymentTarget = parseDeploymentBackendConfig(deployment);
  const factory = resolveDeploymentBackendFactory(
    deployment.backend_name,
    targetContainsContainerImage(deploymentTarget),
    config,
  );

  switch (factory.kind) {
    case "orchestrated":
      return createOrchestratedDeploymentBackend(deployment, factory.config);
    case "workers-dispatch":
      return createWorkersDispatchDeploymentBackend(
        new WFPService(factory.cloudflareEnv),
      );
    case "runtime-host":
      return createRuntimeHostDeploymentBackend();
  }
}

export type PersistedDeploymentContract = PersistedDeploymentBackendContract;
