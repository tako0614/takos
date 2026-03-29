import type { Ai, VectorizeIndex, D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env, SpaceFile } from '../../../shared/types';
export interface EmbeddingResult {
    id: string;
    spaceId: string;
    fileId: string;
    chunkIndex: number;
    content: string;
    vector: number[];
}
export interface EmbeddingSearchResult {
    id: string;
    score: number;
    content: string;
    fileId: string;
    filePath: string;
    chunkIndex: number;
}
export interface RepoSearchResult {
    score: number;
    content: string;
    filePath: string;
    chunkIndex: number;
}
export declare class EmbeddingsService {
    private ai;
    private vectorize;
    private db;
    constructor(ai: Ai, vectorize: VectorizeIndex, db: D1Database);
    generateEmbedding(text: string): Promise<number[]>;
    generateEmbeddings(texts: string[]): Promise<number[][]>;
    splitIntoChunks(content: string): string[];
    indexFile(spaceId: string, file: SpaceFile, content: string): Promise<number>;
    removeFile(spaceId: string, fileId: string): Promise<void>;
    search(spaceId: string, query: string, options?: {
        limit?: number;
        fileTypes?: string[];
        minScore?: number;
    }): Promise<EmbeddingSearchResult[]>;
    findSimilar(spaceId: string, content: string, options?: {
        limit?: number;
        excludeFileId?: string;
        minScore?: number;
    }): Promise<EmbeddingSearchResult[]>;
    indexWorkspace(spaceId: string, storage: R2Bucket | undefined, options?: {
        forceReindex?: boolean;
    }): Promise<{
        indexed: number;
        chunks: number;
        errors: string[];
    }>;
    indexRepoFiles(repoId: string, bucket: R2Bucket, treeOid: string): Promise<{
        indexed: number;
        chunks: number;
        errors: string[];
    }>;
    searchRepo(repoId: string, query: string, options?: {
        limit?: number;
        minScore?: number;
        pathPrefix?: string;
    }): Promise<RepoSearchResult[]>;
}
export declare function createEmbeddingsService(env: Pick<Env, 'AI' | 'VECTORIZE' | 'DB'>): EmbeddingsService | null;
export declare function isEmbeddingsAvailable(env: Pick<Env, 'AI' | 'VECTORIZE'>): boolean;
//# sourceMappingURL=embeddings.d.ts.map