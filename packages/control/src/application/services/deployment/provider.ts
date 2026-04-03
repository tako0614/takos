import { WFPService } from "../../../platform/providers/cloudflare/wfp.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { normalizeDeployRuntime } from "./provider-contracts.ts";
import type {
  DeploymentProvider,
  PersistedDeploymentContract,
} from "./provider-contracts.ts";
import type {
  DeploymentProviderFactoryConfig,
  OciDeploymentOrchestratorConfig,
  OrchestratedDeploymentProviderConfig,
} from "./provider-registry.ts";
import { resolveDeploymentProviderFactory } from "./provider-registry.ts";
import {
  parseDeploymentTargetConfig,
  targetContainsContainerImage,
} from "./provider-targets.ts";

export type {
  DeploymentProvider,
  DeploymentProviderDeployInput,
  DeploymentProviderDeployResult,
  DeploymentProviderRuntimeInput,
  PersistedDeploymentContract,
  WfpDeploymentProviderEnv,
} from "./provider-contracts.ts";
export {
  parseDeploymentTargetConfig,
  serializeDeploymentTarget,
} from "./provider-targets.ts";

export function createWorkersDispatchDeploymentProvider(
  wfp: WFPService,
): DeploymentProvider {
  return {
    name: "workers-dispatch",
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
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
    async cleanupDeploymentArtifact(artifactRef) {
      await wfp.workers.deleteWorker(artifactRef);
    },
  };
}

export function createRuntimeHostDeploymentProvider(): DeploymentProvider {
  return {
    name: "runtime-host",
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      if (runtime.profile !== "workers") {
        throw new Error(
          "runtime-host provider only supports workers runtime profiles",
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

export function createOciDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config?: OciDeploymentOrchestratorConfig,
): DeploymentProvider {
  return createOrchestratedDeploymentProvider(deployment, {
    providerName: "oci",
    orchestratorUrl: config?.orchestratorUrl,
    orchestratorToken: config?.orchestratorToken,
    fetchImpl: config?.fetchImpl,
  });
}

function createOrchestratedDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config: OrchestratedDeploymentProviderConfig,
): DeploymentProvider {
  const target = parseDeploymentTargetConfig(deployment);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    name: config.providerName,
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

      const providerPayload =
        config.providerName === "oci" && !config.providerConfig ? undefined : {
          name: config.providerName,
          ...(config.providerConfig ? { config: config.providerConfig } : {}),
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
          ...(providerPayload ? { provider: providerPayload } : {}),
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
            },
          },
          runtime: {
            profile: runtime.profile,
            compatibility_date: runtime.compatibilityDate,
            compatibility_flags: runtime.compatibilityFlags,
            limits: runtime.limits ?? null,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch((err) => {
          logWarn("Failed to read error response body", {
            module: "oci-provider",
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
          module: "oci-provider",
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
  };
}

export function createDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config: DeploymentProviderFactoryConfig = {},
): DeploymentProvider {
  const deploymentTarget = parseDeploymentTargetConfig(deployment);
  const factory = resolveDeploymentProviderFactory(
    deployment.provider_name,
    targetContainsContainerImage(deploymentTarget),
    config,
  );

  switch (factory.kind) {
    case "orchestrated":
      return createOrchestratedDeploymentProvider(deployment, factory.config);
    case "workers-dispatch":
      return createWorkersDispatchDeploymentProvider(
        new WFPService(factory.cloudflareEnv),
      );
    case "runtime-host":
      return createRuntimeHostDeploymentProvider();
  }
}
