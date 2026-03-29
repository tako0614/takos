import type { Env } from '../../../shared/types';
export declare function getThreadTimeline(env: Env, threadId: string, limit: number, offset: number): Promise<{
    messages: import("../../../shared/types").Message[];
    total: number;
    limit: number;
    offset: number;
    activeRun: import("../../../shared/types").Run | null;
    pendingSessionDiff: {
        sessionId: string;
        sessionStatus: string;
        git_mode: boolean;
    } | null;
}>;
//# sourceMappingURL=thread-timeline.d.ts.map