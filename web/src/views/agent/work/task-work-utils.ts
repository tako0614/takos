import type {
  AgentTaskPriority,
  AgentTaskStatus,
} from "../../../types/index.ts";
import type { ModelSelectOption } from "../../../lib/modelCatalog.ts";
import type { TranslationKey } from "../../../i18n.ts";
import {
  AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  type ModelOption,
  type ModelSettings,
  type TaskPlan,
} from "./task-work-types.ts";

export function getAgentTypeOptions(current?: string | null): string[] {
  const normalized = current?.trim();
  if (!normalized || AGENT_TYPES.includes(normalized)) {
    return [...AGENT_TYPES];
  }
  return [normalized, ...AGENT_TYPES];
}

export function resolveAgentTypeLabel(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  agentType?: string | null,
): string {
  const normalized = agentType?.trim() || DEFAULT_AGENT_TYPE;
  const key = `agentType.${normalized}` as TranslationKey;
  const translated = t(key);
  return translated === key ? normalized : translated;
}

export function ensureModelOption(
  options: readonly ModelSelectOption[],
  currentModel?: string | null,
): ModelSelectOption[] {
  const normalized = currentModel?.trim();
  if (!normalized || options.some((option) => option.id === normalized)) {
    return [...options];
  }
  return [{ id: normalized, label: normalized, disabled: true }, ...options];
}

export function getLocalDateInputMin(date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function getStatusClasses(status: AgentTaskStatus): string {
  switch (status) {
    case "planned":
      return "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:border-zinc-600";
    case "in_progress":
      return "bg-zinc-200 text-zinc-800 border-zinc-400 dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-500";
    case "blocked":
      return "bg-zinc-200 text-zinc-800 border-zinc-400 dark:bg-zinc-700 dark:text-zinc-200 dark:border-zinc-500";
    case "completed":
      return "bg-zinc-900 text-white border-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-200";
    case "cancelled":
      return "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:border-zinc-600";
    default:
      return "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:border-zinc-600";
  }
}

export function getPriorityClasses(priority: AgentTaskPriority): string {
  switch (priority) {
    case "low":
      return "text-zinc-600 dark:text-zinc-300";
    case "medium":
      return "text-zinc-700 dark:text-zinc-200";
    case "high":
      return "text-zinc-800 dark:text-zinc-100";
    case "urgent":
      return "text-red-700 dark:text-red-300 font-semibold";
    default:
      return "text-zinc-600 dark:text-zinc-300";
  }
}

export function parsePlan(plan: string | null): TaskPlan | null {
  if (!plan) return null;
  try {
    return JSON.parse(plan) as TaskPlan;
  } catch {
    return null;
  }
}

export function getModelsForModelBackend(
  modelSettings: ModelSettings | null,
  modelBackend?: string,
): ModelSelectOption[] {
  if (!modelSettings?.available_models) return [];

  let raw: ModelOption[];
  switch (modelBackend) {
    case "anthropic":
      raw = modelSettings.available_models.anthropic;
      break;
    case "google":
      raw = modelSettings.available_models.google;
      break;
    default:
      raw = modelSettings.available_models.openai;
      break;
  }

  return (raw || [])
    .map((entry) => {
      if (typeof entry === "string") {
        return { id: entry, label: entry };
      }
      return {
        id: entry.id,
        label: entry.name || entry.id,
        description: entry.description,
        source: entry.source,
        disabled: entry.disabled,
      };
    })
    .filter((entry) => entry.id);
}
