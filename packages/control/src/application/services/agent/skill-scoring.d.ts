/**
 * Skill Scoring and Matching Utilities.
 *
 * Contains tokenization, phrase matching, context segment extraction,
 * category/output-mode keyword maps, and the core skill scoring algorithm.
 *
 * Extracted from skills.ts to separate scoring concerns from
 * skill resolution and loading.
 */
import type { SkillCategory, SkillExecutionContract } from './skill-contracts';
import type { SkillContext, SkillSelection, SkillResolutionContext } from './skill-resolution';
export declare const CONVERSATION_WINDOW = 8;
export declare const MESSAGE_RECENCY_WEIGHTS: number[];
export declare const DEFAULT_EXECUTION_CONTRACT: SkillExecutionContract;
export declare function cloneExecutionContract(contract?: Partial<SkillExecutionContract> | null): SkillExecutionContract;
export declare function tokenize(text: string): string[];
export declare function matchesPhrase(text: string, phrase: string): boolean;
export declare function getContextSegments(input: SkillResolutionContext): Array<{
    label: string;
    text: string;
    weight: number;
}>;
export declare function getCategoryKeywords(): Record<Exclude<SkillCategory, 'custom'>, string[]>;
export declare function getOutputModeKeywords(): Record<string, string[]>;
export declare function scoreSkill(skill: SkillContext, input: SkillResolutionContext): SkillSelection | null;
export declare function selectRelevantSkills(skills: SkillContext[], input: SkillResolutionContext): SkillSelection[];
//# sourceMappingURL=skill-scoring.d.ts.map