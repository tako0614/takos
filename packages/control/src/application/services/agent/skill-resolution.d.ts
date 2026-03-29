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
import type { CustomSkillMetadata, SkillCategory, SkillExecutionContract, SkillLocale, SkillSource } from './skill-contracts';
export type { SkillSource, SkillCategory } from './skill-contracts';
export type SkillAvailabilityStatus = 'available' | 'warning' | 'unavailable';
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
    activatedSkills: SkillContext[];
}
export declare function toSkillCatalogEntry(skill: SkillContext): SkillCatalogEntry;
export declare function evaluateSkillAvailability(skill: SkillContext, input: SkillAvailabilityContext): Pick<SkillCatalogEntry, 'availability' | 'availability_reasons'>;
export declare function applySkillAvailability(skills: SkillContext[], input: SkillAvailabilityContext): SkillContext[];
export declare function activateSelectedSkills(selectedSkills: SkillSelection[], maxTotalInstructionBytes: number, maxPerSkillInstructionBytes: number): SkillContext[];
export declare function buildDynamicSkillNote(skillPlan: ResolvedSkillPlan): string;
export declare function formatContractList(values: string[]): string;
export declare function buildSkillEnhancedPrompt(basePrompt: string, skillPlan: ResolvedSkillPlan, spaceId?: string): string;
export declare function resolveSkillPlan(skills: SkillContext[], input: SkillResolutionContext & {
    locale: SkillLocale;
    maxTotalInstructionBytes: number;
    maxPerSkillInstructionBytes: number;
}): ResolvedSkillPlan;
//# sourceMappingURL=skill-resolution.d.ts.map