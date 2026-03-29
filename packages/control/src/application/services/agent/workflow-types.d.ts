/**
 * Type definitions and prompt templates for the agent workflow system.
 *
 * Extracted from workflow.ts to keep each module focused on a single concern.
 */
import type { Env } from '../../../shared/types';
export interface TaskStep {
    id: string;
    type: 'tool_call' | 'code_change' | 'review' | 'commit' | 'pr_create' | 'pr_merge';
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    result?: string;
    error?: string;
}
export interface TaskPlan {
    type: 'conversation' | 'tool_only' | 'code_change' | 'composite';
    tools?: string[];
    needsRepo?: boolean;
    repoId?: string;
    needsRuntime?: boolean;
    usePR?: boolean;
    needsReview?: boolean;
    reviewType?: 'self' | 'separate_ai';
    commitMessage?: string;
    steps?: TaskStep[];
    reasoning?: string;
}
export interface WorkflowContext {
    env: Env;
    spaceId: string;
    userId: string;
    threadId: string;
    runId: string;
    sessionId?: string;
    repoId?: string;
}
export interface WorkflowResult {
    success: boolean;
    message: string;
    prId?: string;
    commitHash?: string;
    reviewResult?: ReviewResult;
    steps?: TaskStep[];
}
export interface ReviewResult {
    status: 'approved' | 'changes_requested' | 'commented';
    summary: string;
    issues: ReviewIssue[];
    suggestions: string[];
}
export interface ReviewIssue {
    severity: 'error' | 'warning' | 'info';
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
}
/** Valid task plan types. */
export declare const VALID_PLAN_TYPES: ReadonlySet<string>;
/** Response shape returned by the runtime snapshot endpoint. */
export interface RuntimeSnapshotResponse {
    files: Array<{
        path: string;
        content: string;
        size: number;
    }>;
}
export declare const TASK_ANALYSIS_PROMPT = "You are a task analyzer for an AI agent system. Analyze the user's task and determine the best approach to complete it.\n\nAvailable tools: {tools}\n\nAnalyze the task and return a JSON object with:\n- type: \"conversation\" | \"tool_only\" | \"code_change\" | \"composite\"\n  - conversation: Simple Q&A, explanations, discussions\n  - tool_only: Tasks that only need tool calls (web search, file reading, etc.)\n  - code_change: Tasks requiring file modifications\n  - composite: Complex tasks needing multiple approaches\n- tools: Array of tool names that might be needed\n- needsRepo: Boolean - does this task involve a git repository?\n- needsRuntime: Boolean - does this need runtime container execution (npm, build, etc.)?\n- usePR: Boolean - should changes go through a PR workflow?\n- needsReview: Boolean - should changes be reviewed before merging?\n- reviewType: \"self\" | \"separate_ai\" - who reviews (self = same conversation, separate_ai = new AI session)\n- commitMessage: Suggested commit message if applicable\n- reasoning: Brief explanation of your decision\n\nRespond ONLY with valid JSON, no markdown or other text.\n\nUser task: {task}";
export declare const REVIEW_PROMPT = "You are a code reviewer. Review the following changes and provide feedback.\n\nChanges (diff):\n{diff}\n\nOriginal task:\n{task}\n\nProvide a thorough review including:\n1. Overall assessment (approved, changes_requested, or commented)\n2. Any bugs or issues found\n3. Code quality concerns\n4. Security considerations\n5. Suggestions for improvement\n\nReturn a JSON object with:\n- status: \"approved\" | \"changes_requested\" | \"commented\"\n- summary: Brief overall assessment\n- issues: Array of { severity: \"error\"|\"warning\"|\"info\", file?: string, line?: number, message: string, suggestion?: string }\n- suggestions: Array of improvement suggestions\n\nRespond ONLY with valid JSON.";
//# sourceMappingURL=workflow-types.d.ts.map