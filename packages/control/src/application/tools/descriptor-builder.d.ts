import type { ToolDefinition } from './tool-definitions';
import type { CapabilityDescriptor } from './capability-types';
import type { LocalizedOfficialSkill } from '../services/agent/official-skills';
export declare function applyPolicyForRole(descriptors: CapabilityDescriptor[], role?: string, capabilities?: string[]): CapabilityDescriptor[];
/** Convert a ToolDefinition to a CapabilityDescriptor. */
export declare function buildToolDescriptor(tool: ToolDefinition): CapabilityDescriptor;
/** Convert a LocalizedOfficialSkill to a CapabilityDescriptor. */
export declare function buildSkillDescriptor(skill: LocalizedOfficialSkill): CapabilityDescriptor;
/** Convert a custom skill row (minimal shape) to a CapabilityDescriptor. */
export declare function buildCustomSkillDescriptor(skill: {
    id: string;
    name: string;
    description: string;
    triggers?: string[];
    category?: string;
}): CapabilityDescriptor;
export interface McpToolMeta {
    serverName: string;
    sourceType: 'managed' | 'external';
}
/** Build a descriptor for MCP-sourced tools. */
export declare function buildMcpToolDescriptor(tool: ToolDefinition, meta?: McpToolMeta): CapabilityDescriptor;
//# sourceMappingURL=descriptor-builder.d.ts.map