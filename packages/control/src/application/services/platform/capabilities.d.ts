import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SpaceRole } from '../../../shared/types';
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
export type StandardCapabilityId = 'storage.read' | 'storage.write' | 'repo.read' | 'repo.write' | 'egress.http' | 'oauth.exchange' | 'vectorize.write' | 'queue.write' | 'analytics.write' | 'workflow.invoke' | 'durable_object.use' | 'billing.meter';
export interface CapabilityDefinition {
    id: StandardCapabilityId;
    description: string;
}
export declare const STANDARD_CAPABILITIES: ReadonlyArray<CapabilityDefinition>;
export declare class CapabilityRegistry {
    private defs;
    constructor(defs?: ReadonlyArray<CapabilityDefinition>);
    register(def: CapabilityDefinition): void;
    has(id: string): boolean;
    get(id: string): CapabilityDefinition | undefined;
    validate(ids: readonly string[]): {
        known: StandardCapabilityId[];
        unknown: string[];
        duplicates: string[];
    };
}
export declare const capabilityRegistry: CapabilityRegistry;
export type TenantType = 'official' | 'approved' | 'third_party';
export type SecurityPosture = 'standard' | 'restricted_egress';
export interface CapabilityPolicyContext {
    role: SpaceRole;
    securityPosture: SecurityPosture;
    tenantType: TenantType;
}
export declare function selectAllowedCapabilities(ctx: CapabilityPolicyContext): Set<StandardCapabilityId>;
export declare function resolveSpaceRole(db: D1Database, spaceId: string, userId: string): Promise<SpaceRole>;
export declare function resolveAllowedCapabilities(params: {
    db: D1Database;
    spaceId: string;
    userId: string;
    securityPosture?: SecurityPosture;
    tenantType?: TenantType;
    minimumRole?: SpaceRole;
}): Promise<{
    ctx: CapabilityPolicyContext;
    allowed: Set<StandardCapabilityId>;
}>;
export declare function requireCapability(allowed: Iterable<string>, required: StandardCapabilityId, message?: string): void;
export declare function filterBindingsByCapabilities(params: {
    bindings: WorkerBinding[];
    allowed: Set<StandardCapabilityId>;
}): {
    allowedBindings: WorkerBinding[];
    deniedBindings: WorkerBinding[];
};
//# sourceMappingURL=capabilities.d.ts.map