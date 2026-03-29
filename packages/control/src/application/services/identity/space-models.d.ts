import type { D1Database } from '../../../shared/types/bindings.ts';
interface ModelSettings {
    ai_model: string | null;
    ai_provider: string | null;
}
export declare function getWorkspaceModelSettings(db: D1Database, spaceId: string): Promise<ModelSettings | null>;
export declare function updateWorkspaceModel(db: D1Database, spaceId: string, model: string, provider: string): Promise<void>;
export {};
//# sourceMappingURL=space-models.d.ts.map