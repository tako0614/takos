import type { CustomSkillMetadata, OfficialSkillCategory, SkillExecutionContract, SkillLocale } from './skill-contracts';
interface OfficialSkillLocaleContent {
    name: string;
    description: string;
    instructions: string;
    triggers: string[];
}
export interface OfficialSkillDefinition {
    id: string;
    version: string;
    category: OfficialSkillCategory;
    priority: number;
    activation_tags: string[];
    execution_contract: SkillExecutionContract;
    locales: Record<SkillLocale, OfficialSkillLocaleContent>;
}
export interface LocalizedOfficialSkill {
    id: string;
    version: string;
    locale: SkillLocale;
    category: OfficialSkillCategory;
    priority: number;
    activation_tags: string[];
    execution_contract: SkillExecutionContract;
    name: string;
    description: string;
    instructions: string;
    triggers: string[];
}
export declare const CATEGORY_LABELS: Record<OfficialSkillCategory | 'custom', {
    label: string;
    description: string;
}>;
export declare function getCategoryLabel(cat: OfficialSkillCategory | 'custom'): {
    label: string;
    description: string;
};
export interface CustomSkillMetadataValidationResult {
    normalized: CustomSkillMetadata;
    fieldErrors: Record<string, string>;
}
export declare function isSkillLocale(value: string | undefined | null): value is SkillLocale;
export declare function resolveSkillLocale(input?: {
    preferredLocale?: string | null;
    acceptLanguage?: string | null;
    textSamples?: string[];
}): SkillLocale;
export declare function normalizeCustomSkillMetadata(input: unknown): CustomSkillMetadata;
export declare function validateCustomSkillMetadata(input: unknown): CustomSkillMetadataValidationResult;
export declare function localizeOfficialSkill(skill: OfficialSkillDefinition, locale: SkillLocale): LocalizedOfficialSkill;
export declare function listOfficialSkillDefinitions(): OfficialSkillDefinition[];
export declare function listLocalizedOfficialSkills(locale: SkillLocale): LocalizedOfficialSkill[];
export declare function getOfficialSkillById(skillId: string, locale: SkillLocale): LocalizedOfficialSkill | null;
export {};
//# sourceMappingURL=official-skills.d.ts.map