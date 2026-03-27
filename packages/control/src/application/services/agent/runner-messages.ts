/**
 * Agent Runner Messages & Conversation History
 *
 * Run status persistence, conversation history building, and
 * message-related helpers extracted from runner.ts.
 */

import type { RunStatus, Env } from '../../../shared/types';
import type { AgentMessage, ToolCall } from './types';
import { getDb, runs, threads, messages } from '../../../infra/db';
import { and, eq, sql, desc } from 'drizzle-orm';
import { getContextWindowForModel } from './model-catalog';
import { readMessageFromR2 } from '../offload/messages';
import { buildThreadContextSystemMessage, queryRelevantThreadMessages } from './thread-context';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';
import {
  THREAD_RETRIEVAL_TOP_K,
  THREAD_RETRIEVAL_MIN_SCORE,
  THREAD_CONTEXT_MAX_CHARS,
} from '../../../shared/config/limits';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import {
  buildDelegationSystemMessage,
  buildDelegationUserMessage,
  getDelegationPacketFromRunInput,
} from './delegation';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';

// ── Run status persistence ──────────────────────────────────────────

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

// ── Conversation history helpers ────────────────────────────────────

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

export interface ConversationHistoryDeps {
  db: SqlDatabaseBinding;
  env: Env;
  threadId: string;
  runId: string;
  spaceId: string;
  aiModel: string;
}

export function normalizeRunStatus(value: string | null | undefined): RunStatus | null {
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
