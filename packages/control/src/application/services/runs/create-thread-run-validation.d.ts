import type { D1Database } from '../../../shared/types/bindings.ts';
export declare function validateParentRunId(db: D1Database, spaceId: string, parentRunId: string): Promise<string | null>;
export declare function resolveRunModel(db: D1Database, spaceId: string, requestedModel: string | undefined): Promise<string>;
//# sourceMappingURL=create-thread-run-validation.d.ts.map