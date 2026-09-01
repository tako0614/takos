/**
 * Agent task analysis.
 *
 * LLM-based classification of a user task into a {@link TaskPlan}. This is the
 * only live entry point of the former agent workflow-orchestration subsystem;
 * the code-change / review / PR / session orchestration modules were unused and
 * have been removed.
 */

import type { AgentMessage } from "./agent-models.ts";
import { LLMClient } from "./llm.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  AGENT_TASK_PLAN_TYPES,
  parseAgentTaskPlan,
  type AgentTaskPlan,
} from "../../../shared/types/agent-task-plan.ts";

// ── Public types ────────────────────────────────────────────────────────

export type TaskPlan = AgentTaskPlan;

/** Valid task plan types. */
export const VALID_PLAN_TYPES: ReadonlySet<string> = new Set(
  AGENT_TASK_PLAN_TYPES,
);

// ── Prompt ──────────────────────────────────────────────────────────────

export const TASK_ANALYSIS_PROMPT = `You are a task analyzer for an AI agent system. Analyze the user's task and determine the best approach to complete it.

Available tools: {tools}

Analyze the task and return a JSON object with:
- type: "conversation" | "tool_only" | "code_change" | "composite"
  - conversation: Simple Q&A, explanations, discussions
  - tool_only: Tasks that only need listed tool calls (for example, an external MCP Web search or attachment read)
  - code_change: Tasks requiring file modifications
  - composite: Complex tasks needing multiple approaches
- tools: Array of tool names that might be needed
- needsRepo: Boolean - does this task involve a git repository?
- needsRuntime: Boolean - does this need an installed external compute capability (npm, build, etc.)?
- usePR: Boolean - should changes go through a PR workflow?
- needsReview: Boolean - should changes be reviewed before merging?
- reviewType: "self" | "separate_ai" - who reviews (self = same conversation, separate_ai = new AI session)
- commitMessage: Suggested commit message if applicable
- reasoning: Brief explanation of your decision

Respond ONLY with valid JSON, no markdown or other text.

User task: {task}`;

// ── Task analysis ───────────────────────────────────────────────────────

export const taskAnalysisDeps = {
  LLMClient,
  logError,
};

export async function analyzeTask(
  task: string,
  context: {
    tools: string[];
    apiKey: string;
    model?: string;
    baseUrl?: string;
  },
): Promise<TaskPlan> {
  const llm = new taskAnalysisDeps.LLMClient({
    apiKey: context.apiKey,
    ...(context.model ? { model: context.model } : undefined),
    ...(context.baseUrl ? { baseUrl: context.baseUrl } : undefined),
  });

  const prompt = TASK_ANALYSIS_PROMPT.replace(
    "{tools}",
    context.tools.join(", "),
  ).replace("{task}", task);

  const messages: AgentMessage[] = [
    {
      role: "system",
      content: "You are a task analyzer. Return only valid JSON.",
    },
    { role: "user", content: prompt },
  ];

  try {
    const response = await llm.chat(messages);
    const jsonBody = response.content.trim().startsWith("{")
      ? response.content.trim()
      : response.content
          .trim()
          .replace(/```json?\n?/g, "")
          .replace(/```/g, "")
          .trim();
    const plan = parseAgentTaskPlan(JSON.parse(jsonBody));
    if (!plan) throw new Error("Task analyzer returned an invalid plan shape");

    const availableTools = new Set(context.tools);
    return {
      ...plan,
      tools: plan.tools.filter((tool) => availableTools.has(tool)),
    };
  } catch (error) {
    taskAnalysisDeps.logError("Task analysis failed", error, {
      module: "services/agent/task-analysis",
    });
    return {
      type: "conversation",
      tools: [],
      needsRepo: false,
      needsRuntime: false,
      usePR: false,
      needsReview: false,
      reviewType: "self",
      reasoning: "Analysis failed, defaulting to conversation",
    };
  }
}
