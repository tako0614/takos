import { VECTORIZE_DEFAULT_DIMENSIONS } from "../../../shared/config/limits.ts";
import type {
  ResourceCapability,
  ResourceType,
} from "../../../shared/types/index.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import {
  toPublicResourceType,
  toResourceCapability,
} from "../../../application/services/resources/capabilities.ts";

export const RESOURCE_PROVIDER_VALUES = [
  "cloudflare",
  "local",
  "aws",
  "gcp",
  "k8s",
] as const;

export type ResourceProviderName = (typeof RESOURCE_PROVIDER_VALUES)[number];

export function inferResourceProvider(
  env: AuthenticatedRouteEnv["Bindings"],
): "cloudflare" | "local" {
  return env.CF_ACCOUNT_ID && env.CF_API_TOKEN ? "cloudflare" : "local";
}

export function normalizeResourceProvider(
  provider: unknown,
): ResourceProviderName | undefined {
  if (provider === undefined || provider === null) {
    return undefined;
  }

  const providerName = typeof provider === "string"
    ? provider.trim().toLowerCase()
    : "";

  return RESOURCE_PROVIDER_VALUES.includes(providerName as ResourceProviderName)
    ? providerName as ResourceProviderName
    : undefined;
}

export function buildProjectedResourceSpec(
  name: string,
  body: {
    type: ResourceType;
    config?: Record<string, unknown>;
  },
) {
  const config = body.config ?? {};
  const canonicalType = toPublicResourceType(body.type, config) ?? body.type;
  const workflowConfig = asObject(config.workflow);
  const durableConfig = asObject(config.durableObject);
  const binding =
    typeof config.binding === "string" && config.binding.trim().length > 0
      ? config.binding.trim()
      : name.toUpperCase().replace(/-/g, "_");
  switch (canonicalType) {
    case "d1":
      return { type: "d1" as const, binding };
    case "r2":
      return { type: "r2" as const, binding };
    case "kv":
      return { type: "kv" as const, binding };
    case "queue":
      return {
        type: "queue" as const,
        binding,
        ...(asObject(config.queue) ? { queue: asObject(config.queue)! } : {}),
      };
    case "vectorize":
      return {
        type: "vectorize" as const,
        binding,
        ...(asObject(config.vectorize)
          ? {
            vectorize: config.vectorize as {
              dimensions: number;
              metric: "cosine" | "euclidean" | "dot-product";
            },
          }
          : {}),
      };
    case "analyticsEngine":
      return {
        type: "analyticsEngine" as const,
        binding,
        ...(asObject(config.analyticsEngine)
          ? {
            analyticsEngine: config.analyticsEngine as { dataset?: string },
          }
          : {}),
      };
    case "workflow":
      return {
        type: "workflow" as const,
        binding,
        workflow: {
          service: String(config.service ?? workflowConfig?.service ?? ""),
          export: String(config.export ?? workflowConfig?.export ?? ""),
        },
      };
    case "durableObject":
      return {
        type: "durableObject" as const,
        binding,
        durableObject: {
          className: String(
            config.className ?? durableConfig?.className ?? "",
          ),
          ...(typeof config.scriptName === "string"
            ? { scriptName: config.scriptName }
            : typeof durableConfig?.scriptName === "string"
            ? { scriptName: durableConfig.scriptName }
            : {}),
        },
      };
    case "secretRef":
      return {
        type: "secretRef" as const,
        binding,
      };
    default:
      return {
        type: canonicalType as ResourceType,
        binding,
      };
  }
}

export function resolveRequestedProviderResourceName(
  type: string,
  fallbackName: string,
  config?: Record<string, unknown>,
): string {
  const capability = toResourceCapability(type);
  if (capability === "analytics_store") {
    const analyticsConfig = asObject(config?.analyticsEngine) ??
      asObject(config?.analyticsStore);
    const dataset = typeof analyticsConfig?.dataset === "string"
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
  const vectorConfig = asObject(config?.vectorize) ??
    asObject(config?.vectorIndex);
  const analyticsConfig = asObject(config?.analyticsEngine) ??
    asObject(config?.analyticsStore);
  const workflowConfig = asObject(config?.workflow) ??
    asObject(config?.workflowRuntime);
  const durableConfig = asObject(config?.durableObject) ??
    asObject(config?.durableNamespace);

  if (capability === "vector_index") {
    out.vectorIndex = {
      dimensions: typeof vectorConfig?.dimensions === "number"
        ? vectorConfig.dimensions
        : VECTORIZE_DEFAULT_DIMENSIONS,
      metric: typeof vectorConfig?.metric === "string"
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
    ? value as Record<string, unknown>
    : undefined;
}
