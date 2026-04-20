import type { D1Database, R2Bucket } from "../../shared/types/bindings.ts";
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
  sessionId?: string; // Session for file isolation (container must be started)
  threadId: string;
  runId: string;
  userId: string;
  role?: SpaceRole;
  // Capability set granted to this run (SSOT policy is in services/platform/capabilities.ts)
  capabilities: string[];
  // Environment bindings
  env: Env;
  db: D1Database;
  storage?: R2Bucket;
  // Session management - used by container tools
  setSessionId: (sessionId: string | undefined) => void;
  getLastContainerStartFailure: () => ContainerStartFailure | undefined;
  setLastContainerStartFailure: (
    failure: ContainerStartFailure | undefined,
  ) => void;
  // Optional cancellation signal (e.g., tool timeout)
  abortSignal?: AbortSignal;
  // Capability registry for discovery tools
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
  | "file" // file_read, file_write, file_list, file_delete
  | "deploy" // deploy_frontend
  | "runtime" // runtime_exec, runtime_status
  | "storage" // key_value_*, sql_*, object_store_*, create_*
  | "space" // space-scoped custom tools
  | "web" // web_fetch
  | "memory" // remember, recall, set_reminder
  | "artifact" // create_artifact
  | "container" // container_start, container_status, container_commit, container_stop
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

export interface RuntimeExecRequest {
  commands: string[];
  working_dir?: string;
  timeout?: number;
  env_vars?: Record<string, string>;
}

export interface RuntimeExecResponse {
  runtime_id: string;
  status: "running" | "completed" | "failed";
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
