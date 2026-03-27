/**
 * Skill System - Barrel Module.
 *
 * Re-exports all public APIs from the split skill modules:
 *   - skills-scoring.ts    : tokenization, matching, scoring, selection
 *   - skills-resolution.ts : types, availability, activation, prompt building, plan resolution
 *   - skills-loader.ts     : runtime loading, context building, event emission
 */

// ── Scoring ─────────────────────────────────────────────────────────────
export {
  CONVERSATION_WINDOW,
  MESSAGE_RECENCY_WEIGHTS,
  DEFAULT_EXECUTION_CONTRACT,
  cloneExecutionContract,
  tokenize,
  matchesPhrase,
  getContextSegments,
  getCategoryKeywords,
  getOutputModeKeywords,
  scoreSkill,
  selectRelevantSkills,
} from './skills-scoring';

// ── Resolution ──────────────────────────────────────────────────────────
export type { SkillSource, SkillCategory } from './skills-resolution';
export type {
  SkillAvailabilityStatus,
  SkillAvailabilityContext,
  SkillCatalogEntry,
  SkillContext,
  SkillSelection,
  SkillResolutionContext,
  ResolvedSkillPlan,
} from './skills-resolution';
export {
  toSkillCatalogEntry,
  evaluateSkillAvailability,
  applySkillAvailability,
  activateSelectedSkills,
  buildDynamicSkillNote,
  formatContractList,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,
} from './skills-resolution';

// ── Loader ──────────────────────────────────────────────────────────────
export type { SkillLoadResult } from './skills-loader';
export {
  loadEquippedSkills,
  buildSkillResolutionContext,
  resolveSkillPlanForRun,
  emitSkillLoadOutcome,
} from './skills-loader';
