import type {
  AgentTaskPriority,
  AgentTaskStatus,
} from "../../../types/index.ts";
import type { ModelSelectOption } from "../../../lib/modelCatalog.ts";

export type ModelOption = string | {
  id: string;
  name?: string;
  description?: string;
};
export type { ModelSelectOption };

export interface ModelSettings {
  ai_model?: string;
  model?: string;
  model_backend?: string;
  available_models: {
    openai: ModelOption[];
    anthropic: ModelOption[];
    google: ModelOption[];
  };
}

export type TaskFilter = "all" | AgentTaskStatus;

export type TaskPlan = {
  type?: string;
  tools?: string[];
  needsRepo?: boolean;
  needsRuntime?: boolean;
  usePR?: boolean;
  needsReview?: boolean;
  commitMessage?: string;
  reasoning?: string;
};

export const STATUS_ORDER: AgentTaskStatus[] = [
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
];
export const PRIORITY_OPTIONS: AgentTaskPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];
export const DEFAULT_AGENT_TYPE = "default";

export const AGENT_TYPES = [
  DEFAULT_AGENT_TYPE,
  "assistant",
  "planner",
  "researcher",
  "implementer",
  "reviewer",
];
