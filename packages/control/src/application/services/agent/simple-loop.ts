/**
 * Simple LLM loop and no-LLM fallback execution modes for the Agent Runner.
 *
 * These are fallback execution paths when LangGraph is unavailable or
 * when no LLM API key is configured.
 */

import type { AgentConfig, AgentEvent, AgentMessage } from "./agent-models.ts";
import type { RunTerminalPayload } from "../run-notifier/index.ts";
import type { LLMClient } from "./llm.ts";
import type { ToolExecutorLike } from "../../tools/executor.ts";
import type { ToolExecution } from "./runner-utils.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { RunStatus } from "../../../shared/types/index.ts";
import type { AgentMemoryRuntime } from "../memory-graph/memory-graph-runtime.ts";
import type {
  SkillCatalogEntry,
  SkillContext,
  SkillSelection,
} from "./skills.ts";
import { buildSkillEnhancedPrompt } from "./skills.ts";
import { getTimeoutConfig } from "./runner-config.ts";
import { withTimeout } from "../../../shared/utils/with-timeout.ts";
import {
  addToolExecution,
  anySignal,
  MAX_TOTAL_TOOL_CALLS,
  redactSensitiveArgs,
} from "./runner-utils.ts";

export interface SimpleLoopDeps {
  env: Env;
  config: AgentConfig;
  llmClient: LLMClient;
  toolExecutor: ToolExecutorLike | undefined;
  skillLocale: "ja" | "en";
  availableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
  spaceId: string;
  abortSignal?: AbortSignal;
  toolExecutions: ToolExecution[];
  totalUsage: { inputTokens: number; outputTokens: number };
  toolCallCount: number;
  totalToolCalls: number;
  memoryRuntime?: AgentMemoryRuntime;

  // Callbacks
  throwIfCancelled: (context: string) => Promise<void>;
  emitEvent: (
    type: AgentEvent["type"],
    data: Record<string, unknown>,
  ) => Promise<void>;
  addMessage: (
    message: AgentMessage,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  updateRunStatus: (
    status: RunStatus,
    output?: string,
    error?: string,
  ) => Promise<void>;
  buildTerminalEventPayload: (
    status: "completed" | "failed" | "cancelled",
    details?: Record<string, unknown>,
  ) => RunTerminalPayload;
  getConversationHistory: () => Promise<AgentMessage[]>;
}

/**
 * Run with simple LLM loop (no LangGraph).
 */
export async function runWithSimpleLoop(deps: SimpleLoopDeps): Promise<void> {
  const history = await deps.getConversationHistory();
  const enhancedPrompt = buildSkillEnhancedPrompt(
    deps.config.systemPrompt,
    {
      locale: deps.skillLocale,
      availableSkills: deps.availableSkills,
      selectableSkills: deps.availableSkills.filter((skill) =>
        skill.availability !== "unavailable"
      ),
      selectedSkills: deps.selectedSkills,
      activatedSkills: deps.activatedSkills,
    },
    deps.spaceId,
  );

  const messages: AgentMessage[] = [
    { role: "system", content: enhancedPrompt },
    ...history,
  ];

  let iteration = 0;
  const runStartTime = Date.now();
  const maxIterations = deps.config.maxIterations || 10;
  const timeoutConfig = getTimeoutConfig(deps.env);
  const totalTimeoutMs = timeoutConfig.totalTimeout;
  const iterationTimeoutMs = timeoutConfig.iterationTimeout;

  while (iteration < maxIterations) {
    await deps.throwIfCancelled("iteration");
    // Check total run timeout
    const elapsed = Date.now() - runStartTime;
    if (elapsed > totalTimeoutMs) {
      const timeoutMinutes = Math.round(totalTimeoutMs / 60000);
      throw new Error(`Run timed out after ${timeoutMinutes} minutes`);
    }

    iteration++;
    await deps.emitEvent("thinking", {
      iteration,
      message: "Processing...",
      engine: "simple",
    });

    // Refresh active memory before each LLM call
    if (deps.memoryRuntime) {
      const activation = deps.memoryRuntime.beforeModel();
      if (activation.hasContent) {
        // Find or insert [ACTIVE_MEMORY] marker in messages
        const markerIndex = messages.findIndex((m) =>
          m.role === "system" && m.content.includes("[ACTIVE_MEMORY]")
        );
        const memoryMessage: AgentMessage = {
          role: "system",
          content: `[ACTIVE_MEMORY]\n${activation.segment}`,
        };
        if (markerIndex >= 0) {
          messages[markerIndex] = memoryMessage;
        } else {
          // Insert after the first system message (base prompt)
          messages.splice(1, 0, memoryMessage);
        }
      }
    }

    // Add timeout to LLM call to prevent stuck iterations
    const response = await withTimeout(
      (signal) => {
        const combinedSignal = deps.abortSignal && signal
          ? anySignal([deps.abortSignal, signal])
          : deps.abortSignal || signal;
        return deps.llmClient.chat(messages, deps.config.tools, combinedSignal);
      },
      iterationTimeoutMs,
      `LLM call timed out after ${
        iterationTimeoutMs / 1000
      } seconds (iteration ${iteration})`,
    );

    deps.totalUsage.inputTokens += response.usage.inputTokens;
    deps.totalUsage.outputTokens += response.usage.outputTokens;

    if (response.toolCalls && response.toolCalls.length > 0) {
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls,
      };
      messages.push(assistantMsg);
      await deps.addMessage(assistantMsg);

      for (const toolCall of response.toolCalls) {
        await deps.throwIfCancelled("tool-call");
        // Rate limit check
        deps.toolCallCount++;
        const rateLimit = deps.config.rateLimit;
        if (rateLimit && deps.toolCallCount > rateLimit) {
          const errorMsg =
            `Rate limit exceeded: ${deps.toolCallCount} tool calls (max: ${rateLimit})`;
          throw new Error(errorMsg);
        }

        // Security: Hard limit on total tool calls per run
        deps.totalToolCalls++;
        if (deps.totalToolCalls > MAX_TOTAL_TOOL_CALLS) {
          const errorMsg =
            `Total tool call limit exceeded: ${deps.totalToolCalls} (max: ${MAX_TOTAL_TOOL_CALLS})`;
          throw new Error(errorMsg);
        }

        const toolStartTime = Date.now();
        // Security: Redact sensitive arguments before logging/emitting
        const redactedArgs = redactSensitiveArgs(toolCall.arguments);
        await deps.emitEvent("tool_call", {
          tool: toolCall.name,
          arguments: redactedArgs,
          tool_call_id: toolCall.id,
        });

        if (!deps.toolExecutor) {
          throw new Error("Tool executor not initialized");
        }
        const result = await deps.toolExecutor.execute({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        const toolDuration = Date.now() - toolStartTime;

        addToolExecution(deps.toolExecutions, {
          name: toolCall.name,
          arguments: toolCall.arguments,
          result: result.error ? undefined : result.output,
          error: result.error,
          startedAt: toolStartTime,
          duration_ms: toolDuration,
        });

        await deps.emitEvent("tool_result", {
          tool: toolCall.name,
          output: result.output,
          error: result.error,
          tool_call_id: toolCall.id,
        });

        const toolMsg: AgentMessage = {
          role: "tool",
          content: result.error || result.output,
          tool_call_id: toolCall.id,
        };
        messages.push(toolMsg);
        await deps.addMessage(toolMsg);
      }
      continue;
    }

    await deps.throwIfCancelled("before-complete");
    // Final response with tool executions metadata
    const finalMsg: AgentMessage = {
      role: "assistant",
      content: response.content,
    };

    const messageMetadata: Record<string, unknown> = {};
    if (deps.toolExecutions.length > 0) {
      messageMetadata.tool_executions = deps.toolExecutions.map((exec) => ({
        name: exec.name,
        arguments: exec.arguments,
        result: exec.result
          ? (exec.result.length > 500
            ? exec.result.slice(0, 500) + "..."
            : exec.result)
          : undefined,
        error: exec.error,
        duration_ms: exec.duration_ms,
      }));
      deps.toolExecutions.length = 0;
    }

    await deps.addMessage(finalMsg, messageMetadata);
    await deps.emitEvent("message", { content: response.content });

    await deps.updateRunStatus(
      "completed",
      JSON.stringify({
        response: response.content,
        iterations: iteration,
        engine: "simple",
      }),
    );
    await deps.emitEvent("completed", {
      ...deps.buildTerminalEventPayload("completed", {
        success: true,
        iterations: iteration,
        engine: "simple",
      }),
    });
    return;
  }

  await deps.updateRunStatus(
    "completed",
    JSON.stringify({
      message: "Max iterations reached",
      iterations: iteration,
      engine: "simple",
    }),
  );
  await deps.emitEvent("completed", {
    ...deps.buildTerminalEventPayload("completed", {
      success: true,
      maxIterations: true,
    }),
  });
}

export interface NoLLMDeps {
  toolExecutor: ToolExecutorLike | undefined;
  emitEvent: (
    type: AgentEvent["type"],
    data: Record<string, unknown>,
  ) => Promise<void>;
  addMessage: (
    message: AgentMessage,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  updateRunStatus: (
    status: RunStatus,
    output?: string,
    error?: string,
  ) => Promise<void>;
  buildTerminalEventPayload: (
    status: "completed" | "failed" | "cancelled",
    details?: Record<string, unknown>,
  ) => RunTerminalPayload;
}

/**
 * Run without LLM (fallback mode).
 */
export async function runWithoutLLM(
  deps: NoLLMDeps,
  history: AgentMessage[],
): Promise<void> {
  await deps.emitEvent("thinking", { message: "Processing (no LLM)..." });

  const lastUserMessage = history.filter((m) => m.role === "user").pop();
  const userQuery = lastUserMessage?.content || "No message provided";

  // Simple pattern matching
  const response = await generateSimpleResponse(deps.toolExecutor, userQuery);

  await deps.addMessage({
    role: "assistant",
    content: response,
  });

  await deps.emitEvent("message", { content: response });
  await deps.updateRunStatus(
    "completed",
    JSON.stringify({ response, mode: "no-llm" }),
  );
  await deps.emitEvent("completed", {
    ...deps.buildTerminalEventPayload("completed", {
      success: true,
      mode: "no-llm",
    }),
  });
}

/**
 * Generate a simple response without LLM.
 */
async function generateSimpleResponse(
  toolExecutor: ToolExecutorLike | undefined,
  query: string,
): Promise<string> {
  if (!toolExecutor) {
    return "Tool executor not available. Please try again.";
  }

  const queryLower = query.toLowerCase();

  if (queryLower.includes("list files") || queryLower.includes("show files")) {
    const result = await toolExecutor.execute({
      id: "simple-file-list",
      name: "file_list",
      arguments: { path: "" },
    });
    if (result.error) {
      return `Error listing files: ${result.error}`;
    }
    return `Here are the files in your space:\n\n${result.output}`;
  }

  if (queryLower.includes("read file") || queryLower.includes("show file")) {
    const pathMatch = query.match(/['"]([^'"]+)['"]/);
    if (pathMatch) {
      const result = await toolExecutor.execute({
        id: "simple-file-read",
        name: "file_read",
        arguments: { path: pathMatch[1] },
      });
      if (result.error) {
        return `Error reading file: ${result.error}`;
      }
      return `Content of ${pathMatch[1]}:\n\n\`\`\`\n${result.output}\n\`\`\``;
    }
    return "Please specify a file path, e.g., \"read file 'packages/control/src/web.ts'\"";
  }

  if (queryLower.includes("search for") || queryLower.includes("find")) {
    const searchMatch = query.match(
      /(?:search for|find)\s+['"]?([^'"]+)['"]?/i,
    );
    if (searchMatch) {
      const result = await toolExecutor.execute({
        id: "simple-search",
        name: "search",
        arguments: { query: searchMatch[1], type: "filename" },
      });
      return result.output;
    }
  }

  return `I understand you're asking about: "${query}"\n\n` +
    `I'm an AI agent that can help you with:\n` +
    `- Reading and writing files\n` +
    `- Searching your space\n` +
    `- Deploying workers\n` +
    `- Running build commands\n` +
    `- Working with repositories and containers\n` +
    `- Remembering information\n` +
    `- Creating code and documentation\n\n` +
    `Try asking me to "list files" or "read file 'path/to/file'".\n\n` +
    `Note: LLM API key not configured. Running in limited mode.`;
}
