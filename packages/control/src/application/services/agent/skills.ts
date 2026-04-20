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
  cloneExecutionContract,
  CONVERSATION_WINDOW,
  DEFAULT_EXECUTION_CONTRACT,
  getCategoryKeywords,
  getContextSegments,
  getOutputModeKeywords,
  matchesPhrase,
  MESSAGE_RECENCY_WEIGHTS,
  scoreSkill,
  selectRelevantSkills,
  tokenize,
} from "./skill-scoring.ts";

// ── Resolution ──────────────────────────────────────────────────────────
export type { SkillCategory, SkillSource } from "./skill-resolution.ts";
export type {
  ResolvedSkillPlan,
  SkillAvailabilityContext,
  SkillAvailabilityStatus,
  SkillCatalogEntry,
  SkillContext,
  SkillResolutionContext,
  SkillSelection,
} from "./skill-resolution.ts";
export {
  activateSelectedSkills,
  applySkillAvailability,
  buildDynamicSkillNote,
  buildSkillEnhancedPrompt,
  evaluateSkillAvailability,
  formatContractList,
  resolveSkillPlan,
  toSkillCatalogEntry,
} from "./skill-resolution.ts";

// ── Loader ──────────────────────────────────────────────────────────────
export type { SkillLoadResult } from "./skill-loader.ts";
export {
  buildSkillResolutionContext,
  emitSkillLoadOutcome,
  loadEquippedSkills,
  resolveSkillPlanForRun,
} from "./skill-loader.ts";
