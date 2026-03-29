import type { D1Database } from '../../../shared/types/bindings.ts';
import { type SkillCatalogEntry, type SkillContext } from '../agent/skills';
import type { CustomSkillMetadata, SkillLocale } from '../agent/skill-contracts';
export declare class SkillMetadataValidationError extends Error {
    readonly details: Record<string, string>;
    constructor(message: string, details: Record<string, string>);
}
export interface SkillRow {
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    instructions: string;
    triggers: string | null;
    metadata: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}
export declare function parseTriggers(triggers: string | null): string[];
export declare function parseSkillMetadata(metadata: string | null | undefined): CustomSkillMetadata;
export declare function formatSkill(skill: SkillRow): {
    id: string;
    name: string;
    description: string | null;
    instructions: string;
    triggers: string[];
    metadata: CustomSkillMetadata;
    source: "custom";
    editable: boolean;
    enabled: boolean;
    created_at: string;
    updated_at: string;
};
export declare function listSkills(db: D1Database, spaceId: string): Promise<{
    id: string;
    name: string;
    description: string | null;
    instructions: string;
    triggers: string[];
    metadata: CustomSkillMetadata;
    source: "custom";
    editable: boolean;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}[]>;
export declare function getSkill(db: D1Database, spaceId: string, skillId: string): Promise<SkillRow | null>;
export declare function getSkillByName(db: D1Database, spaceId: string, name: string): Promise<SkillRow | null>;
export declare function createSkill(db: D1Database, spaceId: string, input: {
    name: string;
    description?: string;
    instructions: string;
    triggers?: string[];
    metadata?: unknown;
}): Promise<SkillRow | null>;
export declare function updateSkill(db: D1Database, spaceId: string, skillId: string, input: {
    name?: string;
    description?: string;
    instructions?: string;
    triggers?: string[];
    metadata?: unknown;
    enabled?: boolean;
}): Promise<SkillRow | null>;
export declare function updateSkillByName(db: D1Database, spaceId: string, skillName: string, input: {
    name?: string;
    description?: string;
    instructions?: string;
    triggers?: string[];
    metadata?: unknown;
    enabled?: boolean;
}): Promise<SkillRow | null>;
export declare function updateSkillEnabled(db: D1Database, skillId: string, enabled: boolean): Promise<boolean>;
export declare function updateSkillEnabledByName(db: D1Database, spaceId: string, skillName: string, enabled: boolean): Promise<boolean>;
export declare function deleteSkill(db: D1Database, skillId: string): Promise<void>;
export declare function deleteSkillByName(db: D1Database, spaceId: string, skillName: string): Promise<void>;
export declare function listEnabledCustomSkillContext(db: D1Database, spaceId: string): Promise<SkillContext[]>;
export declare function listSkillCatalog(db: D1Database, spaceId: string, localeInput?: {
    preferredLocale?: string | null;
    acceptLanguage?: string | null;
    textSamples?: string[];
}): Promise<{
    locale: SkillLocale;
    available_skills: SkillCatalogEntry[];
}>;
export declare function listSkillContext(db: D1Database, spaceId: string, localeInput?: {
    preferredLocale?: string | null;
    acceptLanguage?: string | null;
    textSamples?: string[];
}): Promise<{
    locale: SkillLocale;
    available_skills: SkillCatalogEntry[];
}>;
export declare function listOfficialSkillsCatalog(db: D1Database, spaceId: string, localeInput?: {
    preferredLocale?: string | null;
    acceptLanguage?: string | null;
    textSamples?: string[];
}): Promise<{
    locale: SkillLocale;
    skills: {
        id: string;
        name: string;
        description: string;
        triggers: string[];
        source: "official";
        editable: boolean;
        category: import("../agent/skill-contracts").SkillCategory | undefined;
        enabled: boolean;
        locale: SkillLocale;
        version: string | undefined;
        activation_tags: string[];
        execution_contract: {
            preferred_tools: string[];
            durable_output_hints: import("../agent/skill-contracts").DurableOutputHint[];
            output_modes: import("../agent/skill-contracts").SkillOutputMode[];
            required_mcp_servers: string[];
            template_ids: string[];
        };
        availability: import("../agent/skill-resolution.ts").SkillAvailabilityStatus;
        availability_reasons: string[];
    }[];
}>;
export declare function getOfficialSkillCatalogEntry(db: D1Database, spaceId: string, skillId: string, localeInput?: {
    preferredLocale?: string | null;
    acceptLanguage?: string | null;
    textSamples?: string[];
}): Promise<{
    id: string;
    name: string;
    description: string;
    instructions: string;
    triggers: string[];
    source: "official";
    editable: boolean;
    category: import("../agent/skill-contracts").SkillCategory | undefined;
    enabled: boolean;
    locale: SkillLocale;
    version: string | undefined;
    activation_tags: string[];
    execution_contract: {
        preferred_tools: string[];
        durable_output_hints: import("../agent/skill-contracts").DurableOutputHint[];
        output_modes: import("../agent/skill-contracts").SkillOutputMode[];
        required_mcp_servers: string[];
        template_ids: string[];
    };
    availability: import("../agent/skill-resolution.ts").SkillAvailabilityStatus;
    availability_reasons: string[];
} | null>;
export declare function describeAgentSkill(db: D1Database, spaceId: string, input: {
    source?: 'official' | 'custom';
    skillId?: string;
    skillName?: string;
    skillRef?: string;
    locale?: string;
    acceptLanguage?: string | null;
}): Promise<{
    id: string;
    name: string;
    description: string | null;
    instructions: string;
    triggers: string[];
    metadata: CustomSkillMetadata;
    source: "custom";
    editable: boolean;
    enabled: boolean;
    created_at: string;
    updated_at: string;
} | {
    id: string;
    name: string;
    description: string;
    instructions: string;
    triggers: string[];
    source: "official";
    editable: boolean;
    category: import("../agent/skill-contracts").SkillCategory | undefined;
    enabled: boolean;
    locale: SkillLocale;
    version: string | undefined;
    activation_tags: string[];
    execution_contract: {
        preferred_tools: string[];
        durable_output_hints: import("../agent/skill-contracts").DurableOutputHint[];
        output_modes: import("../agent/skill-contracts").SkillOutputMode[];
        required_mcp_servers: string[];
        template_ids: string[];
    };
    availability: import("../agent/skill-resolution.ts").SkillAvailabilityStatus;
    availability_reasons: string[];
}>;
//# sourceMappingURL=skills.d.ts.map