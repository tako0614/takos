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

export const RESOURCE_BACKEND_VALUES = [
  "cloudflare",
  "local",
  "aws",
  "gcp",
  "k8s",
] as const;

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

const AWS_RESOURCE_BACKEND_ENV_KEYS = [
  "AWS_DYNAMO_KV_TABLE",
  "AWS_DYNAMO_HOSTNAME_ROUTING_TABLE",
  "AWS_SQS_RUN_QUEUE_URL",
  "AWS_SQS_INDEX_QUEUE_URL",
  "AWS_SQS_WORKFLOW_QUEUE_URL",
  "AWS_SQS_DEPLOY_QUEUE_URL",
  "AWS_SECRETS_MANAGER_PREFIX",
  "AWS_SECRETS_MANAGER_SECRET_PREFIX",
  "AWS_SECRETS_MANAGER_KMS_KEY_ID",
] as const;

function hasAwsResourceBackendEnv(env: AuthenticatedRouteEnv["Bindings"]) {
  return AWS_RESOURCE_BACKEND_ENV_KEYS.some((key) => readEnvString(env, key));
}

export function inferResourceBackend(
  env: AuthenticatedRouteEnv["Bindings"],
): ResourceBackendName {
  const configuredBackend = normalizeResourceBackend(
    readEnvString(env, "TAKOS_RESOURCE_BACKEND"),
  );
  if (configuredBackend) return configuredBackend;
  if (readEnvString(env, "K8S_NAMESPACE")) {
    return "k8s";
  }
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) return "cloudflare";
  if (hasAwsResourceBackendEnv(env)) return "aws";
  if (
    readEnvString(env, "GCP_PROJECT_ID") ||
    readEnvString(env, "GCP_REGION") ||
    readEnvString(env, "GCP_CLOUD_RUN_REGION")
  ) {
    return "gcp";
  }
  return "local";
}

export function normalizeResourceBackend(
  backend: unknown,
): ResourceBackendName | undefined {
  if (backend === undefined || backend === null) {
    return undefined;
  }

  const backendName = typeof backend === "string"
    ? backend.trim().toLowerCase()
    : "";

  return RESOURCE_BACKEND_VALUES.includes(backendName as ResourceBackendName)
    ? backendName as ResourceBackendName
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
    case "sql":
      return { type: "d1" as const, binding };
    case "object-store":
      return { type: "r2" as const, binding };
    case "key-value":
      return { type: "kv" as const, binding };
    case "queue":
      return {
        type: "queue" as const,
        binding,
        ...(asObject(config.queue) ? { queue: asObject(config.queue)! } : {}),
      };
    case "vector-index":
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
    case "analytics-engine":
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
    case "durable-object":
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
    case "secret":
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

export function resolveRequestedBackingResourceName(
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
