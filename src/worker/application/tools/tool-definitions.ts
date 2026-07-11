import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import type { SpaceRole } from "../../shared/types/index.ts";
import type {
  SensitiveReadPolicy,
  SpaceOperationId,
  ToolClass,
} from "./tool-policy-types.ts";
import type { CapabilityNamespace, RiskLevel } from "./capability-types.ts";
import type { CapabilityRegistry } from "./capability-registry.ts";

export interface ToolContext {
  spaceId: string;
  threadId: string;
  runId: string;
  userId: string;
  role?: SpaceRole;
  // Capability set granted to this run (SSOT policy is in services/platform/capabilities.ts)
  capabilities: string[];
  // Environment bindings
  env: Env;
  db: SqlDatabaseBinding;
  storage?: ObjectStoreBinding;
  // Optional cancellation signal (e.g., tool timeout)
  abortSignal?: AbortSignal;
  // Capability registry for discovery tools
  capabilityRegistry?: CapabilityRegistry;
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
  namespace?: CapabilityNamespace;
  family?: string;
  risk_level?: RiskLevel;
  side_effects?: boolean;
  /** MCP tool behavior hints preserved for discovery and policy UX. */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: unknown;
  // For nested object types
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export type ToolCategory =
  | "space" // Workspace-scoped Takos tools
  | "web" // web_fetch
  | "memory" // remember, recall, set_reminder
  | "artifact" // create_artifact
  | "agent" // spawn_agent
  | "mcp"; // mcp_add_server, mcp_list_servers, mcp_remove_server, + dynamically loaded MCP tools

export interface ToolResult {
  tool_call_id: string;
  output: string;
  error?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  custom: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * The tool request was dispatched but no authoritative outcome was received.
 * Side-effect idempotency records must become terminal-uncertain rather than
 * permitting an automatic replay that could duplicate the remote mutation.
 */
export class ToolExecutionUncertainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ToolExecutionUncertainError";
  }
}

export class ToolExecutionTimeoutError extends ToolExecutionUncertainError {
  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionTimeoutError";
  }
}
