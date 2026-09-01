export const AGENT_TASK_PLAN_TYPES = [
  "conversation",
  "tool_only",
  "code_change",
  "composite",
] as const;

export type AgentTaskPlanType = (typeof AGENT_TASK_PLAN_TYPES)[number];

export interface AgentTaskPlan {
  type: AgentTaskPlanType;
  tools: string[];
  needsRepo: boolean;
  needsRuntime: boolean;
  usePR: boolean;
  needsReview: boolean;
  reviewType: "self" | "separate_ai";
  repoId?: string;
  commitMessage?: string;
  reasoning?: string;
}

const MAX_PLAN_TOOLS = 32;
const MAX_PLAN_TOOL_CHARACTERS = 128;
const MAX_PLAN_REPO_ID_CHARACTERS = 128;
const MAX_PLAN_COMMIT_MESSAGE_CHARACTERS = 500;
const MAX_PLAN_REASONING_CHARACTERS = 4_000;

function optionalBoundedString(
  record: Record<string, unknown>,
  key: string,
  maxCharacters: number,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxCharacters) return null;
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : null;
}

/**
 * Parses the persisted/public Agent Task plan contract without trusting a
 * type assertion. Unknown plan types degrade to conversation, while malformed
 * fields fail closed so callers never render or persist a partially trusted
 * shape.
 */
export function parseAgentTaskPlan(value: unknown): AgentTaskPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") return null;

  const toolsValue = record.tools;
  if (
    toolsValue !== undefined &&
    (!Array.isArray(toolsValue) || toolsValue.length > MAX_PLAN_TOOLS)
  ) return null;
  const tools: string[] = [];
  for (const value of toolsValue ?? []) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_PLAN_TOOL_CHARACTERS) return null;
    if (!tools.includes(normalized)) tools.push(normalized);
  }

  const needsRepo = optionalBoolean(record, "needsRepo");
  const needsRuntime = optionalBoolean(record, "needsRuntime");
  const usePR = optionalBoolean(record, "usePR");
  const needsReview = optionalBoolean(record, "needsReview");
  if (
    needsRepo === null || needsRuntime === null || usePR === null ||
    needsReview === null
  ) return null;

  const reviewType = record.reviewType;
  if (
    reviewType !== undefined && reviewType !== "self" &&
    reviewType !== "separate_ai"
  ) return null;

  const repoId = optionalBoundedString(
    record,
    "repoId",
    MAX_PLAN_REPO_ID_CHARACTERS,
  );
  const commitMessage = optionalBoundedString(
    record,
    "commitMessage",
    MAX_PLAN_COMMIT_MESSAGE_CHARACTERS,
  );
  const reasoning = optionalBoundedString(
    record,
    "reasoning",
    MAX_PLAN_REASONING_CHARACTERS,
  );
  if (repoId === null || commitMessage === null || reasoning === null) {
    return null;
  }

  const type = (AGENT_TASK_PLAN_TYPES as readonly string[]).includes(record.type)
    ? record.type as AgentTaskPlanType
    : "conversation";

  return {
    type,
    tools,
    needsRepo: needsRepo ?? false,
    needsRuntime: needsRuntime ?? false,
    usePR: usePR ?? false,
    needsReview: needsReview ?? false,
    reviewType: reviewType ?? "self",
    ...(repoId !== undefined ? { repoId } : undefined),
    ...(commitMessage !== undefined ? { commitMessage } : undefined),
    ...(reasoning !== undefined ? { reasoning } : undefined),
  };
}
