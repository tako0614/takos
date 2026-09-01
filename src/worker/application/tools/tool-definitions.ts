import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  SensitiveReadPolicy,
  SpaceOperationId,
  ToolClass,
} from "./tool-policy-types.ts";
import type { CapabilityNamespace, RiskLevel } from "./capability-types.ts";
import type { CapabilityRegistry } from "./capability-registry.ts";
import type { RunExecutionAuthority } from "../services/runs/run-authority.ts";

export interface ToolContext {
  spaceId: string;
  threadId: string;
  runId: string;
  userId: string;
  /** Exact immutable Run authority verified by the Worker control boundary. */
  runAuthority?: RunExecutionAuthority;
  /** Current model/tool-protocol call identity; never caller-supplied to handlers. */
  toolCallId?: string;
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
  /**
   * Worker-internal adapter identity used to build an immutable
   * ToolDescriptorRevision. It is never a permission, credential, endpoint,
   * or model-visible annotation.
   */
  adapter_identity?: {
    source: "native" | "mcp";
    reference: string;
    revision: string;
  };
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ToolParameter {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
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
  /** Remote side-effect outcome is unknown; the agent Run must fail closed. */
  outcome_uncertain?: boolean;
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
