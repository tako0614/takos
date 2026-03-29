import type { CapabilityNamespace, RiskLevel } from './capability-types';
type ToolNamespaceMeta = {
    namespace: CapabilityNamespace;
    family: string;
    risk_level: RiskLevel;
    side_effects: boolean;
};
export declare const TOOL_NAMESPACE_MAP: Record<string, ToolNamespaceMeta>;
export {};
//# sourceMappingURL=namespace-map.d.ts.map