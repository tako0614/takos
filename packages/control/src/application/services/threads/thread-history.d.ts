import type { Env, ThreadHistoryFocus, ThreadHistoryRunNode, ThreadHistoryTaskContext } from '../../../shared/types';
import { listThreadMessages } from './thread-service';
type PendingSessionDiffSummary = {
    sessionId: string;
    sessionStatus: string;
    git_mode: boolean;
} | null;
export declare function getThreadHistory(env: Env, threadId: string, options: {
    limit: number;
    offset: number;
    includeMessages?: boolean;
    rootRunId?: string | null;
}): Promise<{
    messages: Awaited<ReturnType<typeof listThreadMessages>>['messages'];
    total: number;
    limit: number;
    offset: number;
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus;
    activeRun: ThreadHistoryRunNode['run'] | null;
    pendingSessionDiff: PendingSessionDiffSummary;
    taskContext: ThreadHistoryTaskContext | null;
}>;
export {};
//# sourceMappingURL=thread-history.d.ts.map