/**
 * Control-plane RPC handlers for the executor-host subsystem.
 *
 * These handlers back the canonical Takos-owned
 * /api/internal/v1/agent-control/* route family.
 */

import { getDb } from "../../infra/db/index.ts";
import {
  runEvents,
  runs,
  threads,
  toolOperations,
} from "../../infra/db/schema.ts";
import { and, eq, isNull } from "drizzle-orm";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { affectedRowCount } from "../../shared/utils/affected-row-count.ts";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";
import { persistMessage } from "../../application/services/agent/message-persistence.ts";
import type { AgentMessage } from "../../application/services/agent/agent-models.ts";
import {
  buildConversationHistory,
  updateRunStatusImpl,
} from "../../application/services/agent/runner-history.ts";
import { getAgentConfig } from "../../application/services/agent/runner-config.ts";
import {
  completeRunAtomically,
  type CompleteRunMessage,
  type CompleteRunStatus,
} from "../../application/services/agent/complete-run.ts";
import { dispatchTerminalIndexOutbox } from "../../application/services/run-notifier/index-outbox.ts";
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
import { listSkillTemplates } from "../../application/services/agent/skill-templates.ts";
import { listMcpServers } from "../../application/services/platform/mcp.ts";
import {
  buildTerminalPayload,
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
} from "../../application/services/run-notifier/index.ts";
import type { Env } from "../../shared/types/index.ts";
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
export async function ensureRunLease(
  env: Env,
  runId: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const serviceId = readRunServiceId(body);
  if (!serviceId) return null;
  const leaseVersion =
    typeof body.leaseVersion === "number" ? body.leaseVersion : null;
  let run:
    | { serviceId: string | null; leaseVersion: number; status: string }
    | undefined;
  try {
    run = await getDb(env.DB)
      .select({
        serviceId: runs.serviceId,
        leaseVersion: runs.leaseVersion,
        status: runs.status,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
  } catch (error) {
    logError("Run lease lookup failed", error, {
      module: "executor-host",
      runId,
    });
    return err("Run lease lookup failed", 503);
  }
  if (!run) return err("Run not found", 404);
  if (run.serviceId !== serviceId) return err("Lease lost", 409);
  if (leaseVersion !== null && run.leaseVersion !== leaseVersion) {
    return err("Lease lost", 409);
  }
  if (run.status !== "running") {
    // Terminal status revokes the executor's authority just like a replaced
    // service/lease. Keep the canonical lease-lost wire signal so the Rust
    // heartbeat/finalization path cancels cleanly instead of retrying failure
    // reporting for a user-cancelled run.
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
  identity: NormalizedRemoteToolExecutorIdentity | null;
  abortController: AbortController;
};

const remoteToolExecutors = new Map<string, RemoteToolExecutorEntry>();

type RemoteToolExecutorIdentity = {
  runId?: unknown;
  serviceId?: unknown;
  workerId?: unknown;
  leaseVersion?: unknown;
};

type NormalizedRemoteToolExecutorIdentity = {
  runId: string;
  serviceId: string | null;
  leaseVersion: number | null;
};

function normalizeRemoteToolExecutorIdentity(
  identity: RemoteToolExecutorIdentity,
): NormalizedRemoteToolExecutorIdentity {
  return {
    runId: typeof identity.runId === "string" ? identity.runId : "",
    serviceId:
      typeof identity.serviceId === "string"
        ? identity.serviceId
        : typeof identity.workerId === "string"
          ? identity.workerId
          : null,
    leaseVersion:
      typeof identity.leaseVersion === "number" ? identity.leaseVersion : null,
  };
}

/**
 * A tool executor belongs to one run lease, not merely to a stable run id.
 * Stale-recovery intentionally reuses runId while replacing serviceId and
 * incrementing leaseVersion. Encoding the complete authority identity keeps a
 * late cleanup from the old container from deleting the fresh lease's MCP/tool
 * state.
 */
export function remoteToolExecutorCacheKey(
  identity: RemoteToolExecutorIdentity,
): string {
  const normalized = normalizeRemoteToolExecutorIdentity(identity);
  return JSON.stringify([
    normalized.runId,
    normalized.serviceId,
    normalized.leaseVersion,
  ]);
}

function abortRemoteToolExecutorEntry(entry: RemoteToolExecutorEntry): void {
  if (!entry.abortController.signal.aborted) entry.abortController.abort();
}

function abortMatchingRemoteToolExecutors(
  predicate: (identity: NormalizedRemoteToolExecutorIdentity) => boolean,
): number {
  let aborted = 0;
  for (const entry of remoteToolExecutors.values()) {
    if (!entry.identity || !predicate(entry.identity)) continue;
    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort();
      aborted++;
    }
  }
  return aborted;
}

/** Abort every in-flight tool execution belonging to a terminal/cancelled run. */
export function abortRemoteToolExecutorsForRun(runId: string): number {
  return abortMatchingRemoteToolExecutors(
    (identity) => identity.runId === runId,
  );
}

/** Abort only one exact stale run lease, never a replacement controller. */
export function abortRemoteToolExecutorsForLease(
  identity: RemoteToolExecutorIdentity,
): number {
  const expected = normalizeRemoteToolExecutorIdentity(identity);
  return abortMatchingRemoteToolExecutors(
    (candidate) =>
      candidate.runId === expected.runId &&
      candidate.serviceId === expected.serviceId &&
      candidate.leaseVersion === expected.leaseVersion,
  );
}

/** Abort older leases while preserving exact duplicates and higher versions. */
export function abortSupersededRemoteToolExecutors(
  identity: RemoteToolExecutorIdentity,
): number {
  const current = normalizeRemoteToolExecutorIdentity(identity);
  return abortMatchingRemoteToolExecutors((candidate) => {
    if (candidate.runId !== current.runId) return false;
    if (
      candidate.serviceId === current.serviceId &&
      candidate.leaseVersion === current.leaseVersion
    ) {
      return false;
    }
    if (
      candidate.leaseVersion !== null &&
      (current.leaseVersion === null ||
        candidate.leaseVersion > current.leaseVersion)
    ) {
      return false;
    }
    return true;
  });
}

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

type TerminalControlStatus = "completed" | "failed" | "cancelled";
const ALLOWED_RUN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "user",
  "assistant",
  "system",
  "tool",
  "thinking",
  "tool_call",
  "tool_result",
  "message",
  "completed",
  "error",
  "progress",
  "started",
  "cancelled",
]);

/**
 * Persist the canonical terminal event inside the status RPC boundary, before
 * executor-host revokes the run token after the response. A stable event key
 * makes retries idempotent. Terminal events always remain in SQL so replay has
 * a durable fallback when offload or the notifier is temporarily unavailable.
 */
async function persistTerminalStatusEvent(
  env: Env,
  runId: string,
  status: TerminalControlStatus,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getDb(env.DB);
  const eventType = status === "failed" ? "error" : status;
  const eventKey = `run:${runId}:terminal-status:${status}`;
  let eventId: number | null = null;

  const existing = await db
    .select({ id: runEvents.id })
    .from(runEvents)
    .where(eq(runEvents.eventKey, eventKey))
    .get();
  if (existing) {
    eventId = existing.id;
  } else {
    try {
      const inserted = await db
        .insert(runEvents)
        .values({
          runId,
          type: eventType,
          eventKey,
          data: JSON.stringify(data),
          createdAt: new Date().toISOString(),
        })
        .returning({ id: runEvents.id })
        .get();
      eventId = inserted?.id ?? null;
    } catch (insertError) {
      const raced = await db
        .select({ id: runEvents.id })
        .from(runEvents)
        .where(eq(runEvents.eventKey, eventKey))
        .get();
      if (!raced) throw insertError;
      eventId = raced.id;
    }
  }

  try {
    const stub = getRunNotifierStub(env, runId);
    const response = await stub.fetch(
      buildRunNotifierEmitRequest({
        ...buildRunNotifierEmitPayload(runId, eventType, data, eventId),
        dedup_key: eventKey,
      }),
    );
    if (!response.ok) {
      logWarn("Terminal run event notifier emit failed", {
        module: "executor-host",
        runId,
        status,
        notifierStatus: response.status,
      });
    }
  } catch (notifyError) {
    // SQL is the durable source for replay; notifier delivery is best effort.
    logWarn("Terminal run event notifier emit failed", {
      module: "executor-host",
      runId,
      status,
      error: String(notifyError),
    });
  }
}

/** Test-only hook. Resets the executor cache. */
export function __resetRemoteToolExecutorsForTesting(): void {
  for (const entry of remoteToolExecutors.values()) {
    abortRemoteToolExecutorEntry(entry);
  }
  remoteToolExecutors.clear();
}

/** Test-only hook. Returns the current cache size. */
export function __remoteToolExecutorsSizeForTesting(): number {
  return remoteToolExecutors.size;
}

/** Test-only hook. Returns whether a particular cache identity is cached. */
export function __remoteToolExecutorHasForTesting(
  identity: string | RemoteToolExecutorIdentity,
): boolean {
  const key =
    typeof identity === "string"
      ? identity
      : remoteToolExecutorCacheKey(identity);
  return remoteToolExecutors.has(key);
}

/** Test-only hook. Returns the run-level cancellation signal for an entry. */
export function __remoteToolExecutorAbortSignalForTesting(
  identity: string | RemoteToolExecutorIdentity,
): AbortSignal | null {
  const key =
    typeof identity === "string"
      ? identity
      : remoteToolExecutorCacheKey(identity);
  return remoteToolExecutors.get(key)?.abortController.signal ?? null;
}

/** Test-only hook. Seeds an executor entry with a controlled timestamp. */
export function __setRemoteToolExecutorForTesting(
  identity: string | RemoteToolExecutorIdentity,
  executor: ToolExecutorLike,
  createdAt: number,
): void {
  const key =
    typeof identity === "string"
      ? identity
      : remoteToolExecutorCacheKey(identity);
  remoteToolExecutors.set(key, {
    promise: Promise.resolve(executor),
    createdAt,
    identity:
      typeof identity === "string"
        ? null
        : normalizeRemoteToolExecutorIdentity(identity),
    abortController: new AbortController(),
  });
}

async function createRemoteToolExecutor(
  runId: string,
  env: Env,
  runAbortSignal: AbortSignal,
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
    bootstrap.threadId,
    runId,
    bootstrap.userId,
    {
      disabledCustomTools: [...AGENT_DISABLED_CUSTOM_TOOLS],
    },
    undefined,
    runAbortSignal,
  );
}

/**
 * Evicts any executor entries whose age exceeds
 * {@link REMOTE_TOOL_EXECUTOR_TTL_MS}. Eviction also fires `cleanup()`
 * best-effort on the underlying executor so its own resources get released.
 */
function reapExpiredRemoteToolExecutors(nowMs: number): void {
  for (const [cacheKey, entry] of remoteToolExecutors) {
    if (nowMs - entry.createdAt <= REMOTE_TOOL_EXECUTOR_TTL_MS) continue;
    remoteToolExecutors.delete(cacheKey);
    abortRemoteToolExecutorEntry(entry);
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
  identity: RemoteToolExecutorIdentity,
  env: Env,
): Promise<RemoteToolExecutorEntry> {
  const nowMs = Date.now();
  reapExpiredRemoteToolExecutors(nowMs);
  const cacheKey = remoteToolExecutorCacheKey(identity);

  const existing = remoteToolExecutors.get(cacheKey);
  if (existing) {
    await existing.promise;
    return existing;
  }

  const abortController = new AbortController();
  const normalizedIdentity = normalizeRemoteToolExecutorIdentity(identity);
  const pending = createRemoteToolExecutor(runId, env, abortController.signal);
  const entry: RemoteToolExecutorEntry = {
    promise: pending,
    createdAt: nowMs,
    identity: normalizedIdentity,
    abortController,
  };
  remoteToolExecutors.set(cacheKey, entry);
  try {
    await pending;
    return entry;
  } catch (error) {
    // The successful-resolve branch keeps the entry for handleToolCleanup;
    // any failed-create entry must be evicted so a retry can build fresh.
    if (remoteToolExecutors.get(cacheKey)?.promise === pending) {
      remoteToolExecutors.delete(cacheKey);
    }
    abortRemoteToolExecutorEntry(entry);
    throw error;
  }
}

async function cleanupRemoteToolExecutor(
  identity: RemoteToolExecutorIdentity,
): Promise<void> {
  const cacheKey = remoteToolExecutorCacheKey(identity);
  const existing = remoteToolExecutors.get(cacheKey);
  if (!existing) {
    return;
  }
  remoteToolExecutors.delete(cacheKey);
  abortRemoteToolExecutorEntry(existing);
  try {
    const executor = await existing.promise;
    await executor.cleanup();
  } catch {
    // Best-effort cleanup.
  }
}

const DEFAULT_RUN_LEASE_POLL_INTERVAL_MS = 2_000;
const MAX_RUN_LEASE_POLL_INTERVAL_MS = 5_000;

function runLeasePollIntervalMs(env: Env): number {
  const parsed = Number.parseInt(
    env.TAKOS_AGENT_RUN_LEASE_POLL_INTERVAL_MS ?? "",
    10,
  );
  if (!Number.isFinite(parsed)) return DEFAULT_RUN_LEASE_POLL_INTERVAL_MS;
  return Math.max(10, Math.min(MAX_RUN_LEASE_POLL_INTERVAL_MS, parsed));
}

function waitForLeasePoll(
  intervalMs: number,
  stopSignal: AbortSignal,
): Promise<boolean> {
  if (stopSignal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (shouldPoll: boolean) => {
      clearTimeout(timer);
      stopSignal.removeEventListener("abort", onAbort);
      resolve(shouldPoll);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), intervalMs);
    stopSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Cross-isolate cancellation fence for long-running MCP/web tools. Token-map
 * revocation and cache AbortControllers are isolate-local, while user cancel
 * and stale recovery can land elsewhere. Poll the authoritative DB lease at a
 * bounded <=5s cadence for the lifetime of one execute request and abort the
 * exact cache entry when status/service/version changes.
 */
async function monitorRemoteToolExecutorLease(
  env: Env,
  entry: RemoteToolExecutorEntry,
  stopSignal: AbortSignal,
): Promise<void> {
  const identity = entry.identity;
  if (!identity?.runId || !identity.serviceId) return;
  const body: Record<string, unknown> = {
    runId: identity.runId,
    serviceId: identity.serviceId,
    ...(identity.leaseVersion !== null
      ? { leaseVersion: identity.leaseVersion }
      : {}),
  };
  const intervalMs = runLeasePollIntervalMs(env);
  while (await waitForLeasePoll(intervalMs, stopSignal)) {
    const leaseError = await ensureRunLease(env, identity.runId, body);
    if (!leaseError) continue;
    // A transient DB failure is not evidence that authority was revoked. Keep
    // polling; the tool's own timeout remains the availability bound.
    if (leaseError.status !== 404 && leaseError.status !== 409) continue;
    abortRemoteToolExecutorEntry(entry);
    return;
  }
}

function buildRunEventDedupKey(
  runId: string,
  leaseVersion: number | null,
  type: string,
  sequence: number,
): string {
  return `run:${runId}:lease:${leaseVersion ?? "local"}:sequence:${sequence}:type:${type}`;
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
 * The takos-agent wrapper reads this once while starting a run. It carries only
 * Worker-owned prompt policy and the engine graph/tool-round budgets plus
 * temperature; the separate tool-catalog RPC is the sole tool authority.
 */
export async function handleRunConfig(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const explicitAgentType =
    typeof body.agentType === "string" ? body.agentType : null;

  let agentType = explicitAgentType;
  if (!agentType && runId) {
    try {
      const db = getDb(env.DB);
      const run = await db
        .select({ agentType: runs.agentType })
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
  return ok({
    agentType: config.type,
    systemPrompt: config.systemPrompt,
    maxGraphSteps: config.maxGraphSteps ?? null,
    maxToolRounds: config.maxToolRounds ?? null,
    temperature: config.temperature ?? null,
  });
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
  const run = await getDb(env.DB)
    .select({
      accountId: runs.accountId,
      threadId: runs.threadId,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (!run || !run.threadId) return null;
  return { spaceId: run.accountId, threadId: run.threadId };
}

export async function handleConversationHistory(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, aiModel } = body as {
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
  const { runId, agentType, history, availableToolNames } = body as {
    runId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (
    !runId ||
    !agentType ||
    !Array.isArray(history) ||
    !Array.isArray(availableToolNames)
  ) {
    return err("Missing runId, agentType, history, or availableToolNames", 400);
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
  const { runId, agentType, history, availableToolNames } = body as {
    runId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (
    !runId ||
    !agentType ||
    !Array.isArray(history) ||
    !Array.isArray(availableToolNames)
  ) {
    return err("Missing runId, agentType, history, or availableToolNames", 400);
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
      ...(resolutionContext.threadKeyPoints ?? []).slice(0, 8),
    ].filter(Boolean);
    const preferredLocale =
      typeof resolutionContext.runInput?.skill_locale === "string"
        ? resolutionContext.runInput.skill_locale
        : typeof resolutionContext.runInput?.locale === "string"
          ? resolutionContext.runInput.locale
          : (resolutionContext.preferredLocale ??
            resolutionContext.spaceLocale ??
            (typeof resolutionContext.runInput?.accept_language === "string"
              ? resolutionContext.runInput.accept_language
              : null));

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
  const { runId, agentType, history, availableToolNames } = body as {
    runId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (!runId || !agentType || !Array.isArray(history)) {
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
    const [plan, mcpServers] = await Promise.all([
      resolveSkillPlanForRun(env.DB, {
        runId,
        threadId,
        spaceId,
        agentType,
        history,
        availableToolNames: Array.isArray(availableToolNames)
          ? availableToolNames
          : [],
      }),
      listMcpServers(env.DB, spaceId),
    ]);
    const managedSkills = plan.activatedSkills.filter(
      (skill) => skill.source === "managed",
    );
    const customSkills = plan.activatedSkills.filter(
      (skill) => skill.source === "custom",
    );

    return ok({
      locale: plan.skillLocale,
      resolutionContext,
      skills: plan.activatedSkills,
      managedSkills,
      customSkills,
      availableMcpServerNames: mcpServers
        .filter((server) => server.enabled)
        .map((server) => server.name),
      availableTemplateIds: listSkillTemplates().map((template) => template.id),
    });
  } catch (e: unknown) {
    logError("Skill runtime context RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleAddMessage(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, threadId, message, metadata, idempotencyKey } = body as {
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
    (message.role !== "user" &&
      message.role !== "assistant" &&
      message.role !== "system" &&
      message.role !== "tool") ||
    typeof message.content !== "string"
  ) {
    return err("Invalid message payload", 400);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  // Bind the target thread to the token's run: the thread must belong to the
  // same account as the run, so a compromised container cannot inject messages
  // into another tenant's threads.
  const messageRun = await getDb(env.DB)
    .select({ accountId: runs.accountId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (!messageRun) return err("Run not found", 404);
  const targetThread = await getDb(env.DB)
    .select({ accountId: threads.accountId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
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
      "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";
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
    !usage ||
    typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number"
  ) {
    return err("Missing usage", 400);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  // Lease identity is token-bound: executor-host stamps body.serviceId from the
  // verified per-run proxy token, so a stale (re-enqueued) container cannot
  // forge it. leaseVersion is only present when the agent echoes it.
  const serviceId = readRunServiceId(body);
  const leaseVersion =
    typeof body.leaseVersion === "number" ? body.leaseVersion : undefined;

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
    if (!result.updated) {
      return err("Lease lost", 409);
    }

    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      const terminalRun = await getDb(env.DB)
        .select({
          sessionId: runs.sessionId,
        })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      const terminalPayload = buildTerminalPayload(
        runId,
        status,
        {
          ...(status === "completed" ? { success: true } : {}),
          ...(typeof output === "string" ? { output } : {}),
          ...(typeof errorMessage === "string"
            ? { error: errorMessage, message: errorMessage }
            : {}),
          usage,
        },
        terminalRun?.sessionId ?? null,
      );
      await persistTerminalStatusEvent(env, runId, status, terminalPayload);
    }
    return ok({ success: true, updated: result.updated });
  } catch (e: unknown) {
    logError("Update run status RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export function parseCompleteRunMessages(
  value: unknown,
): CompleteRunMessage[] | null {
  const MAX_MESSAGES = 256;
  const MAX_MESSAGE_BYTES = 512 * 1024;
  const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
  const MAX_METADATA_BYTES = 64 * 1024;
  const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
  const MAX_TOOL_CALLS_PER_MESSAGE = 16;
  const MAX_IDENTIFIER_LENGTH = 256;
  const MAX_JSON_DEPTH = 32;
  const MAX_JSON_NODES = 4_096;
  const isBoundedJson = (root: unknown): boolean => {
    const pending: Array<{ value: unknown; depth: number }> = [
      { value: root, depth: 0 },
    ];
    const seen = new WeakSet<object>();
    let nodes = 0;
    while (pending.length > 0) {
      const current = pending.pop()!;
      nodes++;
      if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH)
        return false;
      const item = current.value;
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "boolean"
      ) {
        continue;
      }
      if (typeof item === "number") {
        if (!Number.isFinite(item)) return false;
        continue;
      }
      if (!item || typeof item !== "object") return false;
      if (seen.has(item)) return false;
      seen.add(item);
      if (Array.isArray(item)) {
        for (const child of item) {
          pending.push({ value: child, depth: current.depth + 1 });
        }
        continue;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const child of Object.values(item as Record<string, unknown>)) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
    return true;
  };
  const jsonBytes = (item: unknown): number | null => {
    try {
      return encoder.encode(JSON.stringify(item)).byteLength;
    } catch {
      return null;
    }
  };
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) return null;
  const messages: CompleteRunMessage[] = [];
  const pendingToolCallIds = new Set<string>();
  const seenToolCallIds = new Set<string>();
  const encoder = new TextEncoder();
  let transcriptBytes = 0;
  for (const candidate of value) {
    transcriptBytes += 32;
    if (transcriptBytes > MAX_TRANSCRIPT_BYTES) return null;
    if (!candidate || typeof candidate !== "object") return null;
    const item = candidate as Record<string, unknown>;
    if (
      (item.role !== "assistant" && item.role !== "tool") ||
      typeof item.content !== "string"
    ) {
      return null;
    }
    const contentBytes = encoder.encode(item.content).byteLength;
    transcriptBytes += contentBytes;
    if (
      contentBytes > MAX_MESSAGE_BYTES ||
      transcriptBytes > MAX_TRANSCRIPT_BYTES
    ) {
      return null;
    }
    if (
      item.metadata !== undefined &&
      (!item.metadata ||
        typeof item.metadata !== "object" ||
        Array.isArray(item.metadata) ||
        (Object.getPrototypeOf(item.metadata) !== Object.prototype &&
          Object.getPrototypeOf(item.metadata) !== null))
    ) {
      return null;
    }
    if (
      item.metadata !== undefined &&
      (() => {
        if (!isBoundedJson(item.metadata)) return true;
        const bytes = jsonBytes(item.metadata);
        if (bytes === null) return true;
        transcriptBytes += bytes;
        return (
          bytes > MAX_METADATA_BYTES || transcriptBytes > MAX_TRANSCRIPT_BYTES
        );
      })()
    ) {
      return null;
    }
    const toolCallId =
      typeof item.tool_call_id === "string" ? item.tool_call_id : undefined;
    if (item.role === "tool") {
      if (toolCallId) {
        transcriptBytes += encoder.encode(toolCallId).byteLength;
        if (transcriptBytes > MAX_TRANSCRIPT_BYTES) return null;
      }
      if (
        item.tool_calls !== undefined ||
        !toolCallId ||
        toolCallId.length > MAX_IDENTIFIER_LENGTH ||
        !pendingToolCallIds.delete(toolCallId)
      ) {
        return null;
      }
    } else if (pendingToolCallIds.size > 0) {
      // A new assistant item cannot start until every result for the prior
      // parallel tool-call batch is present.
      return null;
    } else if (item.tool_call_id !== undefined) {
      return null;
    }
    let toolCalls: ToolCall[] | undefined;
    if (item.tool_calls !== undefined) {
      if (
        !Array.isArray(item.tool_calls) ||
        item.tool_calls.length > MAX_TOOL_CALLS_PER_MESSAGE
      ) {
        return null;
      }
      toolCalls = [];
      for (const call of item.tool_calls) {
        if (!call || typeof call !== "object") return null;
        const flat = call as Record<string, unknown>;
        if (
          typeof flat.id !== "string" ||
          !flat.id ||
          flat.id.length > MAX_IDENTIFIER_LENGTH ||
          typeof flat.name !== "string" ||
          !flat.name ||
          flat.name.length > MAX_IDENTIFIER_LENGTH ||
          !flat.arguments ||
          typeof flat.arguments !== "object" ||
          Array.isArray(flat.arguments)
        ) {
          return null;
        }
        if (!isBoundedJson(flat.arguments)) return null;
        const argumentBytes = jsonBytes(flat.arguments);
        if (argumentBytes === null) return null;
        transcriptBytes +=
          encoder.encode(flat.id).byteLength +
          encoder.encode(flat.name).byteLength +
          argumentBytes +
          24;
        if (
          argumentBytes > MAX_TOOL_ARGUMENT_BYTES ||
          transcriptBytes > MAX_TRANSCRIPT_BYTES
        ) {
          return null;
        }
        if (seenToolCallIds.has(flat.id)) return null;
        seenToolCallIds.add(flat.id);
        pendingToolCallIds.add(flat.id);
        toolCalls.push({
          id: flat.id,
          name: flat.name,
          arguments: flat.arguments as Record<string, unknown>,
        });
      }
    }
    messages.push({
      role: item.role,
      content: item.content,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
      ...(item.metadata
        ? { metadata: item.metadata as Record<string, unknown> }
        : {}),
    });
  }
  return pendingToolCallIds.size === 0 ? messages : null;
}

/**
 * Commit the product-owned transcript and terminal run ledger as one
 * lease-fenced DB operation. The notifier is deliberately post-commit and
 * best-effort; SQL remains replay authority.
 */
export async function handleCompleteRun(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const status = body.status as CompleteRunStatus | undefined;
  const usage = body.usage as Record<string, unknown> | undefined;
  const messages = parseCompleteRunMessages(body.messages);
  const leaseVersion = body.leaseVersion;
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const cachedInputTokens = usage?.cachedInputTokens;
  const validUsageInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (
    !runId ||
    !serviceId ||
    (status !== "completed" && status !== "failed") ||
    !usage ||
    !validUsageInteger(inputTokens) ||
    !validUsageInteger(outputTokens) ||
    (cachedInputTokens !== undefined &&
      (!validUsageInteger(cachedInputTokens) ||
        cachedInputTokens > inputTokens)) ||
    typeof leaseVersion !== "number" ||
    !Number.isSafeInteger(leaseVersion) ||
    leaseVersion < 0 ||
    messages === null
  ) {
    return err("Invalid complete-run payload", 400);
  }
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) {
    abortRemoteToolExecutorsForLease(body);
    return leaseError;
  }
  const output = typeof body.output === "string" ? body.output : undefined;
  const errorMessage = typeof body.error === "string" ? body.error : undefined;
  if (
    (output !== undefined &&
      new TextEncoder().encode(output).byteLength > 512 * 1024) ||
    (errorMessage !== undefined &&
      new TextEncoder().encode(errorMessage).byteLength > 64 * 1024)
  ) {
    return err("Invalid complete-run payload", 400);
  }
  const terminalRun = await getDb(env.DB)
    .select({
      sessionId: runs.sessionId,
      threadId: runs.threadId,
      engineCheckpoint: runs.engineCheckpoint,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (!terminalRun?.threadId) return err("Run not found", 404);
  const normalizedUsage = {
    inputTokens,
    outputTokens,
    ...(cachedInputTokens !== undefined
      ? { cacheReadTokens: cachedInputTokens }
      : {}),
  };
  const terminalPayload = buildTerminalPayload(
    runId,
    status,
    {
      ...(status === "completed" ? { success: true } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(errorMessage !== undefined
        ? { error: errorMessage, message: errorMessage }
        : {}),
      usage: normalizedUsage,
    },
    terminalRun?.sessionId ?? null,
  );

  try {
    const result = await completeRunAtomically(
      env.DB,
      {
        runId,
        threadId: terminalRun.threadId,
        serviceId,
        leaseVersion,
        status,
        usage: normalizedUsage,
        output,
        error: errorMessage,
        messages,
        terminalEvent: terminalPayload,
      },
      {
        offloadBucket: env.TAKOS_OFFLOAD,
        expectedEngineCheckpoint: terminalRun.engineCheckpoint,
      },
    );
    if (!result.committed) {
      abortRemoteToolExecutorsForLease(body);
      return err("Lease lost", 409);
    }
    abortRemoteToolExecutorsForRun(runId);
    const committedCheckpointKey = engineCheckpointR2KeyFromStored(
      terminalRun.engineCheckpoint,
    );
    if (env.TAKOS_OFFLOAD && committedCheckpointKey) {
      await env.TAKOS_OFFLOAD.delete(committedCheckpointKey).catch(
        (checkpointCleanupError) => {
          logWarn("Committed engine checkpoint cleanup failed", {
            module: "executor-host",
            runId,
            error: String(checkpointCleanupError),
          });
        },
      );
    }

    // Commit first. A notifier failure cannot roll back or split transcript,
    // outcome, usage, and terminal replay evidence.
    try {
      const stub = getRunNotifierStub(env, runId);
      for (const [index, message] of messages.entries()) {
        if (message.role !== "assistant" || !message.content) continue;
        await stub.fetch(
          buildRunNotifierEmitRequest({
            ...buildRunNotifierEmitPayload(
              runId,
              "message",
              { content: message.content },
              null,
            ),
            dedup_key: `run:${runId}:completion:${result.completionKey}:message:${index}`,
          }),
        );
      }
      await stub.fetch(
        buildRunNotifierEmitRequest({
          ...buildRunNotifierEmitPayload(
            runId,
            status === "failed" ? "error" : status,
            terminalPayload,
            result.eventId,
          ),
          dedup_key: `run:${runId}:completion:${result.completionKey}:terminal-status:${status}`,
        }),
      );
    } catch (notifyError) {
      logWarn("Complete-run notifier emit failed", {
        module: "executor-host",
        runId,
        error: String(notifyError),
      });
    }

    // The transaction already made these jobs durable. Flush only after the
    // best-effort notifier writes so the indexer normally observes the full
    // tool/message event stream. Runner cron still recovers queued or
    // crash-left rows, and the indexer merges SQL terminal evidence when the
    // notifier could not persist an offload segment.
    try {
      await dispatchTerminalIndexOutbox(env, {
        completionKey: result.completionKey,
      });
    } catch (indexError) {
      logWarn("Complete-run index outbox flush failed", {
        module: "executor-host",
        runId,
        error: String(indexError),
      });
    }
    return ok({
      success: true,
      committed: true,
      idempotent: result.idempotent,
    });
  } catch (error) {
    logError("Complete-run atomic commit failed", error, {
      module: "executor-host",
      runId,
    });
    const classified = classifyProxyError(error);
    return err(classified.message, classified.status);
  }
}

const MAX_ENGINE_CHECKPOINT_BYTES = 16 * 1024 * 1024;
// Cloudflare D1 limits one string/table row to 2,000,000 bytes. A valid Run
// input can already approach the product's 1 MiB request cap, so keep at least
// ~450 KiB of row headroom and offload larger opaque state to TAKOS_OFFLOAD.
const MAX_INLINE_ENGINE_CHECKPOINT_BYTES = 512 * 1024;
const ENGINE_CHECKPOINT_R2_PREFIX = "r2:";
const ENGINE_CHECKPOINT_STATUSES = new Set([
  "running",
  "paused",
  "failed",
  "timed_out",
  "cancelled",
]);

type EngineCheckpointUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

type StoredEngineCheckpoint = {
  checkpoint: Record<string, unknown>;
  usage: EngineCheckpointUsage;
};

const UNCERTAIN_SIDE_EFFECT_FATAL_ERROR =
  "side-effect outcome is uncertain; verify remote state before issuing a new operation; automatic replay is blocked";

const EMPTY_ENGINE_CHECKPOINT_USAGE: EngineCheckpointUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

function parseEngineCheckpointUsage(
  value: unknown,
): EngineCheckpointUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cachedInputTokens = usage.cachedInputTokens;
  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0 ||
    typeof cachedInputTokens !== "number" ||
    !Number.isSafeInteger(cachedInputTokens) ||
    cachedInputTokens < 0 ||
    cachedInputTokens > inputTokens
  ) {
    return null;
  }
  return { inputTokens, outputTokens, cachedInputTokens };
}

function parseEngineCheckpoint(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isBoundedCheckpointJson(value)) return null;
  const checkpoint = value as Record<string, unknown>;
  const state = checkpoint.state_json;
  if (
    typeof checkpoint.session_id !== "string" ||
    checkpoint.session_id.length === 0 ||
    checkpoint.session_id.length > 128 ||
    typeof checkpoint.loop_id !== "string" ||
    checkpoint.loop_id.length === 0 ||
    checkpoint.loop_id.length > 128 ||
    typeof checkpoint.current_node !== "string" ||
    checkpoint.current_node.length === 0 ||
    checkpoint.current_node.length > 256 ||
    typeof checkpoint.status !== "string" ||
    !ENGINE_CHECKPOINT_STATUSES.has(checkpoint.status) ||
    !state ||
    typeof state !== "object" ||
    Array.isArray(state)
  ) {
    return null;
  }
  const stateObject = state as Record<string, unknown>;
  if (
    stateObject.session_id !== checkpoint.session_id ||
    stateObject.loop_id !== checkpoint.loop_id ||
    stateObject.execution_profile !== "external_context"
  ) {
    return null;
  }
  return checkpoint;
}

function parseStoredEngineCheckpoint(
  value: unknown,
): StoredEngineCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  const checkpoint = parseEngineCheckpoint(stored.checkpoint);
  const usage = parseEngineCheckpointUsage(stored.usage);
  return checkpoint && usage ? { checkpoint, usage } : null;
}

function isBoundedCheckpointJson(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes++;
    if (nodes > 50_000 || current.depth > 64) return false;
    const item = current.value;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      continue;
    }
    if (!item || typeof item !== "object") return false;
    if (Array.isArray(item)) {
      for (const child of item) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const child of Object.values(item as Record<string, unknown>)) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function engineCheckpointR2Key(
  runId: string,
  serviceId: string,
  leaseVersion: number,
): string {
  return `agent-checkpoints/${encodeURIComponent(runId)}/${encodeURIComponent(serviceId)}/${leaseVersion}/${crypto.randomUUID()}.json`;
}

function engineCheckpointR2KeyFromStored(
  stored: string | null | undefined,
): string | null {
  if (!stored?.startsWith(ENGINE_CHECKPOINT_R2_PREFIX)) return null;
  const key = stored.slice(ENGINE_CHECKPOINT_R2_PREFIX.length);
  return key || null;
}

async function loadStoredEngineCheckpoint(
  env: Env,
  stored: string,
): Promise<StoredEngineCheckpoint | null> {
  let serialized = stored;
  if (stored.startsWith(ENGINE_CHECKPOINT_R2_PREFIX)) {
    const key = engineCheckpointR2KeyFromStored(stored);
    if (!key || !env.TAKOS_OFFLOAD) return null;
    const object = await env.TAKOS_OFFLOAD.get(key);
    if (!object || object.size > MAX_ENGINE_CHECKPOINT_BYTES) return null;
    serialized = await object.text();
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_ENGINE_CHECKPOINT_BYTES
  ) {
    return null;
  }
  try {
    return parseStoredEngineCheckpoint(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function validCheckpointLeaseVersion(
  serviceId: string | null,
  value: unknown,
): value is number | null | undefined {
  if (!serviceId && (value === undefined || value === null)) return true;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function supportsFatalCheckpointProtocol(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 2;
}

export async function handleEngineCheckpointSave(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = body.leaseVersion;
  const checkpoint = parseEngineCheckpoint(body.checkpoint);
  const usage = parseEngineCheckpointUsage(body.usage);
  if (
    !runId ||
    !checkpoint ||
    !usage ||
    !validCheckpointLeaseVersion(serviceId, leaseVersion)
  ) {
    return err("Invalid engine checkpoint payload", 400);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify({ checkpoint, usage });
  } catch {
    return err("Invalid engine checkpoint payload", 400);
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_ENGINE_CHECKPOINT_BYTES
  ) {
    return err("Engine checkpoint is too large", 413);
  }
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  const conditions = [eq(runs.id, runId), eq(runs.status, "running")];
  if (serviceId) conditions.push(eq(runs.serviceId, serviceId));
  if (typeof leaseVersion === "number") {
    conditions.push(eq(runs.leaseVersion, leaseVersion));
  }
  try {
    const db = getDb(env.DB);
    const current = await db
      .select({ checkpoint: runs.engineCheckpoint })
      .from(runs)
      .where(and(...conditions))
      .get();
    if (!current) return err("Lease lost", 409);
    conditions.push(
      current.checkpoint === null
        ? isNull(runs.engineCheckpoint)
        : eq(runs.engineCheckpoint, current.checkpoint),
    );

    let stored = serialized;
    let stagedKey: string | null = null;
    if (
      new TextEncoder().encode(serialized).byteLength >
      MAX_INLINE_ENGINE_CHECKPOINT_BYTES
    ) {
      if (
        !env.TAKOS_OFFLOAD ||
        !serviceId ||
        typeof leaseVersion !== "number"
      ) {
        return err("TAKOS_OFFLOAD is required for this engine checkpoint", 503);
      }
      stagedKey = engineCheckpointR2Key(runId, serviceId, leaseVersion);
      await env.TAKOS_OFFLOAD.put(stagedKey, serialized, {
        httpMetadata: { contentType: "application/json" },
      });
      stored = `${ENGINE_CHECKPOINT_R2_PREFIX}${stagedKey}`;
    }
    const update = await db
      .update(runs)
      .set({
        engineCheckpoint: stored,
        engineCheckpointUpdatedAt: new Date().toISOString(),
      })
      .where(and(...conditions))
      .run();
    if (affectedRowCount(update) !== 1) {
      if (stagedKey && env.TAKOS_OFFLOAD) {
        await env.TAKOS_OFFLOAD.delete(stagedKey).catch(() => undefined);
      }
      return err("Lease lost", 409);
    }
    const previousKey = engineCheckpointR2KeyFromStored(current.checkpoint);
    if (previousKey && previousKey !== stagedKey && env.TAKOS_OFFLOAD) {
      await env.TAKOS_OFFLOAD.delete(previousKey).catch((cleanupError) => {
        logWarn("Replaced engine checkpoint cleanup failed", {
          module: "executor-host",
          runId,
          error: String(cleanupError),
        });
      });
    }
    return ok({ saved: true });
  } catch (error) {
    logError("Engine checkpoint save failed", error, {
      module: "executor-host",
      runId,
    });
    return err("Engine checkpoint save failed", 503);
  }
}

export async function handleEngineCheckpointLoad(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = body.leaseVersion;
  if (!runId || !validCheckpointLeaseVersion(serviceId, leaseVersion)) {
    return err("Invalid engine checkpoint request", 400);
  }
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;
  try {
    const db = getDb(env.DB);
    const row = await db
      .select({ checkpoint: runs.engineCheckpoint })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (!row) return err("Run not found", 404);
    // The operation ledger is the durable authority for commit-ambiguous side
    // effects. It also closes the tiny crash window between tool-execute
    // returning `outcome_uncertain` and the engine saving its next checkpoint.
    const uncertainOperation = await db
      .select({ id: toolOperations.id })
      .from(toolOperations)
      .where(
        and(
          eq(toolOperations.runId, runId),
          eq(toolOperations.status, "uncertain"),
        ),
      )
      .get();
    const authoritativeFatalError = uncertainOperation
      ? UNCERTAIN_SIDE_EFFECT_FATAL_ERROR
      : null;
    if (
      authoritativeFatalError &&
      !supportsFatalCheckpointProtocol(body.checkpointProtocolVersion)
    ) {
      // v1 wrappers ignore the v2 fatalError response field and would recover a
      // Cancelled checkpoint as a generic engine failure. Return the canonical
      // reason as a non-retryable conflict instead; released v1 wrappers already
      // map this marker to atomic failed completion without model/tool replay.
      return err(authoritativeFatalError, 409);
    }
    if (!row.checkpoint) {
      return ok({
        checkpoint: null,
        usage: EMPTY_ENGINE_CHECKPOINT_USAGE,
        fatalError: authoritativeFatalError,
      });
    }
    const parsed = await loadStoredEngineCheckpoint(env, row.checkpoint);
    if (!parsed) {
      if (authoritativeFatalError) {
        return ok({
          checkpoint: null,
          usage: EMPTY_ENGINE_CHECKPOINT_USAGE,
          fatalError: authoritativeFatalError,
        });
      }
      return err("Stored engine checkpoint is invalid", 500);
    }
    return ok({
      ...parsed,
      fatalError: authoritativeFatalError,
    });
  } catch (error) {
    logError("Engine checkpoint load failed", error, {
      module: "executor-host",
      runId,
    });
    return err("Engine checkpoint load failed", 503);
  }
}

export async function handleToolCatalog(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    const entry = await getOrCreateRemoteToolExecutor(runId, body, env);
    const executor = await entry.promise;
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
  if (leaseError) {
    abortRemoteToolExecutorsForLease(body);
    return leaseError;
  }

  let entry: RemoteToolExecutorEntry | null = null;
  try {
    entry = await getOrCreateRemoteToolExecutor(runId, body, env);
    if (entry.abortController.signal.aborted) return err("Lease lost", 409);
    const executor = await entry.promise;
    const stopMonitor = new AbortController();
    const monitor = monitorRemoteToolExecutorLease(
      env,
      entry,
      stopMonitor.signal,
    );
    try {
      const result = await executor.execute(toolCall);
      // Cancellation can race a handler that ignores AbortSignal. Never return
      // its stale result to the superseded container.
      if (entry.abortController.signal.aborted) return err("Lease lost", 409);
      return ok(result);
    } finally {
      stopMonitor.abort();
      await monitor;
    }
  } catch (e: unknown) {
    if (entry?.abortController.signal.aborted) return err("Lease lost", 409);
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

  await cleanupRemoteToolExecutor(body);
  return ok({ success: true });
}

export async function handleRunEvent(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, type, data, sequence } = body as {
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
  };
  const serviceId = readRunServiceId(body);
  const leaseVersion =
    typeof body.leaseVersion === "number" &&
    Number.isSafeInteger(body.leaseVersion) &&
    body.leaseVersion >= 0
      ? body.leaseVersion
      : null;

  if (
    !runId ||
    !type ||
    !ALLOWED_RUN_EVENT_TYPES.has(type) ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    return err("Invalid run event payload", 400);
  }
  if (serviceId && leaseVersion === null) {
    return err("Invalid run event lease", 400);
  }

  const stack: Array<{ value: unknown; depth: number }> = [
    { value: data, depth: 0 },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes++;
    if (nodes > 4_096 || current.depth > 32) {
      return err("Run event data is too complex", 400);
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const value of Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)) {
      stack.push({ value, depth: current.depth + 1 });
    }
  }
  const eventData = {
    ...data,
    _sequence: sequence,
    _leaseVersion: leaseVersion,
  };
  let serializedData: string;
  try {
    serializedData = JSON.stringify(eventData);
  } catch {
    return err("Run event data must be serializable JSON", 400);
  }
  if (new TextEncoder().encode(serializedData).byteLength > 64 * 1024) {
    return err("Run event data is too large", 413);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  const dedupKey = buildRunEventDedupKey(runId, leaseVersion, type, sequence);
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
    if (!offloadEnabled) {
      const db = getDb(env.DB);
      const existing = await db
        .select({ id: runEvents.id })
        .from(runEvents)
        .where(
          and(eq(runEvents.runId, runId), eq(runEvents.eventKey, dedupKey)),
        )
        .get();
      if (existing) {
        sqlEventId = existing.id;
        duplicate = true;
      } else {
        try {
          const persisted = await db
            .insert(runEvents)
            .values({
              runId,
              type,
              eventKey: dedupKey,
              data: serializedData,
              createdAt: now,
            })
            .returning({ id: runEvents.id })
            .get();
          sqlEventId = persisted?.id ?? null;
        } catch (insertError) {
          const raced = await db
            .select({ id: runEvents.id })
            .from(runEvents)
            .where(
              and(eq(runEvents.runId, runId), eq(runEvents.eventKey, dedupKey)),
            )
            .get();
          if (!raced) throw insertError;
          sqlEventId = raced.id;
          duplicate = true;
        }
      }
    }

    const stub = getRunNotifierStub(env, runId);
    const emitResponse = await stub.fetch(
      buildRunNotifierEmitRequest({
        ...buildRunNotifierEmitPayload(runId, type, eventData, sqlEventId),
        dedup_key: dedupKey,
      }),
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
    const emitBody = await emitResponse
      .clone()
      .json()
      .catch(() => null);
    const durableDuplicate = !!(
      emitBody &&
      typeof emitBody === "object" &&
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
