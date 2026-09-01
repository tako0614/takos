import type {
  AgentTaskPriority,
  AgentTaskStatus,
} from "../../../types/index.ts";
import {
  AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
  MAX_AGENT_TASK_TITLE_CHARACTERS,
} from "takos-api-contract/shared/types";
import type { AgentTaskPlan } from "takos-api-contract/shared/types";
import type { ModelSelectOption } from "../../../lib/modelCatalog.ts";
import type { ModelSettingsResponse } from "../../../lib/model-settings-response.ts";

export type { ModelSelectOption };

export type ModelSettings = ModelSettingsResponse;

export type TaskFilter = "all" | AgentTaskStatus;

export type TaskPlan = AgentTaskPlan;

export const STATUS_ORDER = [
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const satisfies readonly AgentTaskStatus[];
export type EditableAgentTaskStatus = typeof STATUS_ORDER[number];
export const PRIORITY_OPTIONS: AgentTaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];
export {
  AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
  MAX_AGENT_TASK_TITLE_CHARACTERS,
};
