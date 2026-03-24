import type { AgentTaskPriority, AgentTaskStatus } from '../../../types';
import type { ModelSelectOption } from '../../../lib/modelCatalog';
import type { TranslationKey } from '../../../i18n';

export type ModelOption = string | { id: string; name?: string; description?: string };
export type { ModelSelectOption };

export interface ModelSettings {
  ai_model?: string;
  ai_provider?: string;
  model?: string;
  provider?: string;
  available_models: {
    openai: ModelOption[];
    anthropic: ModelOption[];
    google: ModelOption[];
  };
}

export type TaskFilter = 'all' | AgentTaskStatus;

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

export const STATUS_ORDER: AgentTaskStatus[] = ['planned', 'in_progress', 'blocked', 'completed', 'cancelled'];
export const PRIORITY_OPTIONS: AgentTaskPriority[] = ['low', 'medium', 'high', 'urgent'];
export const DEFAULT_AGENT_TYPE = 'default';

export const AGENT_TYPES = [
  DEFAULT_AGENT_TYPE,
  'assistant',
  'planner',
  'researcher',
  'implementer',
  'reviewer',
];

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
  return [{ id: normalized, label: normalized }, ...options];
}

export function getLocalDateInputMin(date = new Date()): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function getStatusClasses(status: AgentTaskStatus): string {
  switch (status) {
    case 'planned':
      return 'bg-zinc-100 text-zinc-700 border-zinc-300';
    case 'in_progress':
      return 'bg-zinc-200 text-zinc-800 border-zinc-400';
    case 'blocked':
      return 'bg-zinc-300 text-zinc-700 border-zinc-400';
    case 'completed':
      return 'bg-zinc-900 text-white border-zinc-800';
    case 'cancelled':
      return 'bg-zinc-100 text-zinc-500 border-zinc-200';
    default:
      return 'bg-zinc-100 text-zinc-500 border-zinc-200';
  }
}

export function getPriorityClasses(priority: AgentTaskPriority): string {
  switch (priority) {
    case 'low':
      return 'text-zinc-400';
    case 'medium':
      return 'text-zinc-500';
    case 'high':
      return 'text-zinc-700';
    case 'urgent':
      return 'text-zinc-900';
    default:
      return 'text-zinc-500';
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

export function getModelsForProvider(
  modelSettings: ModelSettings | null,
  provider?: string,
): ModelSelectOption[] {
  if (!modelSettings?.available_models) return [];

  let raw: ModelOption[];
  switch (provider) {
    case 'anthropic':
      raw = modelSettings.available_models.anthropic;
      break;
    case 'google':
      raw = modelSettings.available_models.google;
      break;
    default:
      raw = modelSettings.available_models.openai;
      break;
  }

  return (raw || [])
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, label: entry };
      }
      return { id: entry.id, label: entry.name || entry.id };
    })
    .filter((entry) => entry.id);
}
