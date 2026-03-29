/**
 * PostgreSQL + pgvector implementation of the Cloudflare VectorizeIndex
 * binding interface.
 *
 * Requires the `vector` extension to be installed on the database.
 * See the companion migration file for the schema definition.
 */
interface PgPool {
    query(text: string, values?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
    }>;
}
interface VectorizeVector {
    id: string;
    values: number[];
    namespace?: string;
    metadata?: Record<string, unknown>;
}
interface VectorizeMatch {
    id: string;
    score: number;
    values?: number[];
    namespace?: string;
    metadata?: Record<string, unknown>;
}
interface VectorizeMatches {
    matches: VectorizeMatch[];
    count: number;
}
interface VectorizeQueryOptions {
    topK?: number;
    namespace?: string;
    returnValues?: boolean;
    returnMetadata?: boolean | string;
    filter?: Record<string, unknown>;
}
interface VectorizeVectorMutation {
    ids: string[];
    count: number;
}
export type PgVectorStoreConfig = {
    pool: PgPool;
    tableName?: string;
};
export declare function createPgVectorStore(config: PgVectorStoreConfig): {
    query(vector: number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>;
    upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation>;
    deleteByIds(ids: string[]): Promise<VectorizeVectorMutation>;
    getByIds(ids: string[]): Promise<VectorizeVector[]>;
    describe(): Promise<{
        name: string;
        config: {
            dimensions: number;
            metric: "cosine";
        };
        vectorsCount: number;
        processedUpToDatetime: string;
        processedUpToMutation: string;
    }>;
};
export {};
//# sourceMappingURL=pgvector-store.d.ts.map