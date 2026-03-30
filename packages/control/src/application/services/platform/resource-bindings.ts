import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { ServiceLinkRow } from '../common-env/repository';
import { normalizeEnvName } from '../common-env/crypto';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import type {
  ServiceRuntimeLimits,
  ServiceRuntimeRow,
  ServiceRuntimeFlagRow,
  ServiceRuntimeLimitRow,
  ServiceRuntimeMcpEndpointRow,
  ServiceRuntimeConfigState,
  ServiceBindingRow,
  EffectiveCommonEnvLink,
} from './desired-state-types';

export function normalizeLimits(input?: ServiceRuntimeLimits | null): ServiceRuntimeLimits {
  const limits: ServiceRuntimeLimits = {};
  if (!input) return limits;

  if (typeof input.cpu_ms === 'number' && Number.isFinite(input.cpu_ms)) {
    limits.cpu_ms = Math.floor(input.cpu_ms);
  }
  if (typeof input.subrequests === 'number' && Number.isFinite(input.subrequests)) {
    limits.subrequests = Math.floor(input.subrequests);
  }

  return limits;
}

export function parseRuntimeRow(
  row: ServiceRuntimeRow | null,
  flags: ServiceRuntimeFlagRow[],
  limitsRow: ServiceRuntimeLimitRow | null,
  mcpEndpoints: ServiceRuntimeMcpEndpointRow[]
): ServiceRuntimeConfigState {
  if (!row) {
    return {
      compatibility_flags: [],
      limits: {},
      updated_at: null,
    };
  }

  const enabledEndpoint = mcpEndpoints.find((endpoint) => endpoint.enabled) || mcpEndpoints[0];

  return {
    compatibility_date: row.compatibilityDate || undefined,
    compatibility_flags: flags.map((flag) => flag.flag),
    limits: normalizeLimits({
      cpu_ms: limitsRow?.cpuMs ?? undefined,
      subrequests: limitsRow?.subrequestLimit ?? undefined,
    }),
    mcp_server: enabledEndpoint
      ? {
          enabled: enabledEndpoint.enabled,
          name: enabledEndpoint.name,
          path: enabledEndpoint.path,
        }
      : undefined,
    updated_at: row.updatedAt,
  };
}

export function getEffectiveLinks(rows: ServiceLinkRow[]): Map<string, EffectiveCommonEnvLink> {
  const grouped = new Map<string, { manual?: ServiceLinkRow; required?: ServiceLinkRow }>();

  for (const row of rows) {
    const key = normalizeEnvName(row.env_name);
    const bucket = grouped.get(key) || {};
    if (row.source === 'manual') bucket.manual = row;
    if (row.source === 'required') bucket.required = row;
    grouped.set(key, bucket);
  }

  const out = new Map<string, EffectiveCommonEnvLink>();
  for (const [envName, bucket] of grouped.entries()) {
    const selected = bucket.manual || bucket.required;
    if (!selected) continue;
    out.set(envName, {
      rowId: selected.id,
      envName,
      source: selected.source,
      lastAppliedFingerprint: selected.last_applied_fingerprint,
    });
  }

  return out;
}

export function sortBindings(bindings: WorkerBinding[]): WorkerBinding[] {
  return [...bindings].sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare !== 0) return typeCompare;
    return a.name.localeCompare(b.name);
  });
}

export function normalizeRoutingWeight(raw: number | string): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : 0;
}

function parseBindingConfig(config: string): Record<string, unknown> {
  return safeJsonParseOrDefault<Record<string, unknown>>(config, {});
}

export function toServiceBinding(row: ServiceBindingRow): WorkerBinding | null {
  const config = parseBindingConfig(row.config);

  switch (row.bindingType) {
    case 'd1':
      if (!row.resourceProviderResourceId) return null;
      return {
        type: 'd1',
        name: row.bindingName,
        database_id: row.resourceProviderResourceId,
      };
    case 'r2':
      if (!row.resourceProviderResourceName) return null;
      return {
        type: 'r2_bucket',
        name: row.bindingName,
        bucket_name: row.resourceProviderResourceName,
      };
    case 'kv':
      if (!row.resourceProviderResourceId) return null;
      return {
        type: 'kv_namespace',
        name: row.bindingName,
        namespace_id: row.resourceProviderResourceId,
      };
    case 'queue':
      if (!row.resourceProviderResourceName && !row.resourceProviderResourceId) return null;
      return {
        type: 'queue',
        name: row.bindingName,
        queue_name: row.resourceProviderResourceName || row.resourceProviderResourceId || undefined,
      };
    case 'analytics_engine':
      if (!row.resourceProviderResourceName && !row.resourceProviderResourceId) return null;
      return {
        type: 'analytics_engine',
        name: row.bindingName,
        dataset: row.resourceProviderResourceName || row.resourceProviderResourceId || undefined,
      };
    case 'vectorize':
      if (!row.resourceProviderResourceName) return null;
      return {
        type: 'vectorize',
        name: row.bindingName,
        index_name: row.resourceProviderResourceName,
      };
    case 'analyticsEngine':
      if (!row.resourceProviderResourceName && !row.resourceProviderResourceId) return null;
      return {
        type: 'analytics_engine',
        name: row.bindingName,
        dataset: row.resourceProviderResourceName || row.resourceProviderResourceId || undefined,
      };
    case 'workflow':
      if (!row.resourceProviderResourceName && !row.resourceProviderResourceId) return null;
      return {
        type: 'workflow',
        name: row.bindingName,
        workflow_name: row.resourceProviderResourceName || row.resourceProviderResourceId || undefined,
      };
    case 'durable_object_namespace':
    case 'durableObject': {
      const className = typeof config.className === 'string'
        ? config.className
        : row.resourceProviderResourceName || row.resourceProviderResourceId || undefined;
      if (!className) return null;
      return {
        type: 'durable_object_namespace',
        name: row.bindingName,
        class_name: className,
        script_name: typeof config.scriptName === 'string' ? config.scriptName : undefined,
      };
    }
    case 'service':
      return {
        type: 'service',
        name: row.bindingName,
        service: row.resourceProviderResourceName || row.resourceProviderResourceId || undefined,
        environment: typeof config.environment === 'string' ? config.environment : undefined,
      };
    default:
      return null;
  }
}
