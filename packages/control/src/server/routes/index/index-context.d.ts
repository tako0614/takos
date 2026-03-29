import type { AppContext, BaseVariables } from '../route-auth';
export type IndexContext = AppContext<BaseVariables>;
export type VectorizeIndexBody = {
    force_reindex?: boolean;
};
export type IndexFileBody = {
    path: string;
};
export declare function scheduleBackground(c: IndexContext, task: Promise<unknown>): void;
export declare function getR2Key(spaceId: string, fileId: string): string;
export declare function chunkContent(content: string, maxChunkSize?: number): Array<{
    startLine: number;
    endLine: number;
    content: string;
}>;
export declare function resolvePath(from: string, to: string): string;
//# sourceMappingURL=index-context.d.ts.map