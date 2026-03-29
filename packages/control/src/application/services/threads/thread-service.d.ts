import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env, Message, MessageRole, Run, Thread, ThreadStatus, SpaceRole } from '../../../shared/types';
export interface ThreadAccess {
    thread: Thread;
    role: SpaceRole;
}
export declare function checkThreadAccess(dbBinding: D1Database, threadId: string, userId: string, requiredRole?: SpaceRole[]): Promise<ThreadAccess | null>;
export declare function listThreads(dbBinding: D1Database, spaceId: string, options: {
    status?: ThreadStatus;
}): Promise<Thread[]>;
export declare function createThread(dbBinding: D1Database, spaceId: string, input: {
    title?: string;
    locale?: 'ja' | 'en' | null;
}): Promise<Thread | null>;
export declare function updateThread(dbBinding: D1Database, threadId: string, updates: {
    title?: string | null;
    locale?: 'ja' | 'en' | null;
    status?: ThreadStatus;
    context_window?: number;
}): Promise<Thread | null>;
export declare function updateThreadStatus(dbBinding: D1Database, threadId: string, status: ThreadStatus): Promise<void>;
export declare function deleteThread(_env: Env, dbBinding: D1Database, threadId: string): Promise<void>;
export declare function listThreadMessages(env: Env, dbBinding: D1Database, threadId: string, limit: number, offset: number): Promise<{
    messages: Message[];
    total: number;
    runs: Run[];
}>;
export declare function createMessage(env: Env, dbBinding: D1Database, thread: Thread, input: {
    role: MessageRole;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string | null;
    metadata?: Record<string, unknown>;
}): Promise<Message | null>;
//# sourceMappingURL=thread-service.d.ts.map