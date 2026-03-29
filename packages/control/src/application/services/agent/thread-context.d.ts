import type { DbEnv, AiEnv } from '../../../shared/types';
type ThreadContextEnv = DbEnv & AiEnv;
import type { AgentMessage } from './agent-models';
export declare const THREAD_MESSAGE_VECTOR_KIND = "thread_message";
export declare const DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB = 200;
export type RetrievedThreadMessage = {
    id: string;
    score: number;
    sequence: number;
    role: string;
    content: string;
    createdAt?: string;
    messageId?: string;
};
export declare function queryRelevantThreadMessages(params: {
    env: ThreadContextEnv;
    spaceId: string;
    threadId: string;
    query: string;
    topK: number;
    minScore: number;
    beforeSequence?: number;
    excludeSequences?: Set<number>;
}): Promise<RetrievedThreadMessage[]>;
export declare function indexThreadContext(params: {
    env: ThreadContextEnv;
    spaceId: string;
    threadId: string;
    maxMessages?: number;
}): Promise<{
    embedded: number;
    lastSequence: number;
    hasMore: boolean;
    summaryUpdated: boolean;
}>;
export declare function buildThreadContextSystemMessage(params: {
    summary: string | null;
    keyPointsJson: string;
    retrieved: RetrievedThreadMessage[];
    maxChars: number;
}): AgentMessage | null;
export {};
//# sourceMappingURL=thread-context.d.ts.map