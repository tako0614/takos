/**
 * Code review logic for the agent workflow system.
 *
 * Handles AI-powered pull request reviews including diff generation,
 * LLM-based analysis, and review persistence.
 */
import type { WorkflowContext, ReviewResult } from './workflow-types';
export declare function executeReview(context: WorkflowContext, prId: string, reviewType: 'self' | 'separate_ai'): Promise<ReviewResult>;
export declare function getPRDiff(context: WorkflowContext, pr: {
    repoId: string;
    number: number;
    title: string;
    headBranch: string;
    baseBranch: string;
}): Promise<string>;
//# sourceMappingURL=workflow-review.d.ts.map