/**
 * Skill Scoring and Selection.
 *
 * Extracted from skills.ts to separate scoring algorithm
 * from skill loading and management concerns.
 */

import type { SkillCategory, SkillExecutionContract } from '../skill-contracts';
import type {
  SkillContext,
  SkillSelection,
  SkillResolutionContext,
  ResolvedSkillPlan,
  SkillCatalogEntry,
} from '../skills';
import {
  getContextSegments,
  matchesPhrase,
  getCategoryKeywords,
  getOutputModeKeywords,
} from '../text/tokenizer';
import { logWarn } from '../../../../shared/utils/logger';

// ── Constants ───────────────────────────────────────────────────────────

const MAX_SELECTED_SKILLS_PER_RUN = 8;

const DEFAULT_EXECUTION_CONTRACT: SkillExecutionContract = {
  preferred_tools: [],
  durable_output_hints: [],
  output_modes: ['chat'],
  required_mcp_servers: [],
  template_ids: [],
};

// ── Internal helpers ────────────────────────────────────────────────────

function cloneExecutionContract(contract?: Partial<SkillExecutionContract> | null): SkillExecutionContract {
  return {
    preferred_tools: [...(contract?.preferred_tools ?? DEFAULT_EXECUTION_CONTRACT.preferred_tools)],
    durable_output_hints: [...(contract?.durable_output_hints ?? DEFAULT_EXECUTION_CONTRACT.durable_output_hints)],
    output_modes: [...(contract?.output_modes ?? DEFAULT_EXECUTION_CONTRACT.output_modes)],
    required_mcp_servers: [...(contract?.required_mcp_servers ?? DEFAULT_EXECUTION_CONTRACT.required_mcp_servers)],
    template_ids: [...(contract?.template_ids ?? DEFAULT_EXECUTION_CONTRACT.template_ids)],
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────

/**
 * Agent-type to category boost mapping.
 *
 * When the running agent's type matches a key, the listed categories
 * receive a small additive score bonus.
 */
const CATEGORY_BOOSTS: Record<string, SkillCategory[]> = {
  researcher: ['research'],
  implementer: ['software'],
  reviewer: ['software'],
  planner: ['planning'],
  assistant: ['writing', 'planning', 'slides', 'research'],
  default: ['software', 'planning', 'research'],
};

/**
 * Score a single skill against the current resolution context.
 *
 * Returns a `SkillSelection` with the computed score and human-readable
 * reasons, or `null` when the skill does not match at all (score <= 0).
 *
 * The scoring algorithm considers:
 * - Trigger phrase matches (highest weight)
 * - Skill name matches
 * - Activation tag matches
 * - Preferred tool name matches
 * - Category keyword matches
 * - Output mode keyword matches
 * - Agent-type category boosts
 */
export function scoreSkill(skill: SkillContext, input: SkillResolutionContext): SkillSelection | null {
  const segments = getContextSegments(input);
  if (segments.length === 0) {
    return null;
  }

  const reasons = new Set<string>();
  let score = 0;

  for (const segment of segments) {
    for (const trigger of skill.triggers) {
      if (matchesPhrase(segment.text, trigger)) {
        score += 12 * segment.weight;
        reasons.add(`${segment.label} matched trigger "${trigger}"`);
      }
    }

    if (matchesPhrase(segment.text, skill.name)) {
      score += 8 * segment.weight;
      reasons.add(`${segment.label} matched skill name`);
    }

    for (const tag of skill.activation_tags ?? []) {
      if (matchesPhrase(segment.text, tag)) {
        score += 5 * segment.weight;
        reasons.add(`${segment.label} matched activation tag "${tag}"`);
      }
    }

    for (const toolName of skill.execution_contract.preferred_tools.slice(0, 8)) {
      if (matchesPhrase(segment.text, toolName)) {
        score += 3 * segment.weight;
        reasons.add(`${segment.label} referenced preferred tool "${toolName}"`);
      }
    }
  }

  if (skill.category && skill.category !== 'custom') {
    const categoryHints = getCategoryKeywords()[skill.category] ?? [];
    if (segments.some((segment) => categoryHints.some((term) => matchesPhrase(segment.text, term)))) {
      score += 6;
      reasons.add(`category hints matched ${skill.category}`);
    }
  }

  for (const outputMode of skill.execution_contract.output_modes) {
    const outputHints = getOutputModeKeywords()[outputMode] ?? [];
    if (segments.some((segment) => outputHints.some((term) => matchesPhrase(segment.text, term)))) {
      score += 4;
      reasons.add(`output intent matched ${outputMode}`);
    }
  }

  const boostedCategories = CATEGORY_BOOSTS[input.agentType ?? 'default'] ?? [];
  if (skill.category && boostedCategories.includes(skill.category)) {
    score += 2.5;
    reasons.add(`agent type ${input.agentType ?? 'default'} boosts ${skill.category}`);
  }

  if (score <= 0) {
    return null;
  }

  return {
    skill: {
      ...skill,
      triggers: [...skill.triggers],
      activation_tags: [...(skill.activation_tags ?? [])],
      version: skill.version,
      execution_contract: cloneExecutionContract(skill.execution_contract),
      availability: skill.availability,
      availability_reasons: [...skill.availability_reasons],
      metadata: skill.metadata ? { ...skill.metadata, execution_contract: skill.metadata.execution_contract ? cloneExecutionContract(skill.metadata.execution_contract) : undefined } : undefined,
    },
    score,
    reasons: [...reasons].slice(0, 8),
  };
}

// ── Selection ───────────────────────────────────────────────────────────

/**
 * Select the most relevant skills for the current context.
 *
 * Filters out unavailable skills, scores each candidate, sorts by
 * score (then priority as tiebreaker), and returns the top N.
 */
export function selectRelevantSkills(
  skills: SkillContext[],
  input: SkillResolutionContext,
): SkillSelection[] {
  return skills
    .filter((skill) => skill.availability !== 'unavailable')
    .map((skill) => scoreSkill(skill, input))
    .filter((entry): entry is SkillSelection => Boolean(entry))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (b.skill.priority ?? 0) - (a.skill.priority ?? 0);
    })
    .slice(0, input.maxSelected ?? MAX_SELECTED_SKILLS_PER_RUN);
}

/**
 * Activate the selected skills subject to per-skill and total instruction
 * size budgets.
 *
 * Skills whose instructions exceed the per-skill limit are skipped.
 * Activation stops once adding the next skill would exceed the total limit.
 */
export function activateSelectedSkills(
  selectedSkills: SkillSelection[],
  maxTotalInstructionBytes: number,
  maxPerSkillInstructionBytes: number,
): SkillContext[] {
  let totalInstructionsSize = 0;
  const activatedSkills: SkillContext[] = [];

  for (const selected of selectedSkills) {
    const instructionsSize = selected.skill.instructions.length;
    if (instructionsSize > maxPerSkillInstructionBytes) {
      logWarn(`Skill "${selected.skill.name}" skipped: instructions size ${instructionsSize} bytes exceeds per-skill limit of ${maxPerSkillInstructionBytes} bytes`, { module: 'services/agent/skills' });
      continue;
    }
    if (totalInstructionsSize + instructionsSize > maxTotalInstructionBytes) {
      logWarn(`Skill activation stopped: total instructions size would exceed ${maxTotalInstructionBytes} bytes`, { module: 'services/agent/skills' });
      break;
    }

    totalInstructionsSize += instructionsSize;
    activatedSkills.push({
      ...selected.skill,
      triggers: [...selected.skill.triggers],
      activation_tags: [...(selected.skill.activation_tags ?? [])],
      execution_contract: cloneExecutionContract(selected.skill.execution_contract),
      metadata: selected.skill.metadata
        ? {
          ...selected.skill.metadata,
          execution_contract: selected.skill.metadata.execution_contract
            ? cloneExecutionContract(selected.skill.metadata.execution_contract)
            : undefined,
        }
        : undefined,
    });
  }

  return activatedSkills;
}

// ── Dynamic skill note ──────────────────────────────────────────────────

/**
 * Build the dynamic skill resolution preamble for the system prompt.
 *
 * Returns an empty string when no skills are available. Otherwise returns
 * a Markdown section explaining how skills were resolved.
 */
export function buildDynamicSkillNote(skillPlan: ResolvedSkillPlan): string {
  if (skillPlan.availableSkills.length === 0) {
    return '';
  }

  return `

## Dynamic Skill Resolution

Takos resolved built-in official skills and workspace custom skills for this run before execution.
Use the activated skill contracts below when they help. If you need broader introspection at run
time, use \`skill_catalog\` for the summary catalog and \`skill_describe\` for one skill's details.
`;
}
