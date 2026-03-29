/**
 * Session management for the agent workflow system.
 *
 * Handles starting runtime sessions, snapshotting workspace state,
 * and committing session results back to the account.
 */
import type { WorkflowContext } from './workflow-types';
export declare function startWorkflowSession(context: WorkflowContext, needsRuntime: boolean): Promise<{
    sessionId: string;
    snapshotId: string;
}>;
export declare function commitWorkflowSession(context: WorkflowContext, message: string): Promise<{
    snapshotId: string;
    hash?: string;
}>;
//# sourceMappingURL=workflow-session.d.ts.map