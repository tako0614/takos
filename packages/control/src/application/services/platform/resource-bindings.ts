import type { WorkerBinding } from "../../../platform/providers/cloudflare/wfp.ts";
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

export function toServiceBinding(row: ServiceBindingRow): WorkerBinding | null {
  const config = parseBindingConfig(row.config);
  const resourceConfig = parseBindingConfig(row.resourceConfig);

  switch (row.bindingType) {
    case "d1":
      if (!row.resourceProviderResourceId) return null;
      return {
        type: "d1",
        name: row.bindingName,
        database_id: row.resourceProviderResourceId,
      };
    case "r2":
      if (!row.resourceProviderResourceName) return null;
      return {
        type: "r2_bucket",
        name: row.bindingName,
        bucket_name: row.resourceProviderResourceName,
      };
    case "kv":
      if (!row.resourceProviderResourceId) return null;
      return {
        type: "kv_namespace",
        name: row.bindingName,
        namespace_id: row.resourceProviderResourceId,
      };
    case "queue":
      if (
        !row.resourceProviderResourceName && !row.resourceProviderResourceId
      ) return null;
      return {
        type: "queue",
        name: row.bindingName,
        queue_name: row.resourceProviderResourceName ||
          row.resourceProviderResourceId || undefined,
        ...(row.resourceProviderName === "aws"
          ? {
            queue_backend: "sqs" as const,
            queue_url: row.resourceProviderResourceId || undefined,
            provider_name: "aws" as const,
          }
          : {}),
        ...(row.resourceProviderName === "gcp"
          ? {
            queue_backend: "pubsub" as const,
            subscription_name:
              typeof resourceConfig.subscriptionName === "string"
                ? resourceConfig.subscriptionName
                : derivePortableQueueSubscriptionName(
                  row.resourceProviderResourceName || row.resourceId,
                ),
            provider_name: "gcp" as const,
          }
          : {}),
        ...(row.resourceProviderName === "k8s"
          ? {
            queue_backend: "redis" as const,
            provider_name: "k8s" as const,
          }
          : {}),
      };
    case "analytics_engine":
      if (
        !row.resourceProviderResourceName && !row.resourceProviderResourceId
      ) return null;
      return {
        type: "analytics_engine",
        name: row.bindingName,
        dataset: row.resourceProviderResourceName ||
          row.resourceProviderResourceId || undefined,
      };
    case "vectorize":
      if (!row.resourceProviderResourceName) return null;
      return {
        type: "vectorize",
        name: row.bindingName,
        index_name: row.resourceProviderResourceName,
      };
    case "analyticsEngine":
      if (
        !row.resourceProviderResourceName && !row.resourceProviderResourceId
      ) return null;
      return {
        type: "analytics_engine",
        name: row.bindingName,
        dataset: row.resourceProviderResourceName ||
          row.resourceProviderResourceId || undefined,
      };
    case "workflow":
      if (
        !row.resourceProviderResourceName && !row.resourceProviderResourceId
      ) return null;
      return {
        type: "workflow",
        name: row.bindingName,
        workflow_name: row.resourceProviderResourceName ||
          row.resourceProviderResourceId || undefined,
      };
    case "durable_object_namespace":
    case "durableObject": {
      const className = typeof config.className === "string"
        ? config.className
        : row.resourceProviderResourceName || row.resourceProviderResourceId ||
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
        service: row.resourceProviderResourceName ||
          row.resourceProviderResourceId || undefined,
        environment: typeof config.environment === "string"
          ? config.environment
          : undefined,
      };
    default:
      return null;
  }
}
