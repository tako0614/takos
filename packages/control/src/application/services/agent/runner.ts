/**
 * Agent Runner - Executes agent runs with LangGraph
 *
 * Uses LangGraph.js for stateful agent execution with tool calling.
 *
 * This file contains the AgentRunner class and event emission helpers.
 * Helper logic is split into:
 *   - runner-types.ts   : constants, utility functions, shared types
 *   - session-closer.ts : auto-close session (snapshot + file sync)
 *   - skills.ts         : skill loading, resolution, and context
 *   - simple-loop.ts    : simple LLM loop and no-LLM fallback
 *   - execute-run.ts    : queue consumer entry point
 */

import type { RunStatus, Env } from '../../../shared/types';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage, ToolCall } from './types';
import type { ToolExecutorLike } from '../../tools/executor';
import { LLMClient, createMultiModelClient, getProviderFromModel, type ModelProvider } from './llm';
import { RunCancelledError } from './run-lifecycle';
import { generateId, safeJsonParseOrDefault } from '../../../shared/utils';
import { runLangGraphRunner } from './langgraph-runner';
import type { SkillCatalogEntry, SkillSelection, SkillContext } from './skills';
import { getAgentConfig } from './runner-config';
import { getDb, runs, runEvents, threads, messages } from '../../../infra/db';
import { and, eq, sql, desc } from 'drizzle-orm';
import { DEFAULT_MODEL_ID, getContextWindowForModel } from './model-catalog';
import type { RunTerminalPayload } from '../run-notifier';
import {
  buildTerminalPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
  buildRunNotifierEmitPayload,
} from '../run-notifier';
import { readMessageFromR2 } from '../offload/messages';
import { buildThreadContextSystemMessage, queryRelevantThreadMessages } from './thread-context';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';
import {
  MAX_EVENT_EMISSION_ERRORS as MAX_EMISSION_ERRORS,
  THREAD_RETRIEVAL_TOP_K,
  THREAD_RETRIEVAL_MIN_SCORE,
  THREAD_CONTEXT_MAX_CHARS,
} from '../../../shared/config/limits';
import {
  handleSuccessfulRunCompletion,
  handleCancelledRun,
  handleFailedRun,
  type RunLifecycleDeps,
} from './run-lifecycle';
import { buildToolCatalogContent } from './prompts';
import { buildBudgetedSystemPrompt, LANE_PRIORITY, LANE_MAX_TOKENS, type PromptLane } from './prompt-budget';

// Extracted modules
import type { ToolExecution, EventEmissionError } from './runner-types';
import { sanitizeErrorMessage } from './runner-types';
import { autoCloseSession as autoCloseSessionImpl } from './session-closer';
import {
  emitSkillLoadOutcome,
  type SkillLoadResult,
} from './skills';
import { runWithSimpleLoop, runWithoutLLM } from './simple-loop';
import { AgentMemoryRuntime } from '../memory-graph/runtime';
import type { AgentMemoryBackend } from '../memory-graph/runtime';
import { RemoteToolExecutor } from './remote-tool-executor';
import {
  buildDelegationSystemMessage,
  buildDelegationUserMessage,
  getDelegationPacketFromRunInput,
} from './delegation';

// Re-export executeRun for backward compatibility (index.ts imports it from here)
export { executeRun } from './execute-run';

// ── Event emission helpers (merged from event-emitter.ts) ──────────

const MAX_EVENT_EMISSION_ERRORS = MAX_EMISSION_ERRORS;

export interface EventEmitterState {
  eventSequence: number;
  pendingEventEmissions: number;
  eventEmissionErrors: EventEmissionError[];
}

export function createEventEmitterState(): EventEmitterState {
  return {
    eventSequence: 0,
    pendingEventEmissions: 0,
    eventEmissionErrors: [],
  };
}

function buildTerminalEventPayloadImpl(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  details: Record<string, unknown>,
  sessionId: string | null,
): RunTerminalPayload {
  return buildTerminalPayload(runId, status, details, sessionId);
}

/**
 * Emit a sequenced event for the run (to DB and WebSocket).
 */
async function emitEventImpl(
  state: EventEmitterState,
  env: Env,
  db: SqlDatabaseBinding,
  runId: string,
  spaceId: string,
  getCurrentSessionId: () => Promise<string | null>,
  type: AgentEvent['type'],
  data: Record<string, unknown>,
  options?: { skipDb?: boolean },
  remoteEmit?: (input: {
    runId: string;
    type: AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }) => Promise<void>,
): Promise<void> {
  const now = new Date().toISOString();
  const sequence = ++state.eventSequence;
  state.pendingEventEmissions++;

  // For terminal events, ensure we have the latest session_id from DB
  let eventData = data;
  if ((type === 'completed' || type === 'error' || type === 'cancelled') && data.run) {
    const sessionId = await getCurrentSessionId();
    eventData = {
      ...data,
      run: {
        ...(data.run as Record<string, unknown>),
        session_id: sessionId,
      },
    };
  }

  const skipDb = options?.skipDb ?? false;
  const offloadEnabled = Boolean(env.TAKOS_OFFLOAD);
  let legacyEventId: number | null = null;
  const isTerminal = type === 'completed' || type === 'error' || type === 'cancelled';

  try {
    if (remoteEmit) {
      await remoteEmit({
        runId,
        type,
        data: eventData,
        sequence,
        skipDb,
      });
      return;
    }

    // Skip D1 write when R2 offload is enabled — the RunNotifierDO writes
    // events to R2 segments, making D1 redundant.
    if (!skipDb && !offloadEnabled) {
      const drizzleDb = getDb(db);
      const persisted = await drizzleDb.insert(runEvents).values({
        runId,
        type,
        data: JSON.stringify({ ...eventData, _sequence: sequence }),
        createdAt: now,
      }).returning({ id: runEvents.id }).get();
      legacyEventId = persisted?.id ?? null;
    }

    const stub = getRunNotifierStub(env, runId);
    const payload = buildRunNotifierEmitPayload(runId, type, eventData, legacyEventId);

    let emitOk = false;
    const doEmit = async () => {
      const emitRes = await stub.fetch(buildRunNotifierEmitRequest(payload));
      if (!emitRes.ok) {
        const body = await emitRes.text().catch(() => '');
        throw new Error(`DO emit non-OK ${emitRes.status}: ${body}`);
      }
      emitOk = true;
    };

    try {
      await doEmit();
    } catch (firstErr) {
      if (isTerminal) {
        const TERMINAL_MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= TERMINAL_MAX_RETRIES; attempt++) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          try {
            await doEmit();
            break;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            if (attempt === TERMINAL_MAX_RETRIES) {
              logError(`CRITICAL: Terminal event '${type}' emit failed after ${TERMINAL_MAX_RETRIES} retries (run=${runId})`, retryMsg, { module: 'emitevent' });
            } else {
              logWarn(`Terminal event '${type}' retry ${attempt}/${TERMINAL_MAX_RETRIES} failed (run=${runId})`, { module: 'emitevent', detail: retryMsg });
            }
          }
        }
      }
      if (!emitOk) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        logError(`DO emit failed for ${type}`, msg, { module: 'emitevent' });
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`Event emission error for ${type} (run=${runId})`, errorMsg, { module: 'emitevent' });
    if (isTerminal) {
      logError(`CRITICAL: Terminal event '${type}' lost for run=${runId}`, undefined, { module: 'emitevent' });
    }

    if (state.eventEmissionErrors.length < MAX_EVENT_EMISSION_ERRORS) {
      state.eventEmissionErrors.push({
        type,
        error: errorMsg,
        timestamp: now,
      });
    }
  } finally {
    state.pendingEventEmissions--;
  }
}

/**
 * Update run status in the database.
 */
export async function updateRunStatusImpl(
  db: SqlDatabaseBinding,
  runId: string,
  totalUsage: { inputTokens: number; outputTokens: number },
  status: RunStatus,
  output?: string,
  error?: string,
): Promise<void> {
  const drizzleDb = getDb(db);
  const now = new Date().toISOString();

  const updateData: {
    status: string;
    startedAt?: string;
    completedAt?: string;
    output?: string;
    error?: string;
    usage: string;
  } = {
    status,
    usage: JSON.stringify(totalUsage),
  };

  if (status === 'running') {
    updateData.startedAt = now;
  }

  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updateData.completedAt = now;
  }

  if (output !== undefined) {
    updateData.output = output;
  }

  if (error !== undefined) {
    updateData.error = error;
  }

  const condition = status === 'cancelled'
    ? eq(runs.id, runId)
    : and(eq(runs.id, runId), sql`${runs.status} != 'cancelled'`);

  await drizzleDb.update(runs).set(updateData).where(condition);
}

// ── Conversation history helpers (merged from conversation-history.ts) ──


/** Type guard to validate tool_calls array structure */
export function isValidToolCallsArray(value: unknown): value is ToolCall[] {
  if (!Array.isArray(value)) return false;
  return value.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const obj = item as Record<string, unknown>;
    return (
      typeof obj.id === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.arguments === 'object' &&
      obj.arguments !== null
    );
  });
}

// THREAD_RETRIEVAL_TOP_K, THREAD_RETRIEVAL_MIN_SCORE, THREAD_CONTEXT_MAX_CHARS
// imported from shared/config/limits

export interface ConversationHistoryDeps {
  db: SqlDatabaseBinding;
  env: Env;
  threadId: string;
  runId: string;
  spaceId: string;
  aiModel: string;
}

export interface AgentRunnerIo {
  getRunBootstrap(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    spaceId: string;
    sessionId: string | null;
    threadId: string;
    userId: string;
    agentType: string;
  }>;
  getRunRecord(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }>;
  getRunStatus(input: { runId: string }): Promise<RunStatus | null>;
  getConversationHistory(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }): Promise<AgentMessage[]>;
  addMessage(input: {
    runId: string;
    threadId: string;
    message: AgentMessage;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  updateRunStatus(input: {
    runId: string;
    status: RunStatus;
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }): Promise<void>;
  getCurrentSessionId(input: { runId: string; spaceId: string }): Promise<string | null>;
  isCancelled(input: { runId: string }): Promise<boolean>;
  resolveSkillPlan(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  }): Promise<SkillLoadResult>;
  getMemoryActivation(input: { spaceId: string }): Promise<import('../memory-graph/types').ActivationResult>;
  finalizeMemoryOverlay(input: {
    runId: string;
    spaceId: string;
    claims: import('../memory-graph/types').Claim[];
    evidence: import('../memory-graph/types').Evidence[];
  }): Promise<void>;
  getToolCatalog(input: { runId: string }): Promise<{
    tools: import('../../tools/types').ToolDefinition[];
    mcpFailedServers: string[];
  }>;
  executeTool(input: {
    runId: string;
    toolCall: import('../../tools/types').ToolCall;
  }): Promise<import('../../tools/types').ToolResult>;
  cleanupToolExecutor(input: { runId: string }): Promise<void>;
  emitRunEvent(input: {
    runId: string;
    type: AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }): Promise<void>;
}

function normalizeRunStatus(value: string | null | undefined): RunStatus | null {
  return value === 'pending'
    || value === 'queued'
    || value === 'running'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
    ? value
    : null;
}

type MessageAttachmentRef = {
  file_id: string;
  path?: string;
  name: string;
  mime_type?: string | null;
  size?: number;
};

function parseMessageAttachmentRefs(metadata: string | null | undefined): MessageAttachmentRef[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const attachments = (parsed as Record<string, unknown>).attachments;
    if (!Array.isArray(attachments)) return [];
    const parsedAttachments: MessageAttachmentRef[] = [];
    for (const entry of attachments) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const value = entry as Record<string, unknown>;
      if (typeof value.file_id !== 'string' || typeof value.name !== 'string') continue;
      parsedAttachments.push({
        file_id: value.file_id,
        path: typeof value.path === 'string' ? value.path : undefined,
        name: value.name,
        mime_type: typeof value.mime_type === 'string' ? value.mime_type : null,
        size: typeof value.size === 'number' ? value.size : undefined,
      });
    }
    return parsedAttachments;
  } catch {
    return [];
  }
}

function appendAttachmentContext(content: string, attachments: MessageAttachmentRef[]): string {
  if (attachments.length === 0) return content;

  const lines = [
    'Attached workspace storage files are available for this message.',
    'Use workspace_files_read with file_id or path if you need to inspect them.',
    ...attachments.map((attachment) => {
      const parts = [
        attachment.path || attachment.name,
        `file_id: ${attachment.file_id}`,
      ];
      if (attachment.mime_type) parts.push(`mime_type: ${attachment.mime_type}`);
      if (typeof attachment.size === 'number') parts.push(`size: ${attachment.size}`);
      return `- ${parts.join(', ')}`;
    }),
  ];

  const attachmentContext = lines.join('\n');
  return content.trim()
    ? `${content}\n\n${attachmentContext}`
    : attachmentContext;
}

export async function buildConversationHistory(deps: ConversationHistoryDeps): Promise<AgentMessage[]> {
  const { db: dbBinding, env, threadId, runId, spaceId, aiModel } = deps;
  const db = getDb(dbBinding);
  const startedAt = Date.now();

  let threadSummary: string | null = null;
  let threadKeyPointsJson = '[]';
  const contextWindow = getContextWindowForModel(aiModel);

  const thread = await db.select({
    summary: threads.summary,
    keyPoints: threads.keyPoints,
  }).from(threads).where(eq(threads.id, threadId)).get();

  if (thread) {
    threadSummary = thread.summary ?? null;
    threadKeyPointsJson = thread.keyPoints || '[]';
  }

  const rows = await db.select({
    id: messages.id,
    role: messages.role,
    content: messages.content,
    r2Key: messages.r2Key,
    toolCalls: messages.toolCalls,
    toolCallId: messages.toolCallId,
    metadata: messages.metadata,
    sequence: messages.sequence,
  }).from(messages).where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.sequence))
    .limit(contextWindow)
    .all();

  rows.reverse(); // chronological

  // Hydrate offloaded message payloads from R2 (best-effort).
  if (env.TAKOS_OFFLOAD) {
    const bucket = env.TAKOS_OFFLOAD;
    const candidates = rows
      .map((m, idx) => ({ idx, key: m.r2Key }))
      .filter((x) => typeof x.key === 'string' && x.key.length > 0) as Array<{ idx: number; key: string }>;

    const concurrency = 20;
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      await Promise.all(batch.map(async ({ idx, key }) => {
        const persisted = await readMessageFromR2(bucket, key);
        if (!persisted) return;
        if (persisted.id !== rows[idx].id) return;
        if (persisted.thread_id !== threadId) return;
        rows[idx].content = persisted.content;
        rows[idx].toolCalls = persisted.tool_calls;
        rows[idx].toolCallId = persisted.tool_call_id;
        rows[idx].metadata = persisted.metadata;
      }));
    }
  }

  const excludeSequences = new Set<number>();
  const oldestRecentSequence = rows.length > 0 ? rows[0].sequence : undefined;
  let lastUserQuery = '';

  const agentMessages: AgentMessage[] = [];

  for (const msg of rows) {
    excludeSequences.add(msg.sequence);
    if (msg.role === 'user') {
      lastUserQuery = appendAttachmentContext(msg.content, parseMessageAttachmentRefs(msg.metadata));
    }

    const attachments = msg.role === 'user'
      ? parseMessageAttachmentRefs(msg.metadata)
      : [];
    const agentMsg: AgentMessage = {
      role: msg.role as AgentMessage['role'],
      content: appendAttachmentContext(msg.content, attachments),
    };

    if (msg.toolCalls) {
      try {
        const parsed = JSON.parse(msg.toolCalls);
        // Type guard: validate tool_calls structure before use
        if (isValidToolCallsArray(parsed)) {
          agentMsg.tool_calls = parsed;
        } else {
          logWarn('Invalid tool_calls structure, skipping', { module: 'services/agent/conversation-history' });
        }
      } catch (parseError) {
        logWarn('Failed to parse tool_calls from message', { module: 'services/agent/conversation-history', error: parseError instanceof Error ? parseError.message : String(parseError) });
        // Skip malformed tool_calls rather than crash
      }
    }

    if (msg.toolCallId) {
      agentMsg.tool_call_id = msg.toolCallId;
    }

    agentMessages.push(agentMsg);
  }

  let retrieved: Awaited<ReturnType<typeof queryRelevantThreadMessages>> = [];
  try {
    retrieved = await queryRelevantThreadMessages({
      env,
      spaceId,
      threadId,
      query: lastUserQuery,
      topK: THREAD_RETRIEVAL_TOP_K,
      minScore: THREAD_RETRIEVAL_MIN_SCORE,
      beforeSequence: oldestRecentSequence,
      excludeSequences,
    });
  } catch (err) {
    logWarn(`Vector search failed for thread ${threadId}`, { module: 'thread_context', detail: err });
  }

  const contextMsg = buildThreadContextSystemMessage({
    summary: threadSummary,
    keyPointsJson: threadKeyPointsJson,
    retrieved,
    maxChars: THREAD_CONTEXT_MAX_CHARS,
  });
  if (contextMsg) {
    agentMessages.unshift(contextMsg);
  }

  // For sub-agent runs: prefer the structured delegation packet over broad parent history inheritance.
  try {
    const runRow = await db.select({
      parentRunId: runs.parentRunId,
      input: runs.input,
    }).from(runs).where(eq(runs.id, runId)).get();
    if (runRow?.parentRunId) {
      const delegationPacket = getDelegationPacketFromRunInput(runRow.input);
      if (delegationPacket) {
        agentMessages.unshift(buildDelegationSystemMessage(delegationPacket));
        agentMessages.push(buildDelegationUserMessage(delegationPacket));
      } else {
        const parsed = safeJsonParseOrDefault<Record<string, unknown> | unknown>(runRow.input || '{}', {});
        const task = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).task
          : null;
        if (typeof task === 'string' && task.trim()) {
          agentMessages.push({
            role: 'user',
            content:
              `[Delegated sub-task from parent agent (run: ${runRow.parentRunId})]\n\n` +
              task.trim(),
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal: if we can't inject the task, the sub-agent still has the thread context
    logWarn(`Failed to inject task for run ${runId}`, { module: 'sub_agent', detail: err });
  }

  // Lightweight benchmark log (helps validate context optimization in production logs).
  try {
    let chars = 0;
    for (const msg of agentMessages) {
      chars += (msg.content || '').length;
      if (msg.tool_calls) {
        chars += JSON.stringify(msg.tool_calls).length;
      }
    }
    const estTokens = Math.ceil(chars / 4);
    const elapsedMs = Date.now() - startedAt;
    logInfo(`built thread=${threadId} window=${contextWindow} ` +
      `recent=${rows.length} retrieved=${retrieved.length} estTokens=${estTokens} ms=${elapsedMs}`, { module: 'thread_context' });
  } catch {
    // ignore
  }

  return agentMessages;
}

// ── AgentRunner class ──────────────────────────────────────────────

export class AgentRunner {
  private db: SqlDatabaseBinding;
  private env: Env;
  private openAiKey: string | undefined;
  private anthropicKey: string | undefined;
  private googleKey: string | undefined;
  private llmClient: LLMClient | undefined;
  private context: AgentContext;
  private config: AgentConfig;
  private toolExecutor: ToolExecutorLike | undefined;
  private totalUsage = { inputTokens: 0, outputTokens: 0 };
  private availableSkills: SkillCatalogEntry[] = [];
  private selectedSkills: SkillSelection[] = [];
  private activatedSkills: SkillContext[] = [];
  private skillLocale: 'ja' | 'en' = 'en';
  private aiModel: string;
  private modelProvider: ModelProvider;
  private abortSignal?: AbortSignal;
  private toolCallCount = 0;
  private totalToolCalls = 0;
  private lastCancelCheck = 0;
  private isCancelled = false;
  private static readonly CANCEL_CHECK_INTERVAL_MS = 2000;

  private toolExecutions: ToolExecution[] = [];
  private eventState: EventEmitterState;
  private memoryRuntime?: AgentMemoryRuntime;
  private runIo: AgentRunnerIo;

  constructor(
    env: Env,
    db: SqlDatabaseBinding,
    _storage: ObjectStoreBinding | undefined,
    apiKey: string | undefined,
    context: AgentContext,
    agentType: string,
    aiModel: string = DEFAULT_MODEL_ID,
    options: {
      abortSignal?: AbortSignal;
      runIo: AgentRunnerIo;
    },
  ) {
    this.env = env;
    this.db = db;
    this.context = context;
    this.config = getAgentConfig(agentType, env);
    this.aiModel = aiModel;
    this.modelProvider = getProviderFromModel(aiModel);
    this.abortSignal = options.abortSignal;
    this.runIo = options.runIo;
    this.eventState = createEventEmitterState();

    this.openAiKey = apiKey || env.OPENAI_API_KEY;
    this.anthropicKey = env.ANTHROPIC_API_KEY;
    this.googleKey = env.GOOGLE_API_KEY;

    const providerKeyMap: Record<ModelProvider, string | undefined> = {
      openai: this.openAiKey,
      anthropic: this.anthropicKey,
      google: this.googleKey,
    };
    const providerKey = providerKeyMap[this.modelProvider];

    if (providerKey) {
      this.llmClient = createMultiModelClient({
        apiKey: providerKey,
        model: aiModel,
        anthropicApiKey: this.anthropicKey,
        googleApiKey: this.googleKey,
      });
    }
  }

  // ── Tool executor initialization ──────────────────────────────────

  private async initToolExecutor(): Promise<void> {
    this.toolExecutor = await RemoteToolExecutor.create(this.context.runId, {
      getToolCatalog: (input: { runId: string }) => this.runIo.getToolCatalog(input),
      executeTool: (input: { runId: string; toolCall: ToolCall }) => this.runIo.executeTool(input),
      cleanupToolExecutor: (input: { runId: string }) => this.runIo.cleanupToolExecutor(input),
    });

    const availableTools = this.toolExecutor.getAvailableTools();
    this.config.tools = availableTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    const toolCatalog = buildToolCatalogContent(
      availableTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    );

    const lanes: PromptLane[] = [
      {
        priority: LANE_PRIORITY.BASE_PROMPT,
        name: 'base',
        content: this.config.systemPrompt,
        maxTokens: LANE_MAX_TOKENS.BASE_PROMPT,
      },
      {
        priority: LANE_PRIORITY.TOOL_CATALOG,
        name: 'tools',
        content: toolCatalog,
        maxTokens: LANE_MAX_TOKENS.TOOL_CATALOG,
      },
    ];

    this.config.systemPrompt = buildBudgetedSystemPrompt(lanes);

    const failedMcp = this.toolExecutor.mcpFailedServers;
    if (failedMcp.length > 0) {
      await this.emitEvent('thinking', {
        message: `Warning: Failed to load MCP servers: ${failedMcp.join(', ')}`,
        warning: true,
        failed_mcp_servers: failedMcp,
      });
    }
  }

  // ── Bound delegates ────────────────────────────────────────────────

  private async emitEvent(
    type: AgentEvent['type'],
    data: Record<string, unknown>,
    options?: { skipDb?: boolean },
  ): Promise<void> {
    return emitEventImpl(
      this.eventState,
      this.env,
      this.db,
      this.context.runId,
      this.context.spaceId,
      () => this.getCurrentSessionId(),
      type,
      data,
      options,
      (input) => this.runIo.emitRunEvent(input),
    );
  }

  private async updateRunStatus(
    status: RunStatus,
    output?: string,
    error?: string,
  ): Promise<void> {
    return this.runIo.updateRunStatus({
      runId: this.context.runId,
      status,
      usage: this.totalUsage,
      output,
      error,
    });
  }

  private buildTerminalEventPayload(
    status: 'completed' | 'failed' | 'cancelled',
    details: Record<string, unknown> = {},
  ): RunTerminalPayload {
    return buildTerminalEventPayloadImpl(
      this.context.runId,
      status,
      details,
      this.context.sessionId ?? null,
    );
  }

  private async autoCloseSession(status: 'completed' | 'failed'): Promise<void> {
    return autoCloseSessionImpl(
      {
        env: this.env,
        db: this.db,
        context: this.context,
        checkCancellation: (force) => this.checkCancellation(force),
        emitEvent: (type, data) => this.emitEvent(type, data),
        getCurrentSessionId: () => this.getCurrentSessionId(),
      },
      status,
    );
  }

  // ── Cancellation checks ───────────────────────────────────────────

  private async checkCancellation(force = false): Promise<boolean> {
    if (this.abortSignal?.aborted) {
      return false;
    }

    const now = Date.now();
    if (!force && now - this.lastCancelCheck < AgentRunner.CANCEL_CHECK_INTERVAL_MS) {
      return this.isCancelled;
    }

    this.isCancelled = await this.runIo.isCancelled({ runId: this.context.runId });
    this.lastCancelCheck = now;
    return this.isCancelled;
  }

  private async throwIfCancelled(ctx: string): Promise<void> {
    if (this.abortSignal?.aborted) {
      const reason = this.abortSignal.reason;
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Run aborted';
      throw new Error(`${message} (${ctx})`);
    }

    if (await this.checkCancellation()) {
      throw new RunCancelledError(`Run cancelled (${ctx})`);
    }
  }

  // ── Queue jobs ────────────────────────────────────────────────────

  private async enqueueInfoUnitJob(): Promise<void> {
    if (!this.env.INDEX_QUEUE) return;
    try {
      await this.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: this.context.spaceId,
        type: 'info_unit',
        targetId: this.context.runId,
        timestamp: Date.now(),
      });
    } catch (err) {
      logWarn(`Failed to enqueue info unit job for run ${this.context.runId}`, { module: 'info_unit', detail: err });
    }
  }

  private async enqueueThreadContextJob(): Promise<void> {
    if (!this.env.INDEX_QUEUE) return;
    try {
      await this.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: this.context.spaceId,
        type: 'thread_context',
        targetId: this.context.threadId,
        timestamp: Date.now(),
      });
    } catch (err) {
      logWarn(`Failed to enqueue thread context job for thread ${this.context.threadId}`, { module: 'thread_context', detail: err });
    }
  }

  private async enqueuePostRunJobs(): Promise<void> {
    await Promise.all([this.enqueueInfoUnitJob(), this.enqueueThreadContextJob()]);
  }

  // ── Conversation / message helpers ────────────────────────────────

  private async getConversationHistory(): Promise<AgentMessage[]> {
    return this.runIo.getConversationHistory({
      runId: this.context.runId,
      threadId: this.context.threadId,
      spaceId: this.context.spaceId,
      aiModel: this.aiModel,
    });
  }

  private async addMessage(message: AgentMessage, metadata?: Record<string, unknown>): Promise<void> {
    return this.runIo.addMessage({
      runId: this.context.runId,
      threadId: this.context.threadId,
      message,
      metadata,
    });
  }

  private async getCurrentSessionId(): Promise<string | null> {
    return this.runIo.getCurrentSessionId({
      runId: this.context.runId,
      spaceId: this.context.spaceId,
    });
  }

  private async getRunRecord(): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }> {
    return this.runIo.getRunRecord({ runId: this.context.runId });
  }

  private async resolveSkillPlan(history: AgentMessage[]): Promise<SkillLoadResult> {
    return this.runIo.resolveSkillPlan({
      runId: this.context.runId,
      threadId: this.context.threadId,
      spaceId: this.context.spaceId,
      agentType: this.config.type,
      history,
      availableToolNames: this.toolExecutor?.getAvailableTools().map((tool) => tool.name) ?? [],
    });
  }

  private createMemoryBackend(): AgentMemoryBackend | undefined {
    return {
      bootstrap: () => this.runIo.getMemoryActivation({ spaceId: this.context.spaceId }),
      finalize: ({ claims, evidence }) => this.runIo.finalizeMemoryOverlay({
        runId: this.context.runId,
        spaceId: this.context.spaceId,
        claims,
        evidence,
      }),
    };
  }

  // ── Lifecycle delegation ──────────────────────────────────────────

  private getLifecycleDeps(): RunLifecycleDeps {
    return {
      updateRunStatus: this.updateRunStatus.bind(this),
      emitEvent: this.emitEvent.bind(this),
      buildTerminalEventPayload: this.buildTerminalEventPayload.bind(this),
      autoCloseSession: this.autoCloseSession.bind(this),
      enqueuePostRunJobs: this.enqueuePostRunJobs.bind(this),
      sanitizeErrorMessage: sanitizeErrorMessage,
    };
  }

  private async handleSuccessfulRunCompletion(): Promise<void> {
    await handleSuccessfulRunCompletion(this.getLifecycleDeps());
  }

  private async handleCancelledRun(): Promise<void> {
    await handleCancelledRun(this.getLifecycleDeps());
  }

  private async handleFailedRun(error: unknown): Promise<void> {
    await handleFailedRun(this.getLifecycleDeps(), error);
  }

  // ── Run preparation ───────────────────────────────────────────────

  private async prepareRunExecution(): Promise<{
    engine: 'langgraph' | 'simple' | 'none';
    history: AgentMessage[];
  }> {
    await this.throwIfCancelled('before-start');
    const canUseLangGraph = this.modelProvider === 'openai'
      && !!this.openAiKey;
    const engine = !this.llmClient
      ? 'none'
      : canUseLangGraph
        ? 'langgraph'
        : 'simple';

    await this.updateRunStatus('running');
    await this.emitEvent('started', {
      agent_type: this.config.type,
      engine,
    });

    if (!this.llmClient) {
      await this.emitEvent('thinking', {
        message: `Warning: No API key configured for ${this.modelProvider} (model: ${this.aiModel}). Running in limited mode without LLM.`,
        warning: true,
      });
    }

    await this.initToolExecutor();

    const history = await this.getConversationHistory();
    if (!this.llmClient) {
      await this.throwIfCancelled('before-execution');
      return { engine, history };
    }

    const currentRun = await this.getRunRecord();
    const runInput = safeJsonParseOrDefault<Record<string, unknown> | unknown>(currentRun.input || '{}', {});
    const runInputObject = runInput && typeof runInput === 'object' && !Array.isArray(runInput)
      ? runInput as Record<string, unknown>
      : {};
    const delegationPacket = currentRun.parentRunId
      ? getDelegationPacketFromRunInput(runInputObject)
      : null;
    const delegationObservability = runInputObject.delegation_observability;
    const savedDelegationObservability = delegationObservability && typeof delegationObservability === 'object' && !Array.isArray(delegationObservability)
      ? delegationObservability as Record<string, unknown>
      : null;
    if (delegationPacket) {
      await this.emitEvent('thinking', {
        message: 'Loaded delegated execution context for sub-agent run',
        delegated_context: true,
        delegation_product_hint: delegationPacket.product_hint,
        delegation_locale: delegationPacket.locale,
        delegation_constraints_count: delegationPacket.constraints.length,
        delegation_context_count: delegationPacket.context.length,
        delegation_has_thread_summary: !!delegationPacket.thread_summary,
        delegation_explicit_fields_count: typeof savedDelegationObservability?.explicit_field_count === 'number'
          ? savedDelegationObservability.explicit_field_count
          : null,
        delegation_inferred_fields_count: typeof savedDelegationObservability?.inferred_field_count === 'number'
          ? savedDelegationObservability.inferred_field_count
          : null,
      });
    }
    const skillResult = await this.resolveSkillPlan(history);

    this.skillLocale = skillResult.skillLocale;
    this.availableSkills = skillResult.availableSkills;
    this.selectedSkills = skillResult.selectedSkills;
    this.activatedSkills = skillResult.activatedSkills;

    await emitSkillLoadOutcome(skillResult, this.emitEvent.bind(this));

    // Initialize memory runtime and wire observer + idempotency into tool executor
    try {
      this.memoryRuntime = new AgentMemoryRuntime(
        this.db,
        this.context,
        this.env,
        this.createMemoryBackend(),
      );
      await this.memoryRuntime.bootstrap();
      if (this.toolExecutor) {
        const observer = this.memoryRuntime.createToolObserver();
        this.toolExecutor.setObserver(observer);
      }
    } catch (err) {
      logWarn('Memory runtime initialization failed, continuing without memory', {
        module: 'services/agent/runner',
        detail: err,
      });
      this.memoryRuntime = undefined;
    }

    await this.throwIfCancelled('before-execution');

    return { engine, history };
  }

  // ── Engine execution ──────────────────────────────────────────────

  private async runWithLangGraph(history: AgentMessage[]): Promise<void> {
    if (!this.openAiKey) {
      throw new Error('API key is required for LangGraph');
    }
    if (!this.toolExecutor) {
      throw new Error('Tool executor not initialized');
    }
    await runLangGraphRunner({
      apiKey: this.openAiKey,
      model: this.aiModel,
      systemPrompt: this.config.systemPrompt,
      skillPlan: {
        locale: this.skillLocale,
        availableSkills: this.availableSkills,
        selectableSkills: this.availableSkills.filter((skill) => skill.availability !== 'unavailable'),
        selectedSkills: this.selectedSkills,
        activatedSkills: this.activatedSkills,
      },
      history,
      threadId: this.context.threadId,
      runId: this.context.runId,
      sessionId: this.context.sessionId,
      toolExecutor: this.toolExecutor as never,
      db: this.db,
      maxIterations: this.config.maxIterations || 10,
      temperature: this.config.temperature ?? 0.7,
      toolExecutions: this.toolExecutions,
      emitEvent: this.emitEvent.bind(this),
      addMessage: this.addMessage.bind(this),
      updateRunStatus: this.updateRunStatus.bind(this),
      env: this.env,
      spaceId: this.context.spaceId,
      shouldCancel: this.checkCancellation.bind(this),
      abortSignal: this.abortSignal,
      memoryRuntime: this.memoryRuntime ?? undefined,
    });
  }

  private async runSimpleLoop(): Promise<void> {
    if (!this.llmClient) {
      throw new Error('No LLM client available');
    }
    await runWithSimpleLoop({
      env: this.env,
      config: this.config,
      llmClient: this.llmClient,
      toolExecutor: this.toolExecutor,
      skillLocale: this.skillLocale,
      availableSkills: this.availableSkills,
      selectedSkills: this.selectedSkills,
      activatedSkills: this.activatedSkills,
      spaceId: this.context.spaceId,
      abortSignal: this.abortSignal,
      toolExecutions: this.toolExecutions,
      totalUsage: this.totalUsage,
      toolCallCount: this.toolCallCount,
      totalToolCalls: this.totalToolCalls,
      memoryRuntime: this.memoryRuntime ?? undefined,
      throwIfCancelled: (ctx) => this.throwIfCancelled(ctx),
      emitEvent: (type, data) => this.emitEvent(type, data),
      addMessage: (msg, meta) => this.addMessage(msg, meta),
      updateRunStatus: (status, output, error) => this.updateRunStatus(status, output, error),
      buildTerminalEventPayload: (status, details) => this.buildTerminalEventPayload(status, details),
      getConversationHistory: () => this.getConversationHistory(),
    });
  }

  private async executeRunEngine(
    history: AgentMessage[],
    engine: 'langgraph' | 'simple' | 'none',
  ): Promise<void> {
    if (engine === 'none') {
      await runWithoutLLM(
        {
          toolExecutor: this.toolExecutor,
          emitEvent: (type, data) => this.emitEvent(type, data),
          addMessage: (msg, meta) => this.addMessage(msg, meta),
          updateRunStatus: (status, output, error) => this.updateRunStatus(status, output, error),
          buildTerminalEventPayload: (status, details) => this.buildTerminalEventPayload(status, details),
        },
        history,
      );
      return;
    }

    if (engine === 'simple') {
      await this.emitEvent('thinking', {
        message: 'Using simple mode for selected model',
        engine: 'simple',
      });
      await this.runSimpleLoop();
      return;
    }

    await this.runWithLangGraph(history);
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  private async cleanupAfterRun(): Promise<void> {
    try {
      const executor = this.toolExecutor;

      // Finalize memory runtime (flush overlay claims to DB)
      if (this.memoryRuntime) {
        try {
          await this.memoryRuntime.finalize();
        } catch (err) {
          logWarn('Memory runtime finalize failed during cleanup', {
            module: 'services/agent/runner',
            detail: err,
          });
        }
        this.memoryRuntime = undefined;
      }

      this.toolExecutor = undefined;
      await executor?.cleanup();
      this.toolExecutions.length = 0;

      const currentRunStatus = await this.runIo.getRunStatus({ runId: this.context.runId });

      if (normalizeRunStatus(currentRunStatus) === 'running') {
        logWarn(`Run ${this.context.runId} was left in running state - marking as failed`, { module: 'agentrunner' });
        await this.updateRunStatus('failed', undefined, 'Run terminated unexpectedly during cleanup');
      }
    } catch (cleanupError) {
      logError('Cleanup error', cleanupError, { module: 'services/agent/runner' });
    }
  }

  // ── Main entry point ──────────────────────────────────────────────

  async run(): Promise<void> {
    try {
      const { engine, history } = await this.prepareRunExecution();
      await this.executeRunEngine(history, engine);
      await this.handleSuccessfulRunCompletion();
    } catch (error) {
      if (error instanceof RunCancelledError) {
        await this.handleCancelledRun();
        return;
      }
      await this.handleFailedRun(error);
      throw error;
    } finally {
      await this.cleanupAfterRun();
    }
  }
}
