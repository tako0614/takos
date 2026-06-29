import { VECTORIZE_DEFAULT_DIMENSIONS } from "../../../shared/config/limits.ts";
import type { ResourceCapability } from "../../../shared/types/index.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { toResourceCapability } from "../../../application/services/resources/capabilities.ts";

// Multi-cloud materialization is operator-substrate scope owned by Takosumi
// runner policy, not the Takos worker. The worker resolves only the native
// `cloudflare` backend and the portable self-hosted `local` backend.
export const RESOURCE_BACKEND_VALUES = ["cloudflare", "local"] as const;

export type ResourceBackendName = (typeof RESOURCE_BACKEND_VALUES)[number];

function readEnvString(
  env: AuthenticatedRouteEnv["Bindings"],
  key: string,
): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function inferResourceBackend(
  env: AuthenticatedRouteEnv["Bindings"],
): ResourceBackendName {
  const configuredBackend = readEnvString(env, "TAKOS_RESOURCE_BACKEND");
  if (configuredBackend) {
    const normalized = normalizeResourceBackend(configuredBackend);
    if (!normalized) {
      throw new Error(
        `unsupported resource backend '${configuredBackend.toLowerCase()}'; expected cloudflare or local`,
      );
    }
    return normalized;
  }
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) return "cloudflare";
  return "local";
}

export function normalizeResourceBackend(
  backend: unknown,
): ResourceBackendName | undefined {
  if (backend === undefined || backend === null) {
    return undefined;
  }

  const backendName =
    typeof backend === "string" ? backend.trim().toLowerCase() : "";

  return RESOURCE_BACKEND_VALUES.includes(backendName as ResourceBackendName)
    ? (backendName as ResourceBackendName)
    : undefined;
}

export function resolveRequestedBackingResourceName(
  type: string,
  fallbackName: string,
  config?: Record<string, unknown>,
): string {
  const capability = toResourceCapability(type);
  if (capability === "analytics_store") {
    const analyticsConfig =
      asObject(config?.analyticsEngine) ?? asObject(config?.analyticsStore);
    const dataset =
      typeof analyticsConfig?.dataset === "string"
        ? analyticsConfig.dataset.trim()
        : "";
    if (dataset) return dataset;
  }
  return fallbackName;
}

export function buildProvisioningRequest(
  capability: ResourceCapability,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const queueConfig = asObject(config?.queue);
  const vectorConfig =
    asObject(config?.vectorize) ?? asObject(config?.vectorIndex);
  const analyticsConfig =
    asObject(config?.analyticsEngine) ?? asObject(config?.analyticsStore);
  const workflowConfig =
    asObject(config?.workflow) ?? asObject(config?.workflowRuntime);
  const durableConfig =
    asObject(config?.durableObject) ?? asObject(config?.durableNamespace);

  if (capability === "vector_index") {
    out.vectorIndex = {
      dimensions:
        typeof vectorConfig?.dimensions === "number"
          ? vectorConfig.dimensions
          : VECTORIZE_DEFAULT_DIMENSIONS,
      metric:
        typeof vectorConfig?.metric === "string"
          ? vectorConfig.metric
          : "cosine",
    };
  }

  if (
    capability === "queue" &&
    typeof queueConfig?.deliveryDelaySeconds === "number"
  ) {
    out.queue = { deliveryDelaySeconds: queueConfig.deliveryDelaySeconds };
  }

  if (
    capability === "analytics_store" &&
    typeof analyticsConfig?.dataset === "string" &&
    analyticsConfig.dataset.trim()
  ) {
    out.analyticsStore = { dataset: analyticsConfig.dataset.trim() };
  }

  if (
    capability === "workflow_runtime" &&
    typeof workflowConfig?.service === "string" &&
    typeof workflowConfig?.export === "string"
  ) {
    out.workflowRuntime = {
      service: workflowConfig.service,
      export: workflowConfig.export,
      ...(typeof workflowConfig.timeoutMs === "number"
        ? { timeoutMs: workflowConfig.timeoutMs }
        : {}),
      ...(typeof workflowConfig.maxRetries === "number"
        ? { maxRetries: workflowConfig.maxRetries }
        : {}),
    };
  }

  if (
    capability === "durable_namespace" &&
    typeof durableConfig?.className === "string"
  ) {
    out.durableNamespace = {
      className: durableConfig.className,
      ...(typeof durableConfig.scriptName === "string"
        ? { scriptName: durableConfig.scriptName }
        : {}),
    };
  }

  return out;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
