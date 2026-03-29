import type { D1Database } from '../../../shared/types/bindings.ts';
export declare class MemoryConsolidator {
    private dbBinding;
    private llmClient;
    constructor(dbBinding: D1Database, apiKey?: string);
    /**
     * Apply decay to all memories in a space.
     * Uses atomic SQL (julianday) to prevent read-modify-write races.
     */
    applyDecay(spaceId: string): Promise<{
        updated: number;
        deleted: number;
    }>;
    mergeSimilar(spaceId: string): Promise<{
        merged: number;
    }>;
    private mergeSimilarSimple;
    summarizeOld(spaceId: string): Promise<{
        summarized: number;
    }>;
    enforceLimit(spaceId: string): Promise<{
        deleted: number;
    }>;
    consolidate(spaceId: string): Promise<{
        decayed: {
            updated: number;
            deleted: number;
        };
        merged: {
            merged: number;
        };
        summarized: {
            summarized: number;
        };
        limited: {
            deleted: number;
        };
    }>;
}
//# sourceMappingURL=consolidation.d.ts.map