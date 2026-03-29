import type { Env, ThreadStatus } from '../../../shared/types';
export declare function searchSpaceThreads(options: {
    env: Env;
    spaceId: string;
    query: string;
    type: string;
    limit: number;
    offset: number;
}): Promise<{
    query: string;
    type: string;
    results: {
        kind: "keyword" | "semantic";
        score?: number;
        thread: {
            id: string;
            title: string | null;
            status: ThreadStatus;
            updated_at: string;
            created_at: string;
        };
        message: {
            id: string;
            sequence: number;
            role: string;
            created_at: string;
        };
        snippet: string;
        match?: {
            start: number;
            end: number;
        } | null;
    }[];
    limit: number;
    offset: number;
    semantic_available: boolean;
}>;
export declare function searchThreadMessages(options: {
    env: Env;
    spaceId: string;
    threadId: string;
    query: string;
    type: string;
    limit: number;
    offset: number;
}): Promise<{
    query: string;
    type: string;
    results: {
        kind: "keyword" | "semantic";
        score?: number;
        message: {
            id: string;
            sequence: number;
            role: string;
            created_at: string;
        };
        snippet: string;
        match?: {
            start: number;
            end: number;
        } | null;
    }[];
    limit: number;
    offset: number;
    semantic_available: boolean;
}>;
//# sourceMappingURL=thread-search.d.ts.map