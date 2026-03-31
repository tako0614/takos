/**
 * Skill System - Barrel Module.
 *
 * Re-exports all public APIs from the split skill modules:
 *   - skill-scoring.ts    : tokenization, matching, scoring, selection
 *   - skill-resolution.ts : types, availability, activation, prompt building, plan resolution
 *   - skill-loader.ts     : runtime loading, context building, event emission
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
} from './skill-scoring.ts';

// ── Resolution ──────────────────────────────────────────────────────────
export type { SkillSource, SkillCategory } from './skill-resolution.ts';
export type {
  SkillAvailabilityStatus,
  SkillAvailabilityContext,
  SkillCatalogEntry,
  SkillContext,
  SkillSelection,
  SkillResolutionContext,
  ResolvedSkillPlan,
} from './skill-resolution.ts';
export {
  toSkillCatalogEntry,
  evaluateSkillAvailability,
  applySkillAvailability,
  activateSelectedSkills,
  buildDynamicSkillNote,
  formatContractList,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,
} from './skill-resolution.ts';

// ── Loader ──────────────────────────────────────────────────────────────
export type { SkillLoadResult } from './skill-loader.ts';
export {
  loadEquippedSkills,
  buildSkillResolutionContext,
  resolveSkillPlanForRun,
  emitSkillLoadOutcome,
} from './skill-loader.ts';
