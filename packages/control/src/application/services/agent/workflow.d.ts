/**
 * Agent workflow orchestration.
 *
 * This module is the entry point for the agent workflow system. It provides:
 * - Task analysis (LLM-based classification of user tasks)
 * - Code-change workflow execution
 * - Top-level orchestration that routes tasks to the appropriate workflow
 *
 * Sub-concerns are delegated to sibling modules:
 * - workflow-types.ts  -- shared types, helpers, and prompt templates
 * - workflow-review.ts -- AI code review
 * - workflow-pr.ts     -- pull request creation and merge
 * - workflow-session.ts -- runtime session management
 */
export type { TaskStep, TaskPlan, WorkflowContext, WorkflowResult, ReviewResult, ReviewIssue, } from './workflow-types';
import type { TaskPlan, WorkflowContext, WorkflowResult } from './workflow-types';
export { executeReview } from './workflow-review';
export { startWorkflowSession, commitWorkflowSession } from './workflow-session';
export declare function analyzeTask(task: string, context: {
    spaceId: string;
    userId: string;
    tools: string[];
    apiKey: string;
    model?: string;
}): Promise<TaskPlan>;
export declare function executeCodeChangeWorkflow(task: string, plan: TaskPlan, context: WorkflowContext): Promise<WorkflowResult>;
export declare function orchestrateWorkflow(task: string, context: WorkflowContext & {
    apiKey: string;
    tools: string[];
    model?: string;
}): Promise<WorkflowResult>;
//# sourceMappingURL=workflow.d.ts.map