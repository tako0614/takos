import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import type {
  ServiceBindingRow,
  ServiceRuntimeConfigState,
  ServiceRuntimeFlagRow,
  ServiceRuntimeLimitRow,
  ServiceRuntimeLimits,
  ServiceRuntimeRow,
} from "./desired-state-types.ts";

export function normalizeLimits(
  input?: ServiceRuntimeLimits | null,
): ServiceRuntimeLimits {
  const limits: ServiceRuntimeLimits = {};
  if (!input) return limits;

  if (typeof input.cpu_ms === "number" && Number.isFinite(input.cpu_ms)) {
    limits.cpu_ms = Math.floor(input.cpu_ms);
  }
  if (
    typeof input.subrequests === "number" && Number.isFinite(input.subrequests)
  ) {
    limits.subrequests = Math.floor(input.subrequests);
  }

  return limits;
}

export function parseRuntimeRow(
  row: ServiceRuntimeRow | null,
  flags: ServiceRuntimeFlagRow[],
  limitsRow: ServiceRuntimeLimitRow | null,
): ServiceRuntimeConfigState {
  if (!row) {
    return {
      compatibility_flags: [],
      limits: {},
      updated_at: null,
    };
  }

  return {
    compatibility_date: row.compatibilityDate || undefined,
    compatibility_flags: flags.map((flag) => flag.flag),
    limits: normalizeLimits({
      cpu_ms: limitsRow?.cpuMs ?? undefined,
      subrequests: limitsRow?.subrequestLimit ?? undefined,
    }),
    updated_at: row.updatedAt,
  };
}

export function sortBindings(bindings: WorkerBinding[]): WorkerBinding[] {
  return [...bindings].sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare !== 0) return typeCompare;
    return a.name.localeCompare(b.name);
  });
}

function isPortableBackend(backendName: string | null): boolean {
  return !!backendName && backendName !== "cloudflare";
}

function bindingTypeCapability(type: string): string {
  switch (type) {
    case "sql":
    case "d1":
      return "sql";
    case "object-store":
    case "object_store":
    case "r2":
    case "r2_bucket":
      return "object_store";
    case "key-value":
    case "kv":
    case "kv_namespace":
      return "kv";
    case "queue":
      return "queue";
    case "vector-index":
    case "vector_index":
    case "vectorize":
      return "vector_index";
    case "analytics-engine":
    case "analytics_store":
    case "analyticsEngine":
    case "analytics_engine":
      return "analytics_store";
    case "secret":
    case "secretRef":
    case "secret_ref":
    case "secret_text":
      return "secret";
    case "workflow":
    case "workflow_runtime":
    case "workflow_binding":
      return "workflow_runtime";
    case "durable-object":
    case "durable_namespace":
    case "durableObject":
    case "durable_object":
    case "durable_object_namespace":
      return "durable_namespace";
    case "service":
      return "service";
    default:
      return type;
  }
}

export function toRuntimeBindingType(
  bindingType: string,
): WorkerBinding["type"] | null {
  switch (bindingTypeCapability(bindingType)) {
    case "sql":
      return "d1";
    case "object_store":
      return "r2_bucket";
    case "kv":
      return "kv_namespace";
    case "queue":
      return "queue";
    case "vector_index":
      return "vectorize";
    case "analytics_store":
      return "analytics_engine";
    case "secret":
      return "secret_text";
    case "workflow_runtime":
      return "workflow";
    case "durable_namespace":
      return "durable_object_namespace";
    case "service":
      return "service";
    default:
      return null;
  }
}

export function normalizeRoutingWeight(raw: number | string): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : 0;
}

function parseBindingConfig(config: string): Record<string, unknown> {
  return safeJsonParseOrDefault<Record<string, unknown>>(config, {});
}

function sanitizePortableName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "resource";
}

function derivePortableQueueSubscriptionName(name: string): string {
  return `${sanitizePortableName(name)}-subscription`;
}

export function toServiceBinding(
  row: ServiceBindingRow,
  options: { secretText?: string } = {},
): WorkerBinding | null {
  const config = parseBindingConfig(row.config);
  const resourceConfig = parseBindingConfig(row.resourceConfig);

  switch (bindingTypeCapability(row.bindingType)) {
    case "sql":
      if (!row.backingResourceId) return null;
      return {
        type: "d1",
        name: row.bindingName,
        database_id: row.backingResourceId,
      };
    case "object_store":
      if (!row.backingResourceName) return null;
      return {
        type: "r2_bucket",
        name: row.bindingName,
        bucket_name: row.backingResourceName,
      };
    case "kv":
      if (!row.backingResourceId) return null;
      return {
        type: "kv_namespace",
        name: row.bindingName,
        namespace_id: row.backingResourceId,
      };
    case "queue":
      if (
        !row.backingResourceName && !row.backingResourceId
      ) return null;
      return {
        type: "queue",
        name: row.bindingName,
        queue_name: row.backingResourceName ||
          row.backingResourceId || undefined,
        ...(row.backendName === "aws"
          ? {
            queue_backend: "sqs" as const,
            queue_url: row.backingResourceId || undefined,
            backend_name: "aws" as const,
          }
          : {}),
        ...(row.backendName === "gcp"
          ? {
            queue_backend: "pubsub" as const,
            subscription_name:
              typeof resourceConfig.subscriptionName === "string"
                ? resourceConfig.subscriptionName
                : derivePortableQueueSubscriptionName(
                  row.backingResourceName || row.resourceId,
                ),
            backend_name: "gcp" as const,
          }
          : {}),
        ...(row.backendName === "k8s"
          ? {
            queue_backend: "redis" as const,
            backend_name: "k8s" as const,
          }
          : {}),
      };
    case "analytics_store":
      if (
        !row.backingResourceName && !row.backingResourceId
      ) return null;
      return {
        type: "analytics_engine",
        name: row.bindingName,
        dataset: row.backingResourceName ||
          row.backingResourceId || undefined,
      };
    case "vector_index":
      if (!row.backingResourceName) return null;
      return {
        type: "vectorize",
        name: row.bindingName,
        index_name: row.backingResourceName,
      };
    case "secret":
      if (
        options.secretText === undefined &&
        isPortableBackend(row.backendName)
      ) return null;
      return {
        type: "secret_text",
        name: row.bindingName,
        text: options.secretText ?? row.backingResourceId ?? "",
      };
    case "workflow_runtime":
      if (
        !row.backingResourceName && !row.backingResourceId
      ) return null;
      return {
        type: "workflow",
        name: row.bindingName,
        workflow_name: row.backingResourceName ||
          row.backingResourceId || undefined,
      };
    case "durable_namespace": {
      const className = typeof config.className === "string"
        ? config.className
        : row.backingResourceName || row.backingResourceId ||
          undefined;
      if (!className) return null;
      return {
        type: "durable_object_namespace",
        name: row.bindingName,
        class_name: className,
        script_name: typeof config.scriptName === "string"
          ? config.scriptName
          : undefined,
      };
    }
    case "service":
      return {
        type: "service",
        name: row.bindingName,
        service: row.backingResourceName ||
          row.backingResourceId || undefined,
        environment: typeof config.environment === "string"
          ? config.environment
          : undefined,
      };
    default:
      return null;
  }
}
