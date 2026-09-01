// Public DTO contract surface consumed by the web SPA via the
// `takos-api-contract/shared/types` alias.
//
// This barrel re-exports the DTO subset the browser SPA actually imports,
// owned by the worker copies under src/worker/shared/types/ (the runtime-type
// owner). Worker-internal runtime shapes (bindings.ts, env.ts, drizzle-utils,
// queue internals, routing, api-scopes) are intentionally NOT re-exported here
// so worker secrets / Cloudflare binding types never leak onto a
// browser-consumed contract. Add a symbol below only when the SPA needs it.

export {
  AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  isAgentType,
  MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
  MAX_AGENT_TASK_MODEL_CHARACTERS,
  MAX_AGENT_TASK_PLAN_BYTES,
  MAX_AGENT_TASK_REFERENCE_CHARACTERS,
  MAX_AGENT_TASK_TITLE_CHARACTERS,
} from "../../../../worker/shared/types/agent-tasks.ts";

export type {
  AgentTaskBase,
  AgentTaskPriority,
  AgentTaskResumeTarget,
  AgentTaskRunSummary,
  AgentTaskStatus,
  AgentType,
} from "../../../../worker/shared/types/agent-tasks.ts";

export {
  AGENT_TASK_PLAN_TYPES,
  parseAgentTaskPlan,
} from "../../../../worker/shared/types/agent-task-plan.ts";

export type {
  AgentTaskPlan,
  AgentTaskPlanType,
} from "../../../../worker/shared/types/agent-task-plan.ts";

export {
  MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
  MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  MAX_CUSTOM_SKILL_LIST_INPUT_CHARACTERS,
  MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
  MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
  MAX_CUSTOM_SKILL_NAME_CHARACTERS,
  MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
  MAX_CUSTOM_SKILL_RESOURCES,
  MAX_CUSTOM_SKILL_TRIGGER_CHARACTERS,
  MAX_CUSTOM_SKILL_TRIGGERS,
} from "../../../../worker/shared/types/skills.ts";

export type { User } from "../../../../worker/shared/types/identity.ts";
export {
  MAX_USER_EMAIL_CHARACTERS,
  MAX_USER_MODEL_ID_CHARACTERS,
  MAX_USER_NAME_CHARACTERS,
  MAX_USER_PICTURE_URL_CHARACTERS,
  MAX_USER_SETTINGS_MODELS,
  MAX_USER_USERNAME_CHARACTERS,
} from "../../../../worker/shared/types/identity.ts";

export type {
  Memory,
  Reminder,
} from "../../../../worker/shared/types/memories.ts";
export {
  MAX_MEMORY_CATEGORY_CHARACTERS,
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_MEMORY_RECORDS_PER_PAGE,
  MAX_MEMORY_REFERENCE_CHARACTERS,
  MAX_MEMORY_SEARCH_QUERY_CHARACTERS,
  MAX_MEMORY_SUMMARY_CHARACTERS,
  MAX_MEMORY_TAG_CHARACTERS,
  MAX_MEMORY_TAG_ITEMS,
  MAX_MEMORY_TAGS_CHARACTERS,
  MAX_MEMORY_TIMESTAMP_CHARACTERS,
  MAX_REMINDER_CONTENT_CHARACTERS,
  MAX_REMINDER_CONTEXT_CHARACTERS,
  MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
} from "../../../../worker/shared/types/memories.ts";

export type {
  Run,
  ToolExecution,
} from "../../../../worker/shared/types/runs.ts";

export type {
  PublicMcpToolConfirmation,
} from "../../../../worker/shared/types/mcp-tool-confirmations.ts";
export {
  isBoundedMcpToolConfirmationArguments,
  MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_BYTES,
  MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_DEPTH,
  MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_KEY_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_NODES,
  MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_SCHEMA_HASH_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_SERVER_ID_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_TIMESTAMP_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATIONS_PER_RESPONSE,
} from "../../../../worker/shared/types/mcp-tool-confirmations.ts";

export type {
  Space,
  SpaceKind,
} from "../../../../worker/shared/types/spaces.ts";
export {
  MAX_SPACE_DESCRIPTION_CHARACTERS,
  MAX_SPACE_ID_CHARACTERS,
  MAX_SPACE_NAME_CHARACTERS,
  MAX_SPACE_PRINCIPAL_ID_CHARACTERS,
  MAX_SPACE_SLUG_CHARACTERS,
  MAX_SPACE_TIMESTAMP_CHARACTERS,
  MAX_SPACES_PER_RESPONSE,
} from "../../../../worker/shared/types/spaces.ts";

export type {
  SpaceStorageFile,
  SpaceStorageFileType,
} from "../../../../worker/shared/types/storage.ts";
export {
  MAX_STORAGE_BULK_OPERATION_ITEMS,
  MAX_STORAGE_CONTENT_RESPONSE_CHARACTERS,
  MAX_STORAGE_ERROR_CHARACTERS,
  MAX_STORAGE_FILES_PER_RESPONSE,
  MAX_STORAGE_ID_CHARACTERS,
  MAX_STORAGE_MIME_TYPE_CHARACTERS,
  MAX_STORAGE_NAME_CHARACTERS,
  MAX_STORAGE_PATH_CHARACTERS,
  MAX_STORAGE_TIMESTAMP_CHARACTERS,
} from "../../../../worker/shared/types/storage.ts";

export type {
  ThreadHistoryArtifactSummary,
  ThreadHistoryChildRunSummary,
  ThreadHistoryEvent,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryRunSummary,
  ThreadHistoryTaskContext,
  ThreadHistoryTruncation,
} from "../../../../worker/shared/types/thread-history.ts";

export type {
  Message,
  Thread,
} from "../../../../worker/shared/types/threads.ts";
