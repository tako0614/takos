import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env, SpaceFile } from '../../../shared/types';
export type SearchType = 'filename' | 'content' | 'semantic' | 'all';
export interface SearchRequestBody {
    query: string;
    type?: SearchType;
    file_types?: string[];
    limit?: number;
}
export interface ContentMatch {
    line: number;
    content: string;
    highlight: {
        start: number;
        end: number;
    }[];
}
export interface CodeSearchResult {
    type: 'file' | 'content' | 'semantic';
    file: SpaceFile;
    matches?: ContentMatch[];
    score?: number;
    semanticContent?: string;
}
export declare function searchWorkspace(params: {
    env: Env;
    spaceId: string;
    query: string;
    searchType?: SearchType;
    fileTypes?: string[];
    limit?: number;
}): Promise<{
    results: CodeSearchResult[];
    total: number;
    semanticAvailable: boolean;
}>;
export declare function quickSearchPaths(d1: D1Database, spaceId: string, query: string): Promise<string[]>;
export declare function searchFilenames(d1: D1Database, spaceId: string, query: string, fileTypes?: string[], limit?: number): Promise<CodeSearchResult[]>;
export declare function searchContent(d1: D1Database, storage: R2Bucket | undefined, spaceId: string, query: string, fileTypes?: string[], limit?: number): Promise<CodeSearchResult[]>;
//# sourceMappingURL=search.d.ts.map