/**
 * Skill Loading and Runtime Resolution.
 *
 * Contains functions that load equipped skills from the database,
 * build skill resolution context from conversation history and
 * thread metadata, and emit skill load outcome events.
 *
 * Extracted from skills.ts to separate runtime loading concerns
 * from scoring and resolution logic.
 */

import type { AgentConfig, AgentMessage, AgentEvent } from './agent-models.ts';
import type { ToolExecutorLike } from '../../tools/executor.ts';
import { getDb, runs, threads } from '../../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import { listLocalizedOfficialSkills, resolveSkillLocale } from './official-skills.ts';
import { listEnabledCustomSkillContext } from '../source/skills.ts';
import { listMcpServers } from '../platform/mcp.ts';
import { getSpaceLocale } from '../identity/locale.ts';
import { getDelegationPacketFromRunInput, isDelegationLocale } from './delegation.ts';
import { listSkillTemplates } from './skill-templates.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type {
  SkillCatalogEntry,
  SkillContext,
  SkillResolutionContext,
  SkillSelection,
} from './skill-resolution.ts';
import { resolveSkillPlan } from './skill-resolution.ts';

// ── Constants ───────────────────────────────────────────────────────────

// Skill loading limits - balanced for security and usability
const MAX_TOTAL_INSTRUCTIONS_SIZE = 1_000_000; // 1MB total for selected detailed skill instructions
const MAX_PER_SKILL_INSTRUCTIONS_SIZE = 50_000; // 50KB per skill

// ── Types ───────────────────────────────────────────────────────────────

export interface SkillLoadResult {
  success: boolean;
  error?: string;
  skillLocale: 'ja' | 'en';
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
}

type SkillAvailabilityInput = {
  availableToolNames: string[];
};

// ── Skill loading ───────────────────────────────────────────────────────

/**
 * Load equipped skills for the workspace.
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
    skillLocale: 'en',
    availableSkills: [],
    selectedSkills: [],
    activatedSkills: [],
  };

  try {
    const localeSamples = [
      ...(skillContext.conversation ?? []),
      skillContext.threadTitle ?? '',
      skillContext.threadSummary ?? '',
      ...((skillContext.threadKeyPoints ?? []).slice(0, 8)),
    ].filter(Boolean);
    const preferredLocale =
      typeof skillContext.runInput?.skill_locale === 'string' ? skillContext.runInput.skill_locale
        : typeof skillContext.runInput?.locale === 'string' ? skillContext.runInput.locale
          : skillContext.preferredLocale
            ?? skillContext.spaceLocale
            ?? (typeof skillContext.runInput?.accept_language === 'string' ? skillContext.runInput.accept_language : null);
    const skillLocale = resolveSkillLocale({
      preferredLocale,
      acceptLanguage: skillContext.acceptLanguage,
      textSamples: localeSamples,
    });
    const availableMcpServerNames = (await listMcpServers(db, spaceId))
      .filter((server) => server.enabled)
      .map((server) => server.name);
    const availableTemplateIds = listSkillTemplates().map((template) => template.id);
    const officialSkills = listLocalizedOfficialSkills(skillLocale).map((skill) => ({
      id: skill.id,
      locale: skill.locale,
      version: skill.version,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      triggers: [...skill.triggers],
      source: 'official' as const,
      category: skill.category,
      priority: skill.priority,
      activation_tags: [...skill.activation_tags],
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: 'available' as const,
      availability_reasons: [],
    }));
    const customSkills = await listEnabledCustomSkillContext(db, spaceId);

    const plan = resolveSkillPlan(
      [
        ...officialSkills,
        ...customSkills,
      ],
      {
        ...skillContext,
        locale: skillLocale,
        availableToolNames: input.availableToolNames,
        availableMcpServerNames,
        availableTemplateIds,
        maxTotalInstructionBytes: MAX_TOTAL_INSTRUCTIONS_SIZE,
        maxPerSkillInstructionBytes: MAX_PER_SKILL_INSTRUCTIONS_SIZE,
      },
    );

    return {
      success: true,
      skillLocale,
      availableSkills: plan.availableSkills,
      selectedSkills: plan.selectedSkills,
      activatedSkills: plan.activatedSkills,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('Failed to load equipped skills', errorMessage, { module: 'services/agent/runner' });
    return { ...defaultResult, error: errorMessage };
  }
}

export async function loadEquippedSkills(
  db: SqlDatabaseBinding,
  spaceId: string,
  toolExecutor: ToolExecutorLike | undefined,
  config: AgentConfig,
  skillContext: SkillResolutionContext,
): Promise<SkillLoadResult> {
  return loadEquippedSkillsWithAvailability(
    db,
    spaceId,
    config,
    skillContext,
    {
      availableToolNames: toolExecutor?.getAvailableTools().map((tool) => tool.name) ?? [],
    },
  );
}

/**
 * Build the skill resolution context from conversation history and thread metadata.
 */
export async function buildSkillResolutionContext(
  db: SqlDatabaseBinding,
  context: { threadId: string; runId: string; spaceId: string },
  config: AgentConfig,
  history: AgentMessage[],
): Promise<SkillResolutionContext> {
  const drizzleDb = getDb(db);
  const recentUserConversation = history
    .filter((message) => message.role === 'user')
    .map((message) => message.content);

  const thread = await drizzleDb.select({
    title: threads.title,
    locale: threads.locale,
    summary: threads.summary,
    keyPoints: threads.keyPoints,
  }).from(threads).where(eq(threads.id, context.threadId)).get();

  const runRow = await drizzleDb.select({
    input: runs.input,
  }).from(runs).where(eq(runs.id, context.runId)).get();

  let parsedRunInput: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(runRow?.input || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsedRunInput = parsed as Record<string, unknown>;
    }
  } catch (error) {
    logWarn('Failed to parse run input for skill resolution', { module: 'services/agent/runner', error: error instanceof Error ? error.message : String(error) });
  }

  let threadKeyPoints: string[] = [];
  try {
    const parsed = JSON.parse(thread?.keyPoints || '[]') as unknown;
    if (Array.isArray(parsed)) {
      threadKeyPoints = parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch (error) {
    logWarn('Failed to parse thread key points for skill resolution', { module: 'services/agent/runner', error: error instanceof Error ? error.message : String(error) });
  }

  const delegationPacket = getDelegationPacketFromRunInput(parsedRunInput);
  const preferredLocale = delegationPacket?.locale
    ?? (isDelegationLocale(thread?.locale) ? thread.locale : null);

  return {
    conversation: recentUserConversation,
    threadTitle: thread?.title ?? null,
    threadSummary: thread?.summary ?? null,
    threadKeyPoints,
    runInput: parsedRunInput,
    agentType: config.type,
    preferredLocale,
    spaceLocale: await getSpaceLocale(db, context.spaceId),
    acceptLanguage: typeof parsedRunInput.accept_language === 'string'
      ? parsedRunInput.accept_language
      : typeof parsedRunInput.acceptLanguage === 'string'
        ? parsedRunInput.acceptLanguage
        : null,
  };
}

export async function resolveSkillPlanForRun(
  db: SqlDatabaseBinding,
  input: {
    threadId: string;
    runId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  },
): Promise<SkillLoadResult> {
  const skillContext = await buildSkillResolutionContext(
    db,
    {
      threadId: input.threadId,
      runId: input.runId,
      spaceId: input.spaceId,
    },
    {
      type: input.agentType,
      systemPrompt: '',
      tools: [],
    },
    input.history,
  );

  return loadEquippedSkillsWithAvailability(
    db,
    input.spaceId,
    {
      type: input.agentType,
      systemPrompt: '',
      tools: [],
    },
    skillContext,
    {
      availableToolNames: input.availableToolNames,
    },
  );
}

/**
 * Emit the skill load outcome event (success with details, or warning on failure).
 */
export async function emitSkillLoadOutcome(
  result: SkillLoadResult,
  emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  if (result.success && result.availableSkills.length > 0) {
    const officialCount = result.availableSkills.filter((skill) => skill.source === 'official').length;
    const customCount = result.availableSkills.filter((skill) => skill.source === 'custom').length;
    await emitEvent('thinking', {
      message: `Loaded ${result.availableSkills.length} available skill(s), selected ${result.selectedSkills.length}, activated ${result.activatedSkills.length} for this run`,
      skill_locale: result.skillLocale,
      available_skill_count: result.availableSkills.length,
      selectable_skill_count: result.availableSkills.filter((skill) => skill.availability !== 'unavailable').length,
      selected_skill_count: result.selectedSkills.length,
      activated_skill_count: result.activatedSkills.length,
      official_skill_count: officialCount,
      custom_skill_count: customCount,
      available_skill_ids: result.availableSkills.map((skill) => skill.id),
      selectable_skill_ids: result.availableSkills
        .filter((skill) => skill.availability !== 'unavailable')
        .map((skill) => skill.id),
      selected_skill_ids: result.selectedSkills.map((entry) => entry.skill.id),
      activated_skill_ids: result.activatedSkills.map((skill) => skill.id),
      selected_skills: result.selectedSkills.map((entry) => ({
        id: entry.skill.id,
        name: entry.skill.name,
        score: entry.score,
        reasons: entry.reasons,
      })),
      skills: result.activatedSkills.map((skill) => skill.name),
    });
    return;
  }

  if (!result.success) {
    await emitEvent('thinking', {
      message: `Warning: Failed to load skills - ${result.error}`,
      warning: true,
    });
  }
}
