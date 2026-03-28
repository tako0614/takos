/**
 * Control-plane RPC handlers for the executor-host subsystem.
 *
 * These handle /rpc/control/* requests: conversation history, skill planning,
 * memory graph activation/finalization, message persistence, tool execution,
 * run status updates, and run event emission.
 */

import { getDb } from '../../infra/db';
import { runs, runEvents } from '../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { logError } from '../../shared/utils/logger';
import { persistMessage } from '../../application/services/agent/message-persistence';
import type { AgentMessage } from '../../application/services/agent/agent-models';
import {
  buildConversationHistory,
  updateRunStatusImpl,
} from '../../application/services/agent/runner';
import { resolveSkillPlanForRun } from '../../application/services/agent/skills';
import { createToolExecutor, type ToolExecutorLike } from '../../application/tools/executor';
import { AGENT_DISABLED_BUILTIN_TOOLS } from '../../application/tools/tool-policy';
import type { ToolCall } from '../../application/tools/tool-definitions';
import {
  getActiveClaims,
  countEvidenceForClaims,
  getPathsForClaim,
  upsertClaim,
  insertEvidence,
} from '../../application/services/memory-graph/claim-store';
import { buildActivationBundles, renderActivationSegment } from '../../application/services/memory-graph/activation';
import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
} from '../../application/services/run-notifier';
import type { IndexJobQueueMessage } from '../../shared/types';
import { ok, err, classifyProxyError } from './executor-utils';
import type { Env } from './executor-utils';
import { getRunBootstrap } from './executor-run-state';

// ---------------------------------------------------------------------------
// Remote tool executor cache
// ---------------------------------------------------------------------------

const remoteToolExecutors = new Map<string, Promise<ToolExecutorLike>>();

async function createRemoteToolExecutor(runId: string, env: Env): Promise<ToolExecutorLike> {
  const bootstrap = await getRunBootstrap(env, runId);

  return createToolExecutor(
    env as unknown as Parameters<typeof createToolExecutor>[0],
    env.DB,
    env.TAKOS_OFFLOAD,
    bootstrap.spaceId,
    bootstrap.sessionId ?? undefined,
    bootstrap.threadId,
    runId,
    bootstrap.userId,
    {
      disabledBuiltinTools: [...AGENT_DISABLED_BUILTIN_TOOLS],
    },
    undefined,
    undefined,
    {
      minimumRole: 'admin',
    },
  );
}

async function getOrCreateRemoteToolExecutor(runId: string, env: Env): Promise<ToolExecutorLike> {
  const existing = remoteToolExecutors.get(runId);
  if (existing) {
    return existing;
  }

  const pending = createRemoteToolExecutor(runId, env);
  remoteToolExecutors.set(runId, pending);
  try {
    return await pending;
  } catch (error) {
    remoteToolExecutors.delete(runId);
    throw error;
  }
}

async function cleanupRemoteToolExecutor(runId: string): Promise<void> {
  const existing = remoteToolExecutors.get(runId);
  if (!existing) {
    return;
  }
  remoteToolExecutors.delete(runId);
  try {
    const executor = await existing;
    await executor.cleanup();
  } catch {
    // Best-effort cleanup.
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleConversationHistory(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    threadId,
    spaceId,
    aiModel,
  } = body as {
    runId?: string;
    threadId?: string;
    spaceId?: string;
    aiModel?: string;
  };
  if (!runId || !threadId || !spaceId || !aiModel) {
    return err('Missing runId, threadId, spaceId, or aiModel', 400);
  }

  try {
    const history = await buildConversationHistory({
      db: env.DB,
      env: env as unknown as Parameters<typeof buildConversationHistory>[0]['env'],
      threadId,
      runId,
      spaceId,
      aiModel,
    });
    return ok({ history });
  } catch (e: unknown) {
    logError('Conversation history RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleSkillPlan(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    threadId,
    spaceId,
    agentType,
    history,
    availableToolNames,
  } = body as {
    runId?: string;
    threadId?: string;
    spaceId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (!runId || !threadId || !spaceId || !agentType || !Array.isArray(history) || !Array.isArray(availableToolNames)) {
    return err('Missing runId, threadId, spaceId, agentType, history, or availableToolNames', 400);
  }

  try {
    const result = await resolveSkillPlanForRun(env.DB, {
      runId,
      threadId,
      spaceId,
      agentType,
      history,
      availableToolNames,
    });
    return ok(result);
  } catch (e: unknown) {
    logError('Skill plan RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleMemoryActivation(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { spaceId } = body as { spaceId?: string };
  if (!spaceId) return err('Missing spaceId', 400);

  try {
    const claims = await getActiveClaims(env.DB, spaceId, 50);
    if (claims.length === 0) {
      return ok({ bundles: [], segment: '', hasContent: false });
    }

    const claimIds = claims.map((claim) => claim.id);
    const topClaims = claims.slice(0, 20);
    const [evidenceCounts, pathsArrays] = await Promise.all([
      countEvidenceForClaims(env.DB, claimIds),
      Promise.all(topClaims.map((claim) => getPathsForClaim(env.DB, spaceId, claim.id, 5))),
    ]);

    const pathsByClaim = new Map<string, (typeof pathsArrays)[number]>();
    for (let i = 0; i < topClaims.length; i++) {
      if (pathsArrays[i].length > 0) {
        pathsByClaim.set(topClaims[i].id, pathsArrays[i]);
      }
    }

    const bundles = buildActivationBundles(claims, evidenceCounts, pathsByClaim);
    return ok(renderActivationSegment(bundles));
  } catch (e: unknown) {
    logError('Memory activation RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleMemoryFinalize(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    spaceId,
    claims,
    evidence,
  } = body as {
    runId?: string;
    spaceId?: string;
    claims?: Array<Record<string, unknown>>;
    evidence?: Array<Record<string, unknown>>;
  };
  if (!runId || !spaceId || !Array.isArray(claims) || !Array.isArray(evidence)) {
    return err('Missing runId, spaceId, claims, or evidence', 400);
  }

  try {
    for (const claim of claims) {
      await upsertClaim(env.DB, {
        id: String(claim.id),
        accountId: String(claim.accountId ?? spaceId),
        claimType: claim.claimType as 'fact' | 'preference' | 'decision' | 'observation',
        subject: String(claim.subject ?? ''),
        predicate: String(claim.predicate ?? ''),
        object: String(claim.object ?? ''),
        confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.5,
        status: (claim.status as 'active' | 'superseded' | 'retracted') ?? 'active',
        supersededBy: typeof claim.supersededBy === 'string' ? claim.supersededBy : null,
        sourceRunId: typeof claim.sourceRunId === 'string' ? claim.sourceRunId : runId,
      });
    }

    for (const item of evidence) {
      await insertEvidence(env.DB, {
        id: String(item.id),
        accountId: String(item.accountId ?? spaceId),
        claimId: String(item.claimId),
        kind: item.kind as 'supports' | 'contradicts' | 'context',
        sourceType: item.sourceType as 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall',
        sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef : null,
        content: String(item.content ?? ''),
        trust: typeof item.trust === 'number' ? item.trust : 0.7,
        taint: typeof item.taint === 'string' ? item.taint : null,
      });
    }

    if (env.INDEX_QUEUE) {
      await env.INDEX_QUEUE.send({
        version: 1,
        jobId: crypto.randomUUID(),
        spaceId,
        type: 'memory_build_paths',
        targetId: runId,
        timestamp: Date.now(),
      } satisfies IndexJobQueueMessage);
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError('Memory finalize RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleAddMessage(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    threadId,
    message,
    metadata,
  } = body as {
    threadId?: string;
    message?: AgentMessage;
    metadata?: Record<string, unknown>;
  };
  if (!threadId || !message || typeof message !== 'object') {
    return err('Missing threadId or message', 400);
  }
  if (
    (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system' && message.role !== 'tool')
    || typeof message.content !== 'string'
  ) {
    return err('Invalid message payload', 400);
  }

  try {
    await persistMessage(
      { db: env.DB, env: env as unknown as Parameters<typeof persistMessage>[0]['env'], threadId },
      message,
      metadata,
    );
    return ok({ success: true });
  } catch (e: unknown) {
    logError('Add message RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleUpdateRunStatus(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    status,
    usage,
    output,
    error: errorMessage,
  } = body as {
    runId?: string;
    status?: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    usage?: { inputTokens?: number; outputTokens?: number };
    output?: string;
    error?: string;
  };
  if (!runId || !status) {
    return err('Missing runId or status', 400);
  }
  if (!usage || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') {
    return err('Missing usage', 400);
  }

  try {
    await updateRunStatusImpl(
      env.DB,
      runId,
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      status,
      output,
      errorMessage,
    );
    return ok({ success: true });
  } catch (e: unknown) {
    logError('Update run status RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleToolCatalog(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    const executor = await getOrCreateRemoteToolExecutor(runId, env);
    return ok({
      tools: executor.getAvailableTools(),
      mcpFailedServers: executor.mcpFailedServers,
    });
  } catch (e: unknown) {
    logError('Tool catalog RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleToolExecute(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId, toolCall } = body as { runId?: string; toolCall?: ToolCall };
  if (!runId || !toolCall || typeof toolCall !== 'object') {
    return err('Missing runId or toolCall', 400);
  }
  if (
    typeof toolCall.id !== 'string'
    || typeof toolCall.name !== 'string'
    || typeof toolCall.arguments !== 'object'
    || toolCall.arguments == null
  ) {
    return err('Invalid toolCall payload', 400);
  }

  try {
    const executor = await getOrCreateRemoteToolExecutor(runId, env);
    return ok(await executor.execute(toolCall));
  } catch (e: unknown) {
    logError('Tool execute RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleToolCleanup(body: Record<string, unknown>): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  await cleanupRemoteToolExecutor(runId);
  return ok({ success: true });
}

export async function handleRunEvent(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    type,
    data,
    sequence,
    skipDb,
  } = body as {
    runId?: string;
    type?: AgentMessage['role'] | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'completed' | 'error' | 'progress' | 'started' | 'cancelled';
    data?: Record<string, unknown>;
    sequence?: number;
    skipDb?: boolean;
  };

  if (!runId || !type || !data || typeof data !== 'object' || typeof sequence !== 'number') {
    return err('Missing runId, type, data, or sequence', 400);
  }

  const now = new Date().toISOString();
  const offloadEnabled = Boolean(env.TAKOS_OFFLOAD);
  let legacyEventId: number | null = null;

  try {
    if (!skipDb && !offloadEnabled) {
      const db = getDb(env.DB);
      const persisted = await db.insert(runEvents).values({
        runId,
        type,
        data: JSON.stringify({ ...data, _sequence: sequence }),
        createdAt: now,
      }).returning({ id: runEvents.id }).get();
      legacyEventId = persisted?.id ?? null;
    }

    const stub = getRunNotifierStub(env as never, runId);
    const emitResponse = await stub.fetch(
      buildRunNotifierEmitRequest(
        buildRunNotifierEmitPayload(runId, type, data, legacyEventId),
      ) as never,
    );

    if (!emitResponse.ok) {
      const text = await emitResponse.text().catch(() => '');
      return err(`Run event emit failed: ${emitResponse.status} ${text}`.trim(), 502);
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError('Run event RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}
