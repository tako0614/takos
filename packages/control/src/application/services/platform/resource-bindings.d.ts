import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { ServiceLinkRow } from '../common-env/repository';
import type { ServiceRuntimeLimits, ServiceRuntimeRow, ServiceRuntimeFlagRow, ServiceRuntimeLimitRow, ServiceRuntimeMcpEndpointRow, ServiceRuntimeConfigState, ServiceBindingRow, EffectiveCommonEnvLink } from './desired-state-types';
export declare function normalizeLimits(input?: ServiceRuntimeLimits | null): ServiceRuntimeLimits;
export declare function parseRuntimeRow(row: ServiceRuntimeRow | null, flags: ServiceRuntimeFlagRow[], limitsRow: ServiceRuntimeLimitRow | null, mcpEndpoints: ServiceRuntimeMcpEndpointRow[]): ServiceRuntimeConfigState;
export declare function getEffectiveLinks(rows: ServiceLinkRow[]): Map<string, EffectiveCommonEnvLink>;
export declare function sortBindings(bindings: WorkerBinding[]): WorkerBinding[];
export declare function normalizeRoutingWeight(raw: number | string): number;
export declare function toServiceBinding(row: ServiceBindingRow): WorkerBinding | null;
//# sourceMappingURL=resource-bindings.d.ts.map