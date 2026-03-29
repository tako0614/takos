import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { EmbeddingsService } from '../../../application/services/execution/embeddings';
export declare function runIndexJob(db: D1Database, storage: R2Bucket | undefined, jobId: string, embeddingsService?: EmbeddingsService | null): Promise<void>;
export declare function indexFile(db: D1Database, storage: R2Bucket | undefined, spaceId: string, fileId: string, jobId: string, embeddingsService?: EmbeddingsService | null): Promise<void>;
//# sourceMappingURL=jobs.d.ts.map