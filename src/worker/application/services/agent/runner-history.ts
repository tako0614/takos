/**
 * Agent Runner Messages & Conversation History
 *
 * Run status persistence, conversation history building, and
 * message-related helpers extracted from runner.ts.
 */

import type { Env, RunStatus } from "../../../shared/types/index.ts";
import type { AgentMessage, AgentUsage, ToolCall } from "./agent-models.ts";
import { getDb, messages, runs, threads } from "../../../infra/db/index.ts";
import { and, desc, eq, sql } from "drizzle-orm";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { resolveHistoryTokenBudget } from "./model-catalog.ts";
import { estimateTokens } from "./prompt-budget.ts";
import { readMessageFromR2 } from "../offload/messages.ts";
import {
  buildThreadContextSystemMessage,
  queryRelevantThreadMessages,
} from "./thread-context.ts";
import { logInfo, logWarn } from "../../../shared/utils/logger.ts";
import {
  THREAD_CONTEXT_MAX_CHARS,
  THREAD_RETRIEVAL_MIN_SCORE,
  THREAD_RETRIEVAL_TOP_K,
} from "../../../shared/config/limits.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import {
  buildDelegationSystemMessage,
  buildDelegationUserMessage,
  getDelegationPacketFromRunInput,
} from "./delegation.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  type MessageAttachmentRef,
  parseMessageAttachmentRefs,
} from "./message-attachments.ts";

// ── Run status persistence ──────────────────────────────────────────

/**
 * Lease identity of the caller, threaded from the token-bound `serviceId`
 * (and, when the agent echoes it, `leaseVersion`) that executor-host stamps on
 * every control RPC body. When present, the status write is fenced to this
 * lease so a re-enqueued (zombie) container — whose proxy token stays valid for
 * STALE_PROXY_TOKEN_MS after stale-recovery reclaims the run under a NEW lease —
 * cannot clobber a run that a fresh lease now owns. Mirrors the WHERE-clause
 * fences in handleHeartbeat / handleRunFail / handleRunReset.
 */
export type RunStatusLease = {
  serviceId?: string | null;
  leaseVersion?: number | null;
};

export type UpdateRunStatusResult = {
  /** Whether the run row was written by this call (or already idempotent). */
  updated: boolean;
  /** True when a lease was supplied but the run is no longer owned by it. */
  leaseLost: boolean;
};

/**
 * Update run status in the database.
 *
 * When `lease.serviceId` is supplied the update is fenced to that lease and
 * returns `{ leaseLost: true }` (the caller maps this to HTTP 409) instead of
 * silently writing on behalf of a superseded container.
 */
export async function updateRunStatusImpl(
  db: SqlDatabaseBinding,
  runId: string,
  totalUsage: AgentUsage,
  status: RunStatus,
  output?: string,
  error?: string,
  lease?: RunStatusLease,
): Promise<UpdateRunStatusResult> {
  const drizzleDb = getDb(db);
  const now = new Date().toISOString();

  const leaseServiceId =
    typeof lease?.serviceId === "string" && lease.serviceId.length > 0
      ? lease.serviceId
      : null;
  const leaseVersion =
    typeof lease?.leaseVersion === "number" ? lease.leaseVersion : null;

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

  if (status === "running") {
    updateData.startedAt = now;
  }

  if (status === "completed" || status === "failed" || status === "cancelled") {
    updateData.completedAt = now;
  }

  if (output !== undefined) {
    updateData.output = output;
  }

  if (error !== undefined) {
    updateData.error = error;
  }

  if (status === "completed" || status === "failed" || status === "cancelled") {
    const existing = await drizzleDb
      .select({
        status: runs.status,
        usage: runs.usage,
        output: runs.output,
        error: runs.error,
        serviceId: runs.serviceId,
        leaseVersion: runs.leaseVersion,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();

    // Lease fence: reject a terminal write from a superseded lease before it
    // can flip a reclaimed run's status / output / usage.
    if (leaseServiceId !== null) {
      if (
        !existing ||
        existing.serviceId !== leaseServiceId ||
        (leaseVersion !== null && existing.leaseVersion !== leaseVersion)
      ) {
        return { updated: false, leaseLost: true };
      }
    }

    if (
      existing?.status === status &&
      existing.usage === updateData.usage &&
      (output === undefined || existing.output === output) &&
      (error === undefined || existing.error === error)
    ) {
      return { updated: true, leaseLost: false };
    }
  }

  const conditions = [eq(runs.id, runId)];
  if (status === "completed" || status === "failed" || status === "cancelled") {
    // Every terminal transition is a compare-and-set from the active executor
    // state. This prevents two terminal reporters on the same lease (or a
    // user cancellation racing completion) from rewriting one another.
    conditions.push(eq(runs.status, "running"));
  } else {
    conditions.push(
      sql`${runs.status} NOT IN ('completed', 'failed', 'cancelled')`,
    );
  }
  if (leaseServiceId !== null) {
    conditions.push(eq(runs.serviceId, leaseServiceId));
    if (leaseVersion !== null) {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
  }

  const result = await drizzleDb
    .update(runs)
    .set(updateData)
    .where(and(...conditions));
  const updated = affectedRowCount(result) > 0;
  if (updated || leaseServiceId === null) {
    return { updated, leaseLost: false };
  }

  // 0 rows with a lease present: distinguish a lost lease (the run was
  // reclaimed under a new serviceId/leaseVersion) from a rejected state
  // transition. The caller treats `updated: false` as a conflict even when the
  // lease still matches, so terminal states cannot be overwritten.
  const current = await drizzleDb
    .select({
      serviceId: runs.serviceId,
      leaseVersion: runs.leaseVersion,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  const leaseLost =
    !current ||
    current.serviceId !== leaseServiceId ||
    (leaseVersion !== null && current.leaseVersion !== leaseVersion);
  return { updated: false, leaseLost };
}

// ── Conversation history helpers ────────────────────────────────────

/** Type guard to validate tool_calls array structure */
export function isValidToolCallsArray(value: unknown): value is ToolCall[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const obj = item as Record<string, unknown>;
    return (
      typeof obj.id === "string" && obj.id.trim().length > 0 &&
      typeof obj.name === "string" && obj.name.trim().length > 0 &&
      typeof obj.arguments === "object" &&
      obj.arguments !== null &&
      !Array.isArray(obj.arguments)
    );
  });
}

export interface ConversationHistoryCandidate {
  msg: AgentMessage;
  sequence: number;
  tokens: number;
}

/**
 * Group persisted history into provider-valid units. An assistant tool-call
 * message and all of its matching tool results are indivisible: trimming only
 * part of that exchange produces orphan tool messages that OpenAI-compatible
 * providers reject. Corrupt/incomplete exchanges are omitted; assistant text
 * is retained as a plain message when possible.
 */
export function groupCoherentHistoryCandidates(
  candidates: readonly ConversationHistoryCandidate[],
): ConversationHistoryCandidate[][] {
  const groups: ConversationHistoryCandidate[][] = [];
  let index = 0;

  while (index < candidates.length) {
    const candidate = candidates[index];
    if (candidate.msg.role === "tool") {
      // A tool result without the immediately preceding assistant call is not
      // valid provider history.
      index++;
      continue;
    }

    const calls = candidate.msg.role === "assistant"
      ? candidate.msg.tool_calls ?? []
      : [];
    if (calls.length === 0) {
      groups.push([candidate]);
      index++;
      continue;
    }

    const callIds = calls.map((call) => call.id);
    const expectedIds = new Set(callIds);
    const matchedResults: ConversationHistoryCandidate[] = [];
    const seenIds = new Set<string>();
    let nextIndex = index + 1;
    while (
      nextIndex < candidates.length &&
      candidates[nextIndex].msg.role === "tool"
    ) {
      const result = candidates[nextIndex];
      const id = result.msg.tool_call_id;
      if (id && expectedIds.has(id) && !seenIds.has(id)) {
        matchedResults.push(result);
        seenIds.add(id);
      }
      nextIndex++;
    }

    const complete = expectedIds.size === callIds.length &&
      seenIds.size === expectedIds.size;
    if (complete) {
      groups.push([candidate, ...matchedResults]);
    } else if (candidate.msg.content.trim()) {
      const { tool_calls: _discarded, ...plainMessage } = candidate.msg;
      groups.push([{
        ...candidate,
        msg: plainMessage,
        tokens: estimateTokens(plainMessage.content),
      }]);
    }
    index = nextIndex;
  }

  return groups;
}

export interface ConversationHistoryDeps {
  db: SqlDatabaseBinding;
  env: Env;
  threadId: string;
  runId: string;
  spaceId: string;
  aiModel: string;
}

function appendAttachmentContext(
  content: string,
  attachments: MessageAttachmentRef[],
): string {
  if (attachments.length === 0) return content;

  const lines = [
    "Takos chat attachment metadata is available for this message.",
    "Use toolbox action=call with tool_name=chat_attachment_read and arguments containing the file_id below. Do not use an installed storage MCP for this Takos-owned attachment.",
    ...attachments.map((attachment) => {
      const parts = [
        attachment.path || attachment.name,
        `file_id: ${attachment.file_id}`,
      ];
      if (attachment.mime_type) {
        parts.push(`mime_type: ${attachment.mime_type}`);
      }
      if (typeof attachment.size === "number") {
        parts.push(`size: ${attachment.size}`);
      }
      return `- ${parts.join(", ")}`;
    }),
  ];

  const attachmentContext = lines.join("\n");
  return content.trim()
    ? `${content}\n\n${attachmentContext}`
    : attachmentContext;
}

export async function buildConversationHistory(
  deps: ConversationHistoryDeps,
): Promise<AgentMessage[]> {
  const { db: dbBinding, env, threadId, runId, spaceId, aiModel } = deps;
  const db = getDb(dbBinding);
  const startedAt = Date.now();

  let threadSummary: string | null = null;
  let threadKeyPointsJson = "[]";

  const thread = await db
    .select({
      summary: threads.summary,
      keyPoints: threads.keyPoints,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();

  if (thread) {
    threadSummary = thread.summary ?? null;
    threadKeyPointsJson = thread.keyPoints || "[]";
  }

  const tokenBudget = resolveHistoryTokenBudget(
    aiModel,
    env.MODEL_CONTEXT_WINDOWS,
  );

  // Fetch recent messages (generous upper bound; trimmed by token budget below)
  const MAX_FETCH = 500;
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      r2Key: messages.r2Key,
      toolCalls: messages.toolCalls,
      toolCallId: messages.toolCallId,
      metadata: messages.metadata,
      sequence: messages.sequence,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.sequence))
    .limit(MAX_FETCH)
    .all();

  rows.reverse(); // chronological

  // Hydrate offloaded message payloads from object store (best-effort).
  if (env.TAKOS_OFFLOAD) {
    const bucket = env.TAKOS_OFFLOAD;
    const candidates = rows
      .map((m, idx) => ({ idx, key: m.r2Key }))
      .filter((x) => typeof x.key === "string" && x.key.length > 0) as Array<{
      idx: number;
      key: string;
    }>;

    const concurrency = 20;
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async ({ idx, key }) => {
          const persisted = await readMessageFromR2(bucket, key);
          if (!persisted) return;
          if (persisted.id !== rows[idx].id) return;
          if (persisted.thread_id !== threadId) return;
          rows[idx].content = persisted.content;
          rows[idx].toolCalls = persisted.tool_calls;
          rows[idx].toolCallId = persisted.tool_call_id;
          rows[idx].metadata = persisted.metadata;
        }),
      );
    }
  }

  const excludeSequences = new Set<number>();
  let lastUserQuery = "";

  // Build all candidate messages (newest first in rows, but rows is already reversed to chronological)
  const candidates: ConversationHistoryCandidate[] = [];

  for (const msg of rows) {
    excludeSequences.add(msg.sequence);
    if (msg.role === "user") {
      lastUserQuery = appendAttachmentContext(
        msg.content,
        parseMessageAttachmentRefs(msg.metadata),
      );
    }

    const attachments =
      msg.role === "user" ? parseMessageAttachmentRefs(msg.metadata) : [];
    const agentMsg: AgentMessage = {
      role: msg.role as AgentMessage["role"],
      content: appendAttachmentContext(msg.content, attachments),
    };

    if (msg.toolCalls) {
      try {
        const parsed = JSON.parse(msg.toolCalls);
        if (isValidToolCallsArray(parsed)) {
          agentMsg.tool_calls = parsed;
        } else {
          logWarn("Invalid tool_calls structure, skipping", {
            module: "services/agent/conversation-history",
          });
        }
      } catch (parseError) {
        logWarn("Failed to parse tool_calls from message", {
          module: "services/agent/conversation-history",
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
      }
    }

    if (msg.toolCallId) {
      agentMsg.tool_call_id = msg.toolCallId;
    }

    const tokens =
      estimateTokens(agentMsg.content || "") +
      (agentMsg.tool_calls
        ? estimateTokens(JSON.stringify(agentMsg.tool_calls))
        : 0);
    candidates.push({ msg: agentMsg, sequence: msg.sequence, tokens });
  }

  // Trim whole provider-valid units from the front. Never split an assistant
  // tool-call message from its corresponding result messages.
  const groups = groupCoherentHistoryCandidates(candidates);
  let totalTokens = groups.reduce(
    (sum, group) => sum + group.reduce((groupSum, c) => groupSum + c.tokens, 0),
    0,
  );
  let trimGroupIndex = 0;
  while (trimGroupIndex < groups.length - 1 && totalTokens > tokenBudget) {
    totalTokens -= groups[trimGroupIndex].reduce(
      (sum, candidate) => sum + candidate.tokens,
      0,
    );
    trimGroupIndex++;
  }

  const trimmed = groups.slice(trimGroupIndex).flat();
  const agentMessages = trimmed.map((c) => c.msg);
  const oldestRecentSequence =
    trimmed.length > 0 ? trimmed[0].sequence : undefined;

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
    logWarn(`Vector search failed for thread ${threadId}`, {
      module: "thread_context",
      detail: err,
    });
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
    const runRow = await db
      .select({
        parentRunId: runs.parentRunId,
        input: runs.input,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (runRow?.parentRunId) {
      const delegationPacket = getDelegationPacketFromRunInput(runRow.input);
      if (delegationPacket) {
        agentMessages.unshift(buildDelegationSystemMessage(delegationPacket));
        agentMessages.push(buildDelegationUserMessage(delegationPacket));
      } else {
        const parsed = safeJsonParseOrDefault<
          Record<string, unknown> | unknown
        >(runRow.input || "{}", {});
        const task =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>).task
            : null;
        if (typeof task === "string" && task.trim()) {
          agentMessages.push({
            role: "user",
            content:
              `[Delegated sub-task from parent agent (run: ${runRow.parentRunId})]\n\n` +
              task.trim(),
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal: if we can't inject the task, the sub-agent still has the thread context
    logWarn(`Failed to inject task for run ${runId}`, {
      module: "sub_agent",
      detail: err,
    });
  }

  // Lightweight benchmark log (helps validate context optimization in production logs).
  try {
    let chars = 0;
    for (const msg of agentMessages) {
      chars += (msg.content || "").length;
      if (msg.tool_calls) {
        chars += JSON.stringify(msg.tool_calls).length;
      }
    }
    const estTokens = Math.ceil(chars / 4);
    const elapsedMs = Date.now() - startedAt;
    logInfo(
      `built thread=${threadId} model=${aiModel} budget=${tokenBudget} ` +
        `fetched=${rows.length} used=${trimmed.length} retrieved=${retrieved.length} estTokens=${estTokens} ms=${elapsedMs}`,
      { module: "thread_context" },
    );
  } catch {
    // ignore
  }

  return agentMessages;
}
