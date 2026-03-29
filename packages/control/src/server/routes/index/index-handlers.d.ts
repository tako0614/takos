import type { IndexContext, IndexFileBody, VectorizeIndexBody } from './index-context';
export declare function handleIndexStatus(c: IndexContext): Promise<Response>;
export declare function handleVectorizeIndex(c: IndexContext, body: VectorizeIndexBody): Promise<Response>;
export declare function handleRebuildIndex(c: IndexContext): Promise<Response>;
export declare function handleIndexFile(c: IndexContext, body: IndexFileBody | null): Promise<Response>;
//# sourceMappingURL=index-handlers.d.ts.map