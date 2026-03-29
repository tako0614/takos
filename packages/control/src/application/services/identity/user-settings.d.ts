import type { D1Database } from '../../../shared/types/bindings.ts';
export interface UserSettingsRow {
    userId: string;
    setupCompleted: boolean;
    autoUpdateEnabled: boolean;
    privateAccount: boolean;
    activityVisibility: string;
    aiModel: string | null;
    createdAt: string;
    updatedAt: string;
}
export declare const AI_MODELS: readonly ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
export type AIModel = typeof AI_MODELS[number];
export declare const DEFAULT_AI_MODEL: AIModel;
export declare function getUserSettings(db: D1Database, userId: string): Promise<UserSettingsRow | null>;
export declare function ensureUserSettings(db: D1Database, userId: string): Promise<UserSettingsRow>;
export declare function updateUserSettings(db: D1Database, userId: string, updates: {
    setup_completed?: boolean;
    auto_update_enabled?: boolean;
    private_account?: boolean;
    activity_visibility?: string;
}): Promise<UserSettingsRow | null>;
export declare function formatUserSettingsResponse(settings: UserSettingsRow | null): {
    setup_completed: boolean;
    auto_update_enabled: boolean;
    private_account: boolean;
    activity_visibility: string;
    ai_model: string;
    available_models: readonly ["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4"];
};
//# sourceMappingURL=user-settings.d.ts.map