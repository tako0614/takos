/**
 * Control-plane RPC handlers for the executor-host subsystem.
 *
 * These handlers back the canonical Takosumi-owned
 * /api/internal/v1/agent-control/* route family.
 */

import { getDb } from "../../infra/db/index.ts";
import { runEvents, runs, threads } from "../../infra/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";
import { persistMessage } from "../../application/services/agent/message-persistence.ts";
import type { AgentMessage } from "../../application/services/agent/agent-models.ts";
import {
  buildConversationHistory,
  updateRunStatusImpl,
} from "../../application/services/agent/runner-history.ts";
import { getAgentConfig } from "../../application/services/agent/runner-config.ts";
import {
  buildSkillResolutionContext,
  resolveSkillPlanForRun,
} from "../../application/services/agent/skills.ts";
import { listDetailedSkillContext } from "../../application/services/source/skills.ts";
import {
  createToolExecutor,
  type ToolExecutorLike,
} from "../../application/tools/executor.ts";
import { AGENT_DISABLED_CUSTOM_TOOLS } from "../../application/tools/tool-policy.ts";
import type { ToolCall } from "../../application/tools/tool-definitions.ts";
import {
  countEvidenceForClaims,
  getActiveClaims,
  getPathsForClaim,
  insertEvidence,
  upsertClaim,
} from "../../application/services/memory-graph/claim-store.ts";
import {
  buildActivationBundles,
  renderActivationSegment,
} from "../../application/services/memory-graph/activation.ts";
import { listSkillTemplates } from "../../application/services/agent/skill-templates.ts";
import { listMcpServers } from "../../application/services/platform/mcp.ts";
import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
} from "../../application/services/run-notifier/index.ts";
import type { Env, IndexJobQueueMessage } from "../../shared/types/index.ts";
import {
  classifyProxyError,
  err,
  ok,
  readRunServiceId,
} from "./executor-utils.ts";
import { getRunBootstrap } from "./executor-run-state.ts";

/**
 * Fence a run-scoped, side-effecting control RPC to the caller's token-bound
 * lease before it mutates or continues executing the run.
 *
 * executor-host overwrites `body.serviceId` with the verified per-run proxy
 * token, but that token stays valid for STALE_PROXY_TOKEN_MS (15min) after the
 * stale-recovery path re-enqueues the run under a NEW serviceId/leaseVersion
 * (stale-worker threshold 5min) — a 5-15min window in which a re-claimed run is
 * owned by a fresh lease while the original container is still alive with a
 * valid token. Without this fence that zombie container could keep writing
 * messages, finalizing memory, emitting events, or executing side-effecting
 * tools for a run that no longer belongs to it. Mirrors the WHERE-clause fences
 * on handleHeartbeat / handleRunFail / handleRunReset.
 *
 * Returns an error Response to short-circuit with, or null when the lease is
 * current. When the body carries no token-bound serviceId (e.g. the in-process
 * local-platform dev path, which is single-process and has no zombie window)
 * the fence is skipped.
 */
async function ensureRunLease(
  env: Env,
  runId: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const serviceId = readRunServiceId(body);
  if (!serviceId) return null;
  const leaseVersion = typeof body.leaseVersion === "number"
    ? body.leaseVersion
    : null;
  const run = await getDb(env.DB).select({
    serviceId: runs.serviceId,
    leaseVersion: runs.leaseVersion,
  }).from(runs).where(eq(runs.id, runId)).get();
  if (!run) return err("Run not found", 404);
  if (run.serviceId !== serviceId) return err("Lease lost", 409);
  if (leaseVersion !== null && run.leaseVersion !== leaseVersion) {
    return err("Lease lost", 409);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Remote tool executor cache
// ---------------------------------------------------------------------------

type RemoteToolExecutorEntry = {
  promise: Promise<ToolExecutorLike>;
  createdAt: number;
};

const remoteToolExecutors = new Map<string, RemoteToolExecutorEntry>();

/**
 * Defence-in-depth TTL for {@link remoteToolExecutors}.
 *
 * Each entry is normally evicted by an explicit `cleanupRemoteToolExecutor`
 * call (handler {@link handleToolCleanup}). If that call is dropped or the
 * agent crashes between executor creation and cleanup, the entry would
 * otherwise live forever. We treat any entry older than this window as
 * stale and reclaim it.
 */
const REMOTE_TOOL_EXECUTOR_TTL_MS: TtlMs = ttlMs(60 * 60_000);

const recentRunEventKeys = new Map<string, number>();
const RUN_EVENT_DEDUP_TTL_MS: TtlMs = ttlMs(60 * 60_000);
const RUN_EVENT_DEDUP_MAX_KEYS = 10_000;

/** Test-only hook. Resets the executor cache. */
export function __resetRemoteToolExecutorsForTesting(): void {
  remoteToolExecutors.clear();
}

/** Test-only hook. Returns the current cache size. */
export function __remoteToolExecutorsSizeForTesting(): number {
  return remoteToolExecutors.size;
}

/** Test-only hook. Returns whether a particular runId is cached. */
export function __remoteToolExecutorHasForTesting(runId: string): boolean {
  return remoteToolExecutors.has(runId);
}

/** Test-only hook. Seeds an executor entry with a controlled timestamp. */
export function __setRemoteToolExecutorForTesting(
  runId: string,
  executor: ToolExecutorLike,
  createdAt: number,
): void {
  remoteToolExecutors.set(runId, {
    promise: Promise.resolve(executor),
    createdAt,
  });
}

async function createRemoteToolExecutor(
  runId: string,
  env: Env,
): Promise<ToolExecutorLike> {
  const bootstrap = await getRunBootstrap(env, runId);

  // The agent acts on behalf of the run's triggering user and must never hold
  // MORE authority than that user. Resolving capabilities with NO role floor
  // makes `assertToolPermission` evaluate the user's REAL space role, so an
  // editor-initiated run cannot invoke owner/admin-only operations (service /
  // skill delete, frontend deploy) that the user could not perform directly.
  // (A previous `minimumRole: "admin"` floor raised every agent run to admin,
  // erasing that boundary.)
  return createToolExecutor(
    env,
    env.DB,
    env.TAKOS_OFFLOAD,
    bootstrap.spaceId,
    bootstrap.sessionId ?? undefined,
    bootstrap.threadId,
    runId,
    bootstrap.userId,
    {
      disabledCustomTools: [...AGENT_DISABLED_CUSTOM_TOOLS],
    },
  );
}

/**
 * Evicts any executor entries whose age exceeds
 * {@link REMOTE_TOOL_EXECUTOR_TTL_MS}. Eviction also fires `cleanup()`
 * best-effort on the underlying executor so its own resources get released.
 */
function reapExpiredRemoteToolExecutors(nowMs: number): void {
  for (const [runId, entry] of remoteToolExecutors) {
    if (nowMs - entry.createdAt <= REMOTE_TOOL_EXECUTOR_TTL_MS) continue;
    remoteToolExecutors.delete(runId);
    void entry.promise.then(
      (executor) => {
        try {
          return executor.cleanup();
        } catch {
          // Best-effort: cleanup failures here are non-fatal.
        }
      },
      () => {
        // Best-effort: a failed-create entry needs no cleanup.
      },
    );
  }
}

async function getOrCreateRemoteToolExecutor(
  runId: string,
  env: Env,
): Promise<ToolExecutorLike> {
  const nowMs = Date.now();
  reapExpiredRemoteToolExecutors(nowMs);

  const existing = remoteToolExecutors.get(runId);
  if (existing) {
    return existing.promise;
  }

  const pending = createRemoteToolExecutor(runId, env);
  remoteToolExecutors.set(runId, { promise: pending, createdAt: nowMs });
  try {
    return await pending;
  } catch (error) {
    // The successful-resolve branch keeps the entry for handleToolCleanup;
    // any failed-create entry must be evicted so a retry can build fresh.
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
    const executor = await existing.promise;
    await executor.cleanup();
  } catch {
    // Best-effort cleanup.
  }
}

function buildRunEventDedupKey(
  runId: string,
  type: string,
  sequence: number,
): string {
  return `run:${runId}:sequence:${sequence}:type:${type}`;
}

function cleanupRecentRunEventKeys(nowMs: number): void {
  for (const [key, seenAt] of recentRunEventKeys) {
    if (nowMs - seenAt > RUN_EVENT_DEDUP_TTL_MS) {
      recentRunEventKeys.delete(key);
    }
  }
  if (recentRunEventKeys.size <= RUN_EVENT_DEDUP_MAX_KEYS) {
    return;
  }
  const overflow = recentRunEventKeys.size - RUN_EVENT_DEDUP_MAX_KEYS;
  let removed = 0;
  for (const key of recentRunEventKeys.keys()) {
    recentRunEventKeys.delete(key);
    removed++;
    if (removed >= overflow) break;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Resolve the agent runtime config for a run.
 *
 * Mirrors the local-platform handler at
 * `local-platform/executor-control-rpc.ts:localHandleRunConfig`. The takos-agent
 * (`agent/src/control_rpc.rs`) calls the canonical agent-control run-config
 * endpoint before each iteration to learn its system prompt, max iterations,
 * temperature, and tool list.
 */
export async function handleRunConfig(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const explicitAgentType = typeof body.agentType === "string"
    ? body.agentType
    : null;

  let agentType = explicitAgentType;
  if (!agentType && runId) {
    try {
      const db = getDb(env.DB);
      const run = await db.select({ agentType: runs.agentType })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      agentType = run?.agentType ?? null;
    } catch (e) {
      logWarn("Failed to look up run agentType", {
        module: "executor-host",
        detail: e,
      });
    }
  }

  const config = getAgentConfig(agentType ?? "default", env);
  const embeddingConfig = takosumiGatewayEmbeddingConfig(env);
  return ok({
    ...config,
    ...embeddingConfig,
    agentType: config.type,
    systemPrompt: config.systemPrompt,
    maxIterations: config.maxIterations ?? null,
    maxGraphSteps: config.maxIterations ?? null,
    maxToolRounds: config.maxIterations ?? null,
    temperature: config.temperature ?? null,
    rateLimit: config.rateLimit ?? null,
    tools: config.tools,
  });
}

export function takosumiGatewayEmbeddingConfig(
  env: Pick<
    Env,
    "OPENAI_API_KEY" | "TAKOSUMI_ACCOUNTS_URL" | "OIDC_ISSUER_URL"
  >,
):
  | {
    readonly embeddingProvider: "openai-compatible";
    readonly embeddingModel: "takosumi/default";
    readonly embeddingBaseUrl: string;
  }
  | undefined {
  if (env.OPENAI_API_KEY?.trim()) return undefined;
  const accountsUrl = env.TAKOSUMI_ACCOUNTS_URL?.trim() ||
    env.OIDC_ISSUER_URL?.trim();
  if (!accountsUrl) return undefined;
  try {
    const baseUrl = new URL("/gateway/ai/v1", accountsUrl);
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
      return undefined;
    }
    return {
      embeddingProvider: "openai-compatible",
      embeddingModel: "takosumi/default",
      embeddingBaseUrl: baseUrl.toString().replace(/\/$/u, ""),
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve the authoritative tenant + thread for a control RPC from the
 * token-bound run, never from caller-supplied body fields. executor-host
 * overwrites body.runId with the verified per-run proxy token, so runId is
 * trustworthy; the run row is the authority for accountId/threadId. This blocks
 * a compromised container from setting threadId/spaceId to a victim tenant's.
 */
export async function resolveRunThreadTenant(
  env: Env,
  runId: string,
): Promise<{ spaceId: string; threadId: string } | null> {
  const run = await getDb(env.DB).select({
    accountId: runs.accountId,
    threadId: runs.threadId,
  }).from(runs).where(eq(runs.id, runId)).get();
  if (!run || !run.threadId) return null;
  return { spaceId: run.accountId, threadId: run.threadId };
}

export async function handleConversationHistory(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    aiModel,
  } = body as {
    runId?: string;
    aiModel?: string;
  };
  if (!runId || !aiModel) {
    return err("Missing runId or aiModel", 400);
  }

  const tenant = await resolveRunThreadTenant(env, runId);
  if (!tenant) return err("Run not found", 404);
  const { spaceId, threadId } = tenant;

  try {
    const history = await buildConversationHistory({
      db: env.DB,
      env,
      threadId,
      runId,
      spaceId,
      aiModel,
    });
    return ok({ history });
  } catch (e: unknown) {
    logError("Conversation history RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleSkillPlan(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    agentType,
    history,
    availableToolNames,
  } = body as {
    runId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (
    !runId || !agentType || !Array.isArray(history) ||
    !Array.isArray(availableToolNames)
  ) {
    return err(
      "Missing runId, agentType, history, or availableToolNames",
      400,
    );
  }

  const tenant = await resolveRunThreadTenant(env, runId);
  if (!tenant) return err("Run not found", 404);
  const { spaceId, threadId } = tenant;

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
    logError("Skill plan RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleSkillCatalog(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    agentType,
    history,
    availableToolNames,
  } = body as {
    runId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (
    !runId || !agentType || !Array.isArray(history) ||
    !Array.isArray(availableToolNames)
  ) {
    return err(
      "Missing runId, agentType, history, or availableToolNames",
      400,
    );
  }

  const tenant = await resolveRunThreadTenant(env, runId);
  if (!tenant) return err("Run not found", 404);
  const { spaceId, threadId } = tenant;

  try {
    const resolutionContext = await buildSkillResolutionContext(
      env.DB,
      {
        threadId,
        runId,
        spaceId,
      },
      {
        type: agentType,
        systemPrompt: "",
        tools: [],
      },
      history,
    );
    const localeSamples = [
      ...(resolutionContext.conversation ?? []),
      resolutionContext.threadTitle ?? "",
      resolutionContext.threadSummary ?? "",
      ...((resolutionContext.threadKeyPoints ?? []).slice(0, 8)),
    ].filter(Boolean);
    const preferredLocale =
      typeof resolutionContext.runInput?.skill_locale === "string"
        ? resolutionContext.runInput.skill_locale
        : typeof resolutionContext.runInput?.locale === "string"
        ? resolutionContext.runInput.locale
        : resolutionContext.preferredLocale ??
          resolutionContext.spaceLocale ??
          (typeof resolutionContext.runInput?.accept_language === "string"
            ? resolutionContext.runInput.accept_language
            : null);

    const catalog = await listDetailedSkillContext(
      env.DB,
      spaceId,
      {
        preferredLocale,
        acceptLanguage: resolutionContext.acceptLanguage,
        textSamples: localeSamples,
      },
      availableToolNames,
    );
    return ok({
      locale: catalog.locale,
      skills: catalog.skills,
      resolutionContext,
    });
  } catch (e: unknown) {
    logError("Skill catalog RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleSkillRuntimeContext(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    agentType,
    history,
    availableToolNames,
  } = body as {
    runId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (
    !runId || !agentType || !Array.isArray(history)
  ) {
    return err("Missing runId, agentType, or history", 400);
  }

  const tenant = await resolveRunThreadTenant(env, runId);
  if (!tenant) return err("Run not found", 404);
  const { spaceId, threadId } = tenant;

  try {
    const resolutionContext = await buildSkillResolutionContext(
      env.DB,
      {
        threadId,
        runId,
        spaceId,
      },
      {
        type: agentType,
        systemPrompt: "",
        tools: [],
      },
      history,
    );
    const localeSamples = [
      ...(resolutionContext.conversation ?? []),
      resolutionContext.threadTitle ?? "",
      resolutionContext.threadSummary ?? "",
      ...((resolutionContext.threadKeyPoints ?? []).slice(0, 8)),
    ].filter(Boolean);
    const preferredLocale =
      typeof resolutionContext.runInput?.skill_locale === "string"
        ? resolutionContext.runInput.skill_locale
        : typeof resolutionContext.runInput?.locale === "string"
        ? resolutionContext.runInput.locale
        : resolutionContext.preferredLocale ??
          resolutionContext.spaceLocale ??
          (typeof resolutionContext.runInput?.accept_language === "string"
            ? resolutionContext.runInput.accept_language
            : null);

    const [catalog, mcpServers] = await Promise.all([
      listDetailedSkillContext(
        env.DB,
        spaceId,
        {
          preferredLocale,
          acceptLanguage: resolutionContext.acceptLanguage,
          textSamples: localeSamples,
        },
        Array.isArray(availableToolNames) ? availableToolNames : [],
      ),
      listMcpServers(env.DB, spaceId),
    ]);
    const managedSkills = catalog.skills.filter((skill) =>
      skill.source === "managed"
    );
    const customSkills = catalog.skills.filter((skill) =>
      skill.source === "custom"
    );

    return ok({
      locale: catalog.locale,
      resolutionContext,
      skills: catalog.skills,
      managedSkills,
      customSkills,
      availableMcpServerNames: mcpServers.filter((server) => server.enabled)
        .map((server) => server.name),
      availableTemplateIds: listSkillTemplates().map((template) => template.id),
    });
  } catch (e: unknown) {
    logError("Skill runtime context RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleMemoryActivation(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  // Tenant must come from the token-bound run, never from a caller-supplied
  // spaceId. The proxy host overwrites body.runId with the verified token's
  // runId, so the run record is the authoritative owner of this request.
  const activationRun = await getDb(env.DB).select({ accountId: runs.accountId })
    .from(runs).where(eq(runs.id, runId)).get();
  if (!activationRun) return err("Run not found", 404);
  const spaceId = activationRun.accountId;

  try {
    const claims = await getActiveClaims(env.DB, spaceId, 50);
    if (claims.length === 0) {
      return ok({ bundles: [], segment: "", hasContent: false });
    }

    const claimIds = claims.map((claim) => claim.id);
    const topClaims = claims.slice(0, 20);
    const [evidenceCounts, pathsArrays] = await Promise.all([
      countEvidenceForClaims(env.DB, spaceId, claimIds),
      Promise.all(
        topClaims.map((claim) =>
          getPathsForClaim(env.DB, spaceId, claim.id, 5)
        ),
      ),
    ]);

    const pathsByClaim = new Map<string, (typeof pathsArrays)[number]>();
    for (let i = 0; i < topClaims.length; i++) {
      if (pathsArrays[i].length > 0) {
        pathsByClaim.set(topClaims[i].id, pathsArrays[i]);
      }
    }

    const bundles = buildActivationBundles(
      claims,
      evidenceCounts,
      pathsByClaim,
    );
    return ok(renderActivationSegment(bundles));
  } catch (e: unknown) {
    logError("Memory activation RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleMemoryFinalize(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    claims,
    evidence,
  } = body as {
    runId?: string;
    claims?: Array<Record<string, unknown>>;
    evidence?: Array<Record<string, unknown>>;
  };
  if (
    !runId || !Array.isArray(claims) || !Array.isArray(evidence)
  ) {
    return err("Missing runId, claims, or evidence", 400);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  // Tenant is derived from the token-bound run, not from caller-supplied
  // spaceId / per-claim accountId, so a compromised container cannot write
  // claims or evidence into another tenant's memory graph.
  const finalizeRun = await getDb(env.DB).select({ accountId: runs.accountId })
    .from(runs).where(eq(runs.id, runId)).get();
  if (!finalizeRun) return err("Run not found", 404);
  const spaceId = finalizeRun.accountId;

  try {
    for (const claim of claims) {
      await upsertClaim(env.DB, {
        id: String(claim.id),
        accountId: spaceId,
        claimType: claim.claimType as
          | "fact"
          | "preference"
          | "decision"
          | "observation",
        subject: String(claim.subject ?? ""),
        predicate: String(claim.predicate ?? ""),
        object: String(claim.object ?? ""),
        confidence: typeof claim.confidence === "number"
          ? claim.confidence
          : 0.5,
        status: (claim.status as "active" | "superseded" | "retracted") ??
          "active",
        supersededBy: typeof claim.supersededBy === "string"
          ? claim.supersededBy
          : null,
        sourceRunId: typeof claim.sourceRunId === "string"
          ? claim.sourceRunId
          : runId,
      });
    }

    for (const item of evidence) {
      await insertEvidence(env.DB, {
        id: String(item.id),
        accountId: spaceId,
        claimId: String(item.claimId),
        kind: item.kind as "supports" | "contradicts" | "context",
        sourceType: item.sourceType as
          | "tool_result"
          | "user_message"
          | "agent_inference"
          | "memory_recall",
        sourceRef: typeof item.sourceRef === "string" ? item.sourceRef : null,
        content: String(item.content ?? ""),
        trust: typeof item.trust === "number" ? item.trust : 0.7,
        taint: typeof item.taint === "string" ? item.taint : null,
      });
    }

    if (env.INDEX_QUEUE) {
      await env.INDEX_QUEUE.send(
        {
          version: 1,
          jobId: crypto.randomUUID(),
          spaceId,
          type: "memory_build_paths",
          targetId: runId,
          timestamp: Date.now(),
        } satisfies IndexJobQueueMessage,
      );
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError("Memory finalize RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleAddMessage(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    threadId,
    message,
    metadata,
    idempotencyKey,
  } = body as {
    runId?: string;
    threadId?: string;
    message?: AgentMessage;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  };
  if (!runId || !threadId || !message || typeof message !== "object") {
    return err("Missing runId, threadId or message", 400);
  }
  if (
    (message.role !== "user" && message.role !== "assistant" &&
      message.role !== "system" && message.role !== "tool") ||
    typeof message.content !== "string"
  ) {
    return err("Invalid message payload", 400);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  // Bind the target thread to the token's run: the thread must belong to the
  // same account as the run, so a compromised container cannot inject messages
  // into another tenant's threads.
  const messageRun = await getDb(env.DB).select({ accountId: runs.accountId })
    .from(runs).where(eq(runs.id, runId)).get();
  if (!messageRun) return err("Run not found", 404);
  const targetThread = await getDb(env.DB).select({ accountId: threads.accountId })
    .from(threads).where(eq(threads.id, threadId)).get();
  if (!targetThread || targetThread.accountId !== messageRun.accountId) {
    return err("Thread not found", 404);
  }

  try {
    await persistMessage(
      {
        db: env.DB,
        env,
        threadId,
      },
      message,
      typeof idempotencyKey === "string" && idempotencyKey.trim()
        ? { ...(metadata ?? {}), idempotencyKey: idempotencyKey.trim() }
        : metadata,
    );
    return ok({ success: true });
  } catch (e: unknown) {
    logError("Add message RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleUpdateRunStatus(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    status,
    usage,
    output,
    error: errorMessage,
  } = body as {
    runId?: string;
    status?:
      | "pending"
      | "queued"
      | "running"
      | "completed"
      | "failed"
      | "cancelled";
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
    };
    output?: string;
    error?: string;
  };
  if (!runId || !status) {
    return err("Missing runId or status", 400);
  }
  if (
    !usage || typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number"
  ) {
    return err("Missing usage", 400);
  }

  // Lease identity is token-bound: executor-host stamps body.serviceId from the
  // verified per-run proxy token, so a stale (re-enqueued) container cannot
  // forge it. leaseVersion is only present when the agent echoes it.
  const serviceId = readRunServiceId(body);
  const leaseVersion = typeof body.leaseVersion === "number"
    ? body.leaseVersion
    : undefined;

  try {
    const result = await updateRunStatusImpl(
      env.DB,
      runId,
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        // Map the container's cached-prompt-token count onto the shared
        // AgentUsage `cacheReadTokens` field so runs.usage has one shape
        // regardless of execution path.
        ...(typeof usage.cachedInputTokens === "number"
          ? { cacheReadTokens: usage.cachedInputTokens }
          : {}),
      },
      status,
      output,
      errorMessage,
      serviceId ? { serviceId, leaseVersion } : undefined,
    );
    if (result.leaseLost) {
      return err("Lease lost", 409);
    }
    return ok({ success: true, updated: result.updated });
  } catch (e: unknown) {
    logError("Update run status RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleToolCatalog(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    const executor = await getOrCreateRemoteToolExecutor(runId, env);
    return ok({
      tools: executor.getAvailableTools(),
      mcpFailedServers: executor.mcpFailedServers,
    });
  } catch (e: unknown) {
    logError("Tool catalog RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleToolExecute(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, toolCall } = body as { runId?: string; toolCall?: ToolCall };
  if (!runId || !toolCall || typeof toolCall !== "object") {
    return err("Missing runId or toolCall", 400);
  }
  if (
    typeof toolCall.id !== "string" ||
    typeof toolCall.name !== "string" ||
    typeof toolCall.arguments !== "object" ||
    toolCall.arguments == null
  ) {
    return err("Invalid toolCall payload", 400);
  }

  // A superseded container must not keep running side-effecting tools (deploys,
  // space-file writes) for a run a fresh lease now owns — idempotency.ts only
  // dedups identical runId+tool+args, not divergent A-vs-B calls.
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  try {
    const executor = await getOrCreateRemoteToolExecutor(runId, env);
    return ok(await executor.execute(toolCall));
  } catch (e: unknown) {
    logError("Tool execute RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleToolCleanup(
  body: Record<string, unknown>,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  await cleanupRemoteToolExecutor(runId);
  return ok({ success: true });
}

export async function handleRunEvent(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    type,
    data,
    sequence,
    skipDb,
  } = body as {
    runId?: string;
    type?:
      | AgentMessage["role"]
      | "thinking"
      | "tool_call"
      | "tool_result"
      | "message"
      | "completed"
      | "error"
      | "progress"
      | "started"
      | "cancelled";
    data?: Record<string, unknown>;
    sequence?: number;
    skipDb?: boolean;
  };

  if (
    !runId || !type || !data || typeof data !== "object" ||
    typeof sequence !== "number"
  ) {
    return err("Missing runId, type, data, or sequence", 400);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  const dedupKey = buildRunEventDedupKey(runId, type, sequence);
  const nowMs = Date.now();
  cleanupRecentRunEventKeys(nowMs);
  if (recentRunEventKeys.has(dedupKey)) {
    return ok({ success: true, duplicate: true });
  }

  const now = new Date().toISOString();
  const offloadEnabled = Boolean(env.TAKOS_OFFLOAD);
  let sqlEventId: number | null = null;
  let duplicate = false;

  try {
    if (!skipDb && !offloadEnabled) {
      const db = getDb(env.DB);
      const existing = await db.select({ id: runEvents.id })
        .from(runEvents)
        .where(and(
          eq(runEvents.runId, runId),
          eq(runEvents.eventKey, dedupKey),
        ))
        .get();
      if (existing) {
        sqlEventId = existing.id;
        duplicate = true;
      } else {
        try {
          const persisted = await db.insert(runEvents).values({
            runId,
            type,
            eventKey: dedupKey,
            data: JSON.stringify({ ...data, _sequence: sequence }),
            createdAt: now,
          }).returning({ id: runEvents.id }).get();
          sqlEventId = persisted?.id ?? null;
        } catch (insertError) {
          const raced = await db.select({ id: runEvents.id })
            .from(runEvents)
            .where(and(
              eq(runEvents.runId, runId),
              eq(runEvents.eventKey, dedupKey),
            ))
            .get();
          if (!raced) throw insertError;
          sqlEventId = raced.id;
          duplicate = true;
        }
      }
    }

    const stub = getRunNotifierStub(env, runId);
    const emitResponse = await stub.fetch(
      buildRunNotifierEmitRequest(
        {
          ...buildRunNotifierEmitPayload(runId, type, data, sqlEventId),
          dedup_key: dedupKey,
        },
      ),
    );

    if (!emitResponse.ok) {
      const text = await emitResponse.text().catch((e) => {
        logWarn("Failed to read run event emit response body", {
          module: "executor-host",
          error: String(e),
        });
        return "";
      });
      return err(
        `Run event emit failed: ${emitResponse.status} ${text}`.trim(),
        502,
      );
    }

    recentRunEventKeys.set(dedupKey, nowMs);
    const emitBody = await emitResponse.clone().json().catch(() => null);
    const durableDuplicate = !!(
      emitBody && typeof emitBody === "object" &&
      (emitBody as Record<string, unknown>).duplicate === true
    );
    return ok({
      success: true,
      ...(duplicate || durableDuplicate ? { duplicate: true } : {}),
    });
  } catch (e: unknown) {
    logError("Run event RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}
