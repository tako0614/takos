/**
 * Pull request helpers for the agent workflow system.
 *
 * Handles PR creation and merge operations against the D1 database.
 */
import type { WorkflowContext } from './workflow-types';
export declare function createPullRequest(context: WorkflowContext, options: {
    repoId: string;
    title: string;
    description: string;
    headBranch: string;
    baseBranch: string;
}): Promise<string>;
export declare function mergePullRequest(context: WorkflowContext, prId: string): Promise<void>;
//# sourceMappingURL=workflow-pr.d.ts.map