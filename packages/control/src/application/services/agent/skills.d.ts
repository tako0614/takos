/**
 * Skill System - Barrel Module.
 *
 * Re-exports all public APIs from the split skill modules:
 *   - skill-scoring.ts    : tokenization, matching, scoring, selection
 *   - skill-resolution.ts : types, availability, activation, prompt building, plan resolution
 *   - skill-loader.ts     : runtime loading, context building, event emission
 */
export { CONVERSATION_WINDOW, MESSAGE_RECENCY_WEIGHTS, DEFAULT_EXECUTION_CONTRACT, cloneExecutionContract, tokenize, matchesPhrase, getContextSegments, getCategoryKeywords, getOutputModeKeywords, scoreSkill, selectRelevantSkills, } from './skill-scoring';
export type { SkillSource, SkillCategory } from './skill-resolution';
export type { SkillAvailabilityStatus, SkillAvailabilityContext, SkillCatalogEntry, SkillContext, SkillSelection, SkillResolutionContext, ResolvedSkillPlan, } from './skill-resolution';
export { toSkillCatalogEntry, evaluateSkillAvailability, applySkillAvailability, activateSelectedSkills, buildDynamicSkillNote, formatContractList, buildSkillEnhancedPrompt, resolveSkillPlan, } from './skill-resolution';
export type { SkillLoadResult } from './skill-loader';
export { loadEquippedSkills, buildSkillResolutionContext, resolveSkillPlanForRun, emitSkillLoadOutcome, } from './skill-loader';
//# sourceMappingURL=skills.d.ts.map