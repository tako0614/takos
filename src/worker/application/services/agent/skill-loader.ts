/**
 * Skill Loading and Runtime Resolution.
 *
 * Resolves the immutable initial Skill plan only from exact Run model input,
 * then emits bounded load telemetry. Mutable Thread metadata is deliberately
 * outside this module's interface.
 *
 * Extracted from skills.ts to separate runtime loading concerns
 * from scoring and resolution logic.
 */

import type { AgentConfig, AgentEvent, AgentMessage } from "./agent-models.ts";
import {
  listLocalizedManagedSkills,
  resolveSkillLocale,
} from "./managed-skills.ts";
import { MAX_CUSTOM_SKILL_INSTRUCTION_BYTES } from "../../../shared/types/skills.ts";
import { listEnabledCustomSkillContext } from "../source/skills.ts";
import { listMcpServers } from "../platform/mcp.ts";
import { getDelegationPacketFromRunInput } from "./delegation.ts";
import { listSkillTemplates } from "./skill-templates.ts";
import { logError } from "../../../shared/utils/logger.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type {
  SkillCatalogEntry,
  SkillContext,
  SkillResolutionContext,
  SkillSelection,
} from "./skill-resolution.ts";
import { resolveSkillPlan } from "./skill-resolution.ts";

// ── Constants ───────────────────────────────────────────────────────────

// Conversation history reserves 16K model tokens for the system prompt, tool
// schemas, selected skills, current turn, and completion. Skill instructions
// therefore get a conservative byte budget inside that same reserve instead
// of an independent 1 MiB allowance that could overflow the model window.
export const MAX_TOTAL_SKILL_INSTRUCTION_BYTES = 8 * 1024;
export const MAX_PER_SKILL_INSTRUCTION_BYTES =
  MAX_CUSTOM_SKILL_INSTRUCTION_BYTES;

// ── Types ───────────────────────────────────────────────────────────────

export interface SkillLoadResult {
  success: boolean;
  error?: string;
  skillLocale: "ja" | "en";
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  selectedSkillContents: SkillContext[];
}

type SkillAvailabilityInput = {
  availableToolNames: string[];
};

// ── Skill loading ───────────────────────────────────────────────────────

/**
 * Load equipped skills for the space.
 *
 * Security: Limits number of skills and total instruction size to prevent
 * DoS attacks via excessive skill data loading.
 */
async function loadEquippedSkillsWithAvailability(
  db: SqlDatabaseBinding,
  spaceId: string,
  _config: AgentConfig,
  skillContext: SkillResolutionContext,
  input: SkillAvailabilityInput,
): Promise<SkillLoadResult> {
  const defaultResult: SkillLoadResult = {
    success: false,
    skillLocale: "en",
    availableSkills: [],
    selectedSkills: [],
    selectedSkillContents: [],
  };

  try {
    const localeSamples = [
      ...(skillContext.conversation ?? []),
      skillContext.threadTitle ?? "",
      skillContext.threadSummary ?? "",
      ...(skillContext.threadKeyPoints ?? []).slice(0, 8),
    ].filter(Boolean);
    const preferredLocale =
      typeof skillContext.runInput?.skill_locale === "string"
        ? skillContext.runInput.skill_locale
        : typeof skillContext.runInput?.locale === "string"
          ? skillContext.runInput.locale
          : (skillContext.preferredLocale ??
            skillContext.spaceLocale ??
            (typeof skillContext.runInput?.accept_language === "string"
              ? skillContext.runInput.accept_language
              : null));
    const skillLocale = resolveSkillLocale({
      preferredLocale,
      acceptLanguage: skillContext.acceptLanguage,
      textSamples: localeSamples,
    });
    const availableMcpServerNames = (await listMcpServers(db, spaceId))
      .filter((server) => server.enabled)
      .map((server) => server.name);
    const availableTemplateIds = listSkillTemplates().map(
      (template) => template.id,
    );
    const managedSkills = listLocalizedManagedSkills(skillLocale).map(
      (skill) => ({
        id: skill.id,
        locale: skill.locale,
        version: skill.version,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        triggers: [...skill.triggers],
        source: "managed" as const,
        category: skill.category,
        priority: skill.priority,
        activation_tags: [...skill.activation_tags],
        execution_contract: {
          preferred_tools: [...skill.execution_contract.preferred_tools],
          durable_output_hints: [
            ...skill.execution_contract.durable_output_hints,
          ],
          output_modes: [...skill.execution_contract.output_modes],
          required_mcp_servers: [
            ...skill.execution_contract.required_mcp_servers,
          ],
          template_ids: [...skill.execution_contract.template_ids],
        },
        availability: "available" as const,
        availability_reasons: [],
      }),
    );
    const customSkills = await listEnabledCustomSkillContext(db, spaceId);

    const plan = resolveSkillPlan([...managedSkills, ...customSkills], {
      ...skillContext,
      locale: skillLocale,
      availableToolNames: input.availableToolNames,
      availableMcpServerNames,
      availableTemplateIds,
      maxTotalInstructionBytes: MAX_TOTAL_SKILL_INSTRUCTION_BYTES,
      maxPerSkillInstructionBytes: MAX_PER_SKILL_INSTRUCTION_BYTES,
    });

    return {
      success: true,
      skillLocale,
      availableSkills: plan.availableSkills,
      selectedSkills: plan.selectedSkills,
      selectedSkillContents: plan.selectedSkillContents,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError("Failed to load equipped skills", errorMessage, {
      module: "services/agent/skill-loader",
    });
    return { ...defaultResult, error: errorMessage };
  }
}

/** Build only from the exact inputs already verified for the model request. */
export function buildPinnedSkillResolutionContext(
  input: {
    agentType: string;
    history: AgentMessage[];
    runInputJson: string;
  },
): SkillResolutionContext {
  let runInput: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.runInputJson) as unknown;
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    ) {
      throw new TypeError("Run input must be an object");
    }
    runInput = parsed as Record<string, unknown>;
  } catch (error) {
    throw new TypeError("Pinned Run input is invalid", { cause: error });
  }
  const delegationPacket = getDelegationPacketFromRunInput(runInput);
  return {
    conversation: input.history
      .filter((message) => message.role === "user")
      .map((message) => message.content),
    threadTitle: null,
    threadSummary: null,
    threadKeyPoints: [],
    runInput,
    agentType: input.agentType,
    preferredLocale: delegationPacket?.locale ?? null,
    spaceLocale: null,
    acceptLanguage:
      typeof runInput.accept_language === "string"
        ? runInput.accept_language
        : typeof runInput.acceptLanguage === "string"
          ? runInput.acceptLanguage
          : null,
  };
}

/**
 * Resolve Skill selection from the same pinned inputs used for the model
 * request. This deliberately excludes mutable Thread summary/title/key-points
 * and caller-supplied history. The result must be persisted as immutable
 * Skill revisions before any instructions become model-visible.
 */
export async function resolveSkillPlanForPinnedRun(
  db: SqlDatabaseBinding,
  input: {
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    runInputJson: string;
    availableToolNames: string[];
  },
): Promise<{
  resolutionContext: SkillResolutionContext;
  plan: SkillLoadResult;
}> {
  const resolutionContext = buildPinnedSkillResolutionContext(input);
  const plan = await loadEquippedSkillsWithAvailability(
    db,
    input.spaceId,
    { type: input.agentType, systemPrompt: "" },
    resolutionContext,
    { availableToolNames: input.availableToolNames },
  );
  if (!plan.success) {
    throw new Error(plan.error || "Pinned Skill plan resolution failed");
  }
  return { resolutionContext, plan };
}

/**
 * Emit the skill load outcome event (success with details, or warning on failure).
 */
export async function emitSkillLoadOutcome(
  result: SkillLoadResult,
  emitEvent: (
    type: AgentEvent["type"],
    data: Record<string, unknown>,
  ) => Promise<void>,
): Promise<void> {
  if (result.success && result.availableSkills.length > 0) {
    const managedCount = result.availableSkills.filter(
      (skill) => skill.source === "managed",
    ).length;
    const customCount = result.availableSkills.filter(
      (skill) => skill.source === "custom",
    ).length;
    await emitEvent("thinking", {
      message: `Loaded ${result.availableSkills.length} manual(s) for on-demand reference`,
      skill_locale: result.skillLocale,
      available_skill_count: result.availableSkills.length,
      selectable_skill_count: result.availableSkills.filter(
        (skill) => skill.availability !== "unavailable",
      ).length,
      selected_skill_count: result.selectedSkills.length,
      selected_skill_content_count: result.selectedSkillContents.length,
      managed_skill_count: managedCount,
      custom_skill_count: customCount,
      available_skill_ids: result.availableSkills.map((skill) => skill.id),
      selectable_skill_ids: result.availableSkills
        .filter((skill) => skill.availability !== "unavailable")
        .map((skill) => skill.id),
      selected_skill_ids: result.selectedSkills.map((entry) => entry.skill.id),
      selected_skill_content_ids: result.selectedSkillContents.map((skill) =>
        skill.id
      ),
      selected_skills: result.selectedSkills.map((entry) => ({
        id: entry.skill.id,
        name: entry.skill.name,
        score: entry.score,
        reasons: entry.reasons,
      })),
      skills: result.selectedSkillContents.map((skill) => skill.name),
    });
    return;
  }

  if (!result.success) {
    await emitEvent("thinking", {
      message: `Warning: Failed to load skills - ${result.error}`,
      warning: true,
    });
  }
}
