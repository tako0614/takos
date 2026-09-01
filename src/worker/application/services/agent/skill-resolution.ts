/**
 * Skill Resolution, Activation, and Prompt Building.
 *
 * Contains type definitions shared across skill modules, availability
 * evaluation, skill activation with budget enforcement, and the
 * prompt-building logic that injects activated skill contracts into
 * the agent system prompt.
 *
 * Extracted from skills.ts to separate resolution/activation concerns
 * from scoring and loading.
 */

import type {
  CustomSkillMetadata,
  SkillCategory,
  SkillExecutionContract,
  SkillLocale,
  SkillSource,
} from "./skill-contracts.ts";
import { cloneExecutionContract } from "./skill-scoring.ts";
import { selectRelevantSkills } from "./skill-scoring.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

// ── Re-exported types from skill-contracts ──────────────────────────────

export type { SkillCategory, SkillSource } from "./skill-contracts.ts";

// ── Types ───────────────────────────────────────────────────────────────

export type SkillAvailabilityStatus = "available" | "warning" | "unavailable";

export interface SkillAvailabilityContext {
  availableToolNames?: string[];
  availableMcpServerNames?: string[];
  availableTemplateIds?: string[];
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  source: SkillSource;
  category?: SkillCategory;
  locale?: SkillLocale;
  version?: string;
  activation_tags?: string[];
  execution_contract: SkillExecutionContract;
  availability: SkillAvailabilityStatus;
  availability_reasons: string[];
}

export interface SkillContext extends SkillCatalogEntry {
  instructions: string;
  priority?: number;
  metadata?: CustomSkillMetadata;
}

export interface SkillSelection {
  skill: SkillContext;
  score: number;
  reasons: string[];
}

export interface SkillResolutionContext {
  conversation: string[];
  threadTitle?: string | null;
  threadSummary?: string | null;
  threadKeyPoints?: string[];
  runInput?: Record<string, unknown>;
  agentType?: string;
  spaceLocale?: string | null;
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
  maxSelected?: number;
  availableToolNames?: string[];
  availableMcpServerNames?: string[];
  availableTemplateIds?: string[];
}

export interface ResolvedSkillPlan {
  locale: SkillLocale;
  availableSkills: SkillCatalogEntry[];
  selectableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  selectedSkillContents: SkillContext[];
}

// ── Constants ───────────────────────────────────────────────────────────

// ── Availability ────────────────────────────────────────────────────────

export function toSkillCatalogEntry(skill: SkillContext): SkillCatalogEntry {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggers: [...skill.triggers],
    source: skill.source,
    category: skill.category,
    locale: skill.locale,
    version: skill.version,
    activation_tags: [...(skill.activation_tags ?? [])],
    execution_contract: cloneExecutionContract(skill.execution_contract),
    availability: skill.availability,
    availability_reasons: [...skill.availability_reasons],
  };
}

export function evaluateSkillAvailability(
  skill: SkillContext,
  input: SkillAvailabilityContext,
): Pick<SkillCatalogEntry, "availability" | "availability_reasons"> {
  const reasons: string[] = [];
  const requiredMcpServers = new Set(input.availableMcpServerNames ?? []);
  const availableTemplateIds = new Set(input.availableTemplateIds ?? []);
  const availableToolNames = input.availableToolNames
    ? new Set(input.availableToolNames)
    : null;

  const missingRequiredMcpServers =
    skill.execution_contract.required_mcp_servers.filter(
      (name) => !requiredMcpServers.has(name),
    );
  if (missingRequiredMcpServers.length > 0) {
    reasons.push(
      `missing required MCP servers: ${missingRequiredMcpServers.join(", ")}`,
    );
  }

  const missingTemplates = skill.execution_contract.template_ids.filter(
    (templateId) => !availableTemplateIds.has(templateId),
  );
  if (missingTemplates.length > 0) {
    reasons.push(`missing required templates: ${missingTemplates.join(", ")}`);
  }

  const missingPreferredTools = availableToolNames
    ? skill.execution_contract.preferred_tools.filter(
        (toolName) => !availableToolNames.has(toolName),
      )
    : [];
  if (missingPreferredTools.length > 0) {
    reasons.push(
      `preferred tools not currently available: ${missingPreferredTools.join(
        ", ",
      )}`,
    );
  }

  if (missingRequiredMcpServers.length > 0 || missingTemplates.length > 0) {
    return {
      availability: "unavailable",
      availability_reasons: reasons,
    };
  }

  if (missingPreferredTools.length > 0) {
    return {
      availability: "warning",
      availability_reasons: reasons,
    };
  }

  return {
    availability: "available",
    availability_reasons: [],
  };
}

export function applySkillAvailability(
  skills: SkillContext[],
  input: SkillAvailabilityContext,
): SkillContext[] {
  return skills.map((skill) => {
    const availability = evaluateSkillAvailability(skill, input);
    return {
      ...skill,
      triggers: [...skill.triggers],
      activation_tags: [...(skill.activation_tags ?? [])],
      execution_contract: cloneExecutionContract(skill.execution_contract),
      availability: availability.availability,
      availability_reasons: [...availability.availability_reasons],
      metadata: skill.metadata
        ? {
            ...skill.metadata,
            execution_contract: skill.metadata.execution_contract
              ? cloneExecutionContract(skill.metadata.execution_contract)
              : undefined,
          }
        : undefined,
    };
  });
}

// ── Selection materialization ──────────────────────────────────────────

export function materializeSelectedSkills(
  selectedSkills: SkillSelection[],
  maxTotalInstructionBytes: number,
  maxPerSkillInstructionBytes: number,
): SkillContext[] {
  let totalInstructionsSize = 0;
  const selectedSkillContents: SkillContext[] = [];
  const encoder = new TextEncoder();

  for (const selected of selectedSkills) {
    const instructionsSize = encoder.encode(
      selected.skill.instructions,
    ).byteLength;
    if (instructionsSize > maxPerSkillInstructionBytes) {
      logWarn(
        `Skill "${selected.skill.name}" skipped: instructions size ${instructionsSize} bytes exceeds per-skill limit of ${maxPerSkillInstructionBytes} bytes`,
        { module: "services/agent/skills" },
      );
      continue;
    }
    if (totalInstructionsSize + instructionsSize > maxTotalInstructionBytes) {
      logWarn(
        `Skill revision selection stopped: total instructions size would exceed ${maxTotalInstructionBytes} bytes`,
        { module: "services/agent/skills" },
      );
      break;
    }

    totalInstructionsSize += instructionsSize;
    selectedSkillContents.push({
      ...selected.skill,
      triggers: [...selected.skill.triggers],
      activation_tags: [...(selected.skill.activation_tags ?? [])],
      execution_contract: cloneExecutionContract(
        selected.skill.execution_contract,
      ),
      metadata: selected.skill.metadata
        ? {
            ...selected.skill.metadata,
            execution_contract: selected.skill.metadata.execution_contract
              ? cloneExecutionContract(
                  selected.skill.metadata.execution_contract,
                )
              : undefined,
          }
        : undefined,
    });
  }

  return selectedSkillContents;
}

// ── Plan resolution ─────────────────────────────────────────────────────

export function resolveSkillPlan(
  skills: SkillContext[],
  input: SkillResolutionContext & {
    locale: SkillLocale;
    maxTotalInstructionBytes: number;
    maxPerSkillInstructionBytes: number;
  },
): ResolvedSkillPlan {
  const skillsWithAvailability = applySkillAvailability(skills, input);
  const selectableSkills = skillsWithAvailability
    .filter((skill) => skill.availability !== "unavailable")
    .map((skill) => toSkillCatalogEntry(skill));
  const selectedSkills = selectRelevantSkills(skillsWithAvailability, input);
  const selectedSkillContents = materializeSelectedSkills(
    selectedSkills,
    input.maxTotalInstructionBytes,
    input.maxPerSkillInstructionBytes,
  );

  return {
    locale: input.locale,
    availableSkills: skillsWithAvailability.map((skill) =>
      toSkillCatalogEntry(skill),
    ),
    selectableSkills,
    selectedSkills,
    selectedSkillContents,
  };
}
