export type SkillLocale = "ja" | "en";
export type ManagedSkillCategory =
  | "research"
  | "writing"
  | "planning"
  | "slides"
  | "software";
export type SkillCategory = ManagedSkillCategory | "custom";
export type DurableOutputHint =
  | "artifact"
  | "reminder"
  | "repo"
  | "app"
  | "workspace_file";
export type SkillOutputMode = "chat" | DurableOutputHint;
export type DocumentedSkillOutputMode = "text" | "structured" | "artifact";
export type SkillOutputModeInput = SkillOutputMode | DocumentedSkillOutputMode;
export type SkillSource = "managed" | "custom";

export interface SkillExecutionContract {
  preferred_tools: string[];
  durable_output_hints: DurableOutputHint[];
  output_modes: SkillOutputMode[];
  required_mcp_servers: string[];
  template_ids: string[];
}

export interface CustomSkillMetadata {
  locale?: SkillLocale;
  category?: ManagedSkillCategory;
  activation_tags?: string[];
  execution_contract?: Partial<SkillExecutionContract>;
}

const SKILL_OUTPUT_MODE_ALIASES: Record<
  Exclude<DocumentedSkillOutputMode, "artifact">,
  SkillOutputMode
> = {
  text: "chat",
  structured: "chat",
};

const VALID_SKILL_OUTPUT_MODES = new Set<SkillOutputMode>([
  "chat",
  "artifact",
  "reminder",
  "repo",
  "app",
  "workspace_file",
]);

const VALID_DURABLE_OUTPUT_HINTS = new Set<DurableOutputHint>([
  "artifact",
  "reminder",
  "repo",
  "app",
  "workspace_file",
]);

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (normalized) {
      result.push(normalized);
    }
  }
  return result;
}

export function normalizeSkillOutputMode(
  value: unknown,
): SkillOutputMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const alias = SKILL_OUTPUT_MODE_ALIASES[
    normalized as Exclude<DocumentedSkillOutputMode, "artifact">
  ];
  if (alias) {
    return alias;
  }

  return VALID_SKILL_OUTPUT_MODES.has(normalized as SkillOutputMode)
    ? normalized as SkillOutputMode
    : null;
}

export function normalizeSkillOutputModes(value: unknown): SkillOutputMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const outputModes: SkillOutputMode[] = [];
  const seen = new Set<SkillOutputMode>();

  for (const item of value) {
    const normalized = normalizeSkillOutputMode(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      outputModes.push(normalized);
    }
  }

  return outputModes;
}

export function normalizeSkillExecutionContract(
  contract?: {
    preferred_tools?: unknown;
    durable_output_hints?: unknown;
    output_modes?: unknown;
    required_mcp_servers?: unknown;
    template_ids?: unknown;
  } | null,
): SkillExecutionContract {
  const preferredTools = normalizeStringArray(contract?.preferred_tools);
  const durableOutputHints = normalizeStringArray(
    contract?.durable_output_hints,
  )
    .filter((item): item is DurableOutputHint =>
      VALID_DURABLE_OUTPUT_HINTS.has(item as DurableOutputHint)
    );
  const outputModes = normalizeSkillOutputModes(
    contract?.output_modes ?? ["chat"],
  );
  const requiredMcpServers = normalizeStringArray(
    contract?.required_mcp_servers,
  );
  const templateIds = normalizeStringArray(contract?.template_ids);

  return {
    preferred_tools: preferredTools,
    durable_output_hints: durableOutputHints,
    output_modes: outputModes,
    required_mcp_servers: requiredMcpServers,
    template_ids: templateIds,
  };
}
