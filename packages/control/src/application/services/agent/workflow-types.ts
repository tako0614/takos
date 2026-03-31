/**
 * Type definitions and prompt templates for the agent workflow system.
 *
 * Extracted from workflow.ts to keep each module focused on a single concern.
 */

import type { Env } from '../../../shared/types/index.ts';

// ── Public types ────────────────────────────────────────────────────────

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

// ── Shared helpers ──────────────────────────────────────────────────────

/** Valid task plan types. */
export const VALID_PLAN_TYPES: ReadonlySet<string> = new Set([
  'conversation', 'tool_only', 'code_change', 'composite',
]);

/** Response shape returned by the runtime snapshot endpoint. */
export interface RuntimeSnapshotResponse {
  files: Array<{ path: string; content: string; size: number }>;
}

// ── Prompts ─────────────────────────────────────────────────────────────

export const TASK_ANALYSIS_PROMPT = `You are a task analyzer for an AI agent system. Analyze the user's task and determine the best approach to complete it.

Available tools: {tools}

Analyze the task and return a JSON object with:
- type: "conversation" | "tool_only" | "code_change" | "composite"
  - conversation: Simple Q&A, explanations, discussions
  - tool_only: Tasks that only need tool calls (web search, file reading, etc.)
  - code_change: Tasks requiring file modifications
  - composite: Complex tasks needing multiple approaches
- tools: Array of tool names that might be needed
- needsRepo: Boolean - does this task involve a git repository?
- needsRuntime: Boolean - does this need runtime container execution (npm, build, etc.)?
- usePR: Boolean - should changes go through a PR workflow?
- needsReview: Boolean - should changes be reviewed before merging?
- reviewType: "self" | "separate_ai" - who reviews (self = same conversation, separate_ai = new AI session)
- commitMessage: Suggested commit message if applicable
- reasoning: Brief explanation of your decision

Respond ONLY with valid JSON, no markdown or other text.

User task: {task}`;

export const REVIEW_PROMPT = `You are a code reviewer. Review the following changes and provide feedback.

Changes (diff):
{diff}

Original task:
{task}

Provide a thorough review including:
1. Overall assessment (approved, changes_requested, or commented)
2. Any bugs or issues found
3. Code quality concerns
4. Security considerations
5. Suggestions for improvement

Return a JSON object with:
- status: "approved" | "changes_requested" | "commented"
- summary: Brief overall assessment
- issues: Array of { severity: "error"|"warning"|"info", file?: string, line?: number, message: string, suggestion?: string }
- suggestions: Array of improvement suggestions

Respond ONLY with valid JSON.`;
