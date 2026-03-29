import type { D1Database, R2Bucket } from '../../shared/types/bindings.ts';
import type { Env } from '../../shared/types';
import type { SpaceRole } from '../../shared/types';
import type { ToolClass, SpaceOperationId, SensitiveReadPolicy } from './tool-policy-types';
import type { CapabilityNamespace, RiskLevel } from './capability-types';
import type { CapabilityRegistry } from './capability-registry';
export interface ToolContext {
    spaceId: string;
    sessionId?: string;
    threadId: string;
    runId: string;
    userId: string;
    role?: SpaceRole;
    capabilities: string[];
    env: Env;
    db: D1Database;
    storage?: R2Bucket;
    setSessionId: (sessionId: string | undefined) => void;
    getLastContainerStartFailure: () => ContainerStartFailure | undefined;
    setLastContainerStartFailure: (failure: ContainerStartFailure | undefined) => void;
    browserSessionId?: string;
    abortSignal?: AbortSignal;
    capabilityRegistry?: CapabilityRegistry;
}
export interface ContainerStartFailure {
    message: string;
    sessionId?: string;
}
export interface ToolDefinition {
    name: string;
    description: string;
    category: ToolCategory;
    tool_class?: ToolClass;
    operation_id?: SpaceOperationId;
    composed_operations?: SpaceOperationId[];
    sensitive_read_policy?: SensitiveReadPolicy;
    required_roles?: SpaceRole[];
    required_capabilities?: string[];
    canonical_name?: string;
    deprecated_aliases?: string[];
    namespace?: CapabilityNamespace;
    family?: string;
    risk_level?: RiskLevel;
    side_effects?: boolean;
    parameters: {
        type: 'object';
        properties: Record<string, ToolParameter>;
        required?: string[];
    };
}
export interface ToolParameter {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    enum?: string[];
    items?: ToolParameter;
    default?: unknown;
    properties?: Record<string, ToolParameter>;
    required?: string[];
}
export type ToolCategory = 'file' | 'deploy' | 'runtime' | 'storage' | 'workspace' | 'web' | 'memory' | 'artifact' | 'container' | 'agent' | 'mcp' | 'browser';
export interface ToolResult {
    tool_call_id: string;
    output: string;
    error?: string;
}
export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
export interface RegisteredTool {
    definition: ToolDefinition;
    handler: ToolHandler;
    builtin: boolean;
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
export interface RuntimeExecRequest {
    commands: string[];
    working_dir?: string;
    timeout?: number;
    env_vars?: Record<string, string>;
}
export interface RuntimeExecResponse {
    runtime_id: string;
    status: 'running' | 'completed' | 'failed';
    output?: string;
    exit_code?: number;
    error?: string;
}
export interface DeployRequest {
    dist_path: string;
    service_name: string;
    env_vars?: Record<string, string>;
}
export interface DeployResponse {
    success: boolean;
    service_name: string;
    version?: string;
    url?: string;
    error?: string;
}
//# sourceMappingURL=tool-definitions.d.ts.map