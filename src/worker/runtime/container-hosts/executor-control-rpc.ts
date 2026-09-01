/**
 * Control-plane RPC handlers for the executor-host subsystem.
 *
 * These handlers back the canonical Takos-owned
 * /api/internal/v1/agent-control/* route family.
 */

import { getDb } from "../../infra/db/index.ts";
import {
  runEvents,
  runContextRevisions,
  runs,
  threads,
  toolOperations,
} from "../../infra/db/schema.ts";
import { and, eq, exists, gte, isNull, lte } from "drizzle-orm";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { affectedRowCount } from "../../shared/utils/affected-row-count.ts";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";
import { persistMessage } from "../../application/services/agent/message-persistence.ts";
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
  resolveSkillPlanForPinnedRun,
} from "../../application/services/agent/skills.ts";
import {
  createToolExecutor,
  type ToolExecutorLike,
} from "../../application/tools/executor.ts";
import { AGENT_DISABLED_CUSTOM_TOOLS } from "../../application/tools/tool-policy.ts";
import type {
  ToolCall,
  ToolDefinition,
} from "../../application/tools/tool-definitions.ts";
import {
  activateToolDescriptors,
  selectModelVisibleTools,
  type ActivatedToolDescriptor,
} from "../../application/tools/tool-descriptor-revisions.ts";
import {
  buildTerminalPayload,
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
  transitionRunTerminalAtomically,
} from "../../application/services/run-notifier/index.ts";
import type { Env } from "../../shared/types/index.ts";
import {
  classifyProxyError,
  err,
  ok,
  readRunServiceId,
} from "./executor-utils.ts";
import {
  assertRunExecutionAccess,
  getRunBootstrap,
} from "./executor-run-state.ts";
import { dispatchRunNotificationOutbox } from "../../application/services/notifications/run-outbox.ts";
import { accountsDelegatedAuthorization } from "../../server/routes/auth/accounts-delegation.ts";
import { DEFAULT_MODEL_ID } from "../../application/services/agent/model-catalog.ts";
import { recordRunUsageBatch } from "../../application/services/app-usage/usage-recorder.ts";
import {
  appendRunContextResourceReferences,
  loadRunExecutionAuthority,
  parseRunAuthorityAttestation,
  runContextActivationEventKey,
  runAuthorityAttestationsEqual,
  RunContextActivationConflictError,
  RunExecutionAuthorityUnavailableError,
  verifyRunContextAttestation,
  type RunAuthorityAttestation,
  type RunExecutionAuthority,
} from "../../application/services/runs/run-authority.ts";
import {
  ensureInitialSkillPlan,
  loadPinnedSkillPlan,
  SkillRevisionUnavailableError,
} from "../../application/services/agent/skill-revisions.ts";
import {
  cancelRunForRevokedContext,
  failRunForInvalidContext,
  type InvalidRunContextCode,
  type InvalidRunContextStage,
} from "../../application/services/runs/run-context-revocation.ts";
import {
  beginRunModelCallAtomically,
  isRunModelCallBeginNonce,
  isRunModelCallRequestDigest,
  isRunModelCallTransportAttempt,
  RunModelCallAlreadyBeganError,
  RunModelCallAuthorityChangedError,
  RunModelCallRecordInvalidError,
  type BeginRunModelCallInput,
  type BeginRunModelCallResult,
} from "../../application/services/runs/run-model-call-authority.ts";
import {
  resolveRunModelInput,
  RunModelInputUnavailableError,
} from "../../application/services/runs/run-model-input.ts";
import {
  ProviderMaterializationUnavailableError,
  resolveRunProviderCredential,
  type ProviderRuntimeCredential,
} from "../../application/services/runs/provider-materialization.ts";

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function recordCommittedRunUsage(
  env: Env,
  runId: string,
  source: "complete-run" | "legacy-run-status",
): Promise<void> {
  try {
    await recordRunUsageBatch(env, runId);
  } catch (error) {
    // The terminal Run commit is authoritative and cannot be rolled back by a
    // derived app-local rollup. Exact per-meter idempotency makes a later
    // terminal replay or explicit run-usage retry safe.
    logWarn("Committed Run usage recording failed", {
      module: "executor-host",
      runId,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runtimeMcpInterfaceConfig(
  env: Env,
  userId: string,
): Promise<
  | {
      workspaceId: string;
      request: {
        baseUrl: string;
        token: string;
        subjectId: string;
      };
    }
  | undefined
> {
  const issuer = nonEmptyString(env.OIDC_ISSUER_URL);
  const clientId = nonEmptyString(env.OIDC_CLIENT_ID);
  const encryptionKey = nonEmptyString(env.ENCRYPTION_KEY);
  const baseUrl =
    nonEmptyString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    nonEmptyString(env.TAKOSUMI_ACCOUNTS_URL) ??
    issuer;
  if (!issuer || !clientId || !encryptionKey || !baseUrl) return undefined;
  try {
    const authorization = await accountsDelegatedAuthorization({
      db: env.DB,
      encryptionKey,
      userId,
      issuer: issuer.replace(/\/+$/u, ""),
      clientId,
      clientSecret: nonEmptyString(env.OIDC_CLIENT_SECRET) ?? undefined,
      access: "read",
    });
    return {
      workspaceId: authorization.workspaceId,
      request: {
        baseUrl,
        token: authorization.accessToken,
        subjectId: authorization.subjectId,
      },
    };
  } catch (error) {
    // A missing/expired delegated Accounts grant removes Interface-backed MCP
    // tools from this run. Never fall back to an operator token or log the
    // delegated credential.
    logWarn("Takosumi MCP Interface discovery is unavailable for this run", {
      module: "executor-host",
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

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
  env: Pick<Env, "DB" | "TAKOS_OFFLOAD">,
  runId: string,
  body: {
    readonly serviceId?: unknown;
    readonly workerId?: unknown;
    readonly leaseVersion?: unknown;
  },
  options: { readonly allowTerminalRetry?: boolean } = {},
): Promise<Response | null> {
  const serviceId = readRunServiceId(body);
  const supportsFullSql = Boolean(
    env.DB &&
      typeof (env.DB as { prepare?: unknown }).prepare === "function",
  );
  // The in-process event-only test/dev path may intentionally omit DB and a
  // lease identity. Every deployed run-scoped path has a complete binding.
  if (!serviceId && !supportsFullSql) return null;
  const leaseVersion =
    typeof body.leaseVersion === "number" ? body.leaseVersion : null;
  let run:
    | {
      serviceId: string | null;
      leaseVersion: number;
      status: string;
      currentContextRevision: number | null;
    }
    | undefined;
  try {
    run = await getDb(env.DB)
      .select({
        serviceId: runs.serviceId,
        leaseVersion: runs.leaseVersion,
        status: runs.status,
        currentContextRevision: runs.currentContextRevision,
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
  if (serviceId) {
    if (run.serviceId !== serviceId) return err("Lease lost", 409);
    if (leaseVersion !== null && run.leaseVersion !== leaseVersion) {
      return err("Lease lost", 409);
    }
    if (run.status !== "running" && !options.allowTerminalRetry) {
      // Terminal status revokes the executor's authority just like a replaced
      // service/lease. Keep the canonical lease-lost wire signal so the Rust
      // heartbeat/finalization path cancels cleanly instead of retrying failure
      // reporting for a user-cancelled run.
      return err("Lease lost", 409);
    }
  }

  // Check tombstones only after rejecting a stale/terminal lease. Apart from
  // avoiding a more expensive join for an unauthorized caller, this keeps a
  // stale executor from turning an unrelated transient lookup failure into a
  // retryable 503. Legacy Runs without a context pointer cannot reference a
  // RunContext resource and therefore have nothing to revoke here.
  if (supportsFullSql && run.currentContextRevision != null) {
    try {
      const revocation = await cancelRunForRevokedContext(
        env.DB,
        runId,
        env.TAKOS_OFFLOAD,
      );
      if (revocation.revoked) return err("Lease lost", 409);
    } catch (error) {
      logError("Run context revocation lookup failed", error, {
        module: "executor-host",
        runId,
      });
      return err("Run context revocation lookup failed", 503);
    }
  }
  return null;
}

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

const recentRunEventKeys = new Map<string, number>();
const RUN_EVENT_DEDUP_TTL_MS: TtlMs = ttlMs(60 * 60_000);
const RUN_EVENT_DEDUP_MAX_KEYS = 10_000;

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

async function createRemoteToolExecutor(
  runId: string,
  env: Env,
  authority: RunExecutionAuthority,
  runAbortSignal?: AbortSignal,
): Promise<ToolExecutorLike> {
  const bootstrap = await getRunBootstrap(env, runId);
  if (
    bootstrap.spaceId !== authority.workspaceId ||
    bootstrap.threadId !== authority.threadId
  ) {
    throw new RunExecutionAuthorityUnavailableError();
  }
  const runtimeMcpInterfaces = await runtimeMcpInterfaceConfig(
    env,
    bootstrap.userId,
  );

  // The agent acts on behalf of the run's triggering Principal and receives
  // only the capabilities of that private Workspace. Execution revalidates
  // ownership before this point, so no historical collaboration role can
  // widen the Run's authority.
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
      runAuthority: authority,
      ...(runtimeMcpInterfaces ? { runtimeMcpInterfaces } : {}),
    },
    undefined,
    runAbortSignal,
  );
}

export interface RemoteToolExecutorDependencies {
  resolveAuthority(runId: string, env: Env): Promise<RunExecutionAuthority>;
  createExecutor(
    runId: string,
    env: Env,
    authority: RunExecutionAuthority,
    runAbortSignal?: AbortSignal,
  ): Promise<ToolExecutorLike>;
  activateToolCatalog?(
    db: Env["DB"],
    authority: RunExecutionAuthority,
    tools: readonly ToolDefinition[],
  ): Promise<{
    authority: RunExecutionAuthority;
    descriptors: ActivatedToolDescriptor[];
  }>;
}

const remoteToolExecutorDependencies: RemoteToolExecutorDependencies = {
  resolveAuthority: (runId, env) =>
    loadRunExecutionAuthority({ db: env.DB, runId }),
  createExecutor: createRemoteToolExecutor,
  activateToolCatalog: (db, authority, tools) =>
    activateToolDescriptors({
      db,
      authority,
      activationEventId: "tool_catalog:v2",
      tools,
    }),
};

export interface ModelCallAuthorityDependencies {
  resolveAuthority(runId: string, env: Env): Promise<RunExecutionAuthority>;
  begin(
    db: Env["DB"],
    input: BeginRunModelCallInput,
  ): Promise<BeginRunModelCallResult>;
  resolveProviderCredential?(
    runId: string,
    env: Env,
    authority: RunExecutionAuthority,
  ): Promise<ProviderRuntimeCredential>;
}

const modelCallAuthorityDependencies: ModelCallAuthorityDependencies = {
  resolveAuthority: (runId, env) =>
    loadRunExecutionAuthority({ db: env.DB, runId }),
  begin: beginRunModelCallAtomically,
  resolveProviderCredential: (runId, env, authority) =>
    resolveRunProviderCredential({ env, runId, authority }),
};

async function invalidRunContextResponse(params: {
  env: Env;
  runId: string;
  stage: InvalidRunContextStage;
  code: InvalidRunContextCode;
  checkpointContextRevision?: number;
}): Promise<Response> {
  if (
    !params.env.DB ||
    typeof (params.env.DB as { prepare?: unknown }).prepare !== "function"
  ) {
    // Tiny request-scope test doubles cannot run the product terminal
    // transaction. Supported Worker and local-platform bindings always expose
    // prepare(), so production never silently skips this convergence.
    return err("Run execution authority is unavailable", 409);
  }
  try {
    const outcome = await failRunForInvalidContext(
      params.env.DB,
      params.runId,
      {
        stage: params.stage,
        code: params.code,
        ...(params.checkpointContextRevision !== undefined
          ? {
              checkpointContextRevision:
                params.checkpointContextRevision,
            }
          : {}),
      },
      params.env.TAKOS_OFFLOAD,
    );
    if (outcome.revoked) return err("Lease lost", 409);
    if (outcome.legacy) {
      return err("Run execution authority is unavailable", 409);
    }
    if (outcome.invalid) return err("Lease lost", 409);
    return err("Run execution authority is unavailable", 409);
  } catch (terminalError) {
    logError("Invalid Run context terminalization failed", terminalError, {
      module: "executor-host",
      runId: params.runId,
      stage: params.stage,
      code: params.code,
    });
    return err("Run context integrity handling failed", 503);
  }
}

async function runAuthorityErrorResponse(params: {
  error: unknown;
  env: Env;
  runId: string;
  stage: InvalidRunContextStage;
}): Promise<Response | null> {
  if (params.error instanceof SkillRevisionUnavailableError) {
    return await invalidRunContextResponse({
      env: params.env,
      runId: params.runId,
      stage: params.stage,
      code: "skill_revision_invalid",
    });
  }
  return params.error instanceof RunExecutionAuthorityUnavailableError
    ? await invalidRunContextResponse({
        env: params.env,
        runId: params.runId,
        stage: params.stage,
        code: "authority_record_invalid",
      })
    : null;
}

/**
 * Bind one outbound provider request to the exact current RunContext before
 * any model bytes leave the container. The immutable row contains only
 * digests/lease identity. A repeated begin with the same ephemeral nonce is an
 * idempotent RPC retry; another task cannot silently replay the same request.
 */
export async function handleModelCallBegin(
  body: Record<string, unknown>,
  env: Env,
  dependencies: ModelCallAuthorityDependencies =
    modelCallAuthorityDependencies,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = body.leaseVersion;
  if (!runId) return err("Missing runId", 400);
  if (!serviceId) return err("Missing serviceId", 400);
  if (
    typeof leaseVersion !== "number" ||
    !Number.isSafeInteger(leaseVersion) || leaseVersion < 0
  ) {
    return err("Invalid leaseVersion", 400);
  }
  if (!isRunModelCallRequestDigest(body.requestDigest)) {
    return err("Invalid model request digest", 400);
  }
  if (!isRunModelCallTransportAttempt(body.transportAttempt)) {
    return err("Invalid model transport attempt", 400);
  }
  if (!isRunModelCallBeginNonce(body.beginNonce)) {
    return err("Invalid model call begin nonce", 400);
  }
  const requestedAuthority = parseRunAuthorityAttestation(body.runAuthority);
  if (!requestedAuthority) {
    return err("Run authority attestation is required", 409);
  }

  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;
  let authority: RunExecutionAuthority;
  try {
    authority = await dependencies.resolveAuthority(runId, env);
  } catch (error) {
    const authorityError = await runAuthorityErrorResponse({
      error,
      env,
      runId,
      stage: "model_call_begin",
    });
    if (authorityError) return authorityError;
    logError("Model-call authority lookup failed", error, {
      module: "executor-host",
      runId,
    });
    return err("Model-call authority lookup failed", 503);
  }
  if (
    !runAuthorityAttestationsEqual(
      requestedAuthority,
      authority.attestation,
    )
  ) {
    return err("Run authority attestation is stale", 409);
  }

  try {
    const result = await dependencies.begin(env.DB, {
      runId,
      serviceId,
      leaseVersion,
      authority: requestedAuthority,
      requestDigest: body.requestDigest,
      transportAttempt: body.transportAttempt,
      beginNonce: body.beginNonce,
    });
    const providerCredential = dependencies.resolveProviderCredential
      ? await dependencies.resolveProviderCredential(runId, env, authority)
      : undefined;
    return ok({
      modelCallId: result.modelCallId,
      idempotent: result.idempotent,
      runAuthority: authority.attestation,
      ...(providerCredential ? { providerCredential } : {}),
    });
  } catch (error) {
    if (error instanceof RunModelCallAlreadyBeganError) {
      return err("Model call already began under another execution", 409);
    }
    if (error instanceof RunModelCallAuthorityChangedError) {
      return err("Run authority changed during model-call begin", 409);
    }
    if (error instanceof RunModelCallRecordInvalidError) {
      return await invalidRunContextResponse({
        env,
        runId,
        stage: "model_call_begin",
        code: "model_call_record_invalid",
      });
    }
    if (error instanceof ProviderMaterializationUnavailableError) {
      logWarn("Provider credential live check failed", {
        module: "executor-host",
        runId,
        error: error.message,
      });
      return err("Provider credential is unavailable", 503);
    }
    logError("Model-call authority commit failed", error, {
      module: "executor-host",
      runId,
    });
    return err("Model-call authority commit failed", 503);
  }
}

async function cleanupRequestToolExecutor(
  executor: ToolExecutorLike,
): Promise<void> {
  try {
    await executor.cleanup();
  } catch (error) {
    logWarn("Request-local tool executor cleanup failed", {
      module: "executor-host",
      error: String(error),
    });
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
 * Cross-isolate cancellation fence for long-running MCP/web tools. Poll the
 * authoritative DB lease and requester membership at a bounded <=5s cadence
 * for the lifetime of one execute request, then abort that request's local
 * executor when its authority changes.
 */
async function monitorRemoteToolExecutorLease(
  env: Env,
  identity: NormalizedRemoteToolExecutorIdentity,
  abortController: AbortController,
  stopSignal: AbortSignal,
): Promise<void> {
  if (!identity.runId || !identity.serviceId) return;
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
    if (leaseError) {
      // A transient DB failure is not evidence that authority was revoked. Keep
      // polling; the tool's own timeout remains the availability bound.
      if (leaseError.status !== 404 && leaseError.status !== 409) continue;
      abortController.abort();
      return;
    }
    try {
      await assertRunExecutionAccess(env, identity.runId);
    } catch {
      abortController.abort();
      return;
    }
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
 * Resolve the exact Worker-owned model input for one RunContext revision.
 * Caller-supplied Thread, Workspace, model, prompt, history, or Run input is
 * never accepted by this interface.
 */
export async function handleRunModelInput(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  if (!runId) return err("Missing runId", 400);
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  try {
    return ok(await resolveRunModelInput({ env, runId }));
  } catch (error) {
    if (error instanceof RunModelInputUnavailableError) {
      return await invalidRunContextResponse({
        env,
        runId,
        stage: "model_input",
        code: "model_input_record_invalid",
      });
    }
    const authorityError = await runAuthorityErrorResponse({
      error,
      env,
      runId,
      stage: "model_input",
    });
    if (authorityError) return authorityError;
    logError("Run model input RPC error", error, {
      module: "executor-host",
      runId,
    });
    return err("Run model input unavailable", 503);
  }
}

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
  if (!runId) return err("Missing runId", 400);
  const authority = await resolveRunThreadTenant(env, runId);
  if (!authority) return err("Run not found", 404);
  const config = getAgentConfig(authority.agentType, env);
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
 * trustworthy; the run row is the authority for accountId, threadId,
 * agentType, and model. This blocks
 * a compromised container from setting threadId/spaceId to a victim tenant's.
 */
export async function resolveRunThreadTenant(
  env: Env,
  runId: string,
): Promise<{
  spaceId: string;
  threadId: string;
  agentType: string;
  model: string | null;
} | null> {
  const run = await getDb(env.DB)
    .select({
      accountId: runs.accountId,
      threadId: runs.threadId,
      agentType: runs.agentType,
      model: runs.model,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (!run || !run.threadId) return null;
  return {
    spaceId: run.accountId,
    threadId: run.threadId,
    agentType: run.agentType,
    model: run.model ?? null,
  };
}

export async function handleConversationHistory(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as {
    runId?: string;
  };
  if (!runId) {
    return err("Missing runId", 400);
  }

  const tenant = await resolveRunThreadTenant(env, runId);
  if (!tenant) return err("Run not found", 404);
  const { spaceId, threadId } = tenant;
  const aiModel = tenant.model ?? DEFAULT_MODEL_ID;

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

export async function handleSkillRuntimeContext(
  body: Record<string, unknown>,
  env: Env,
  dependencies: RemoteToolExecutorDependencies = remoteToolExecutorDependencies,
): Promise<Response> {
  const { runId } = body as {
    runId?: string;
  };
  if (!runId) return err("Missing runId", 400);
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  let executor: ToolExecutorLike | null = null;
  try {
    const modelInput = await resolveRunModelInput({ env, runId });
    const authority = await dependencies.resolveAuthority(runId, env);
    if (
      !runAuthorityAttestationsEqual(
        modelInput.runAuthority,
        authority.attestation,
      )
    ) {
      return err("Run authority changed during Skill resolution", 409);
    }
    executor = await dependencies.createExecutor(runId, env, authority);
    const availableToolNames = executor.getAvailableTools().map((tool) =>
      tool.name
    );
    if (!authority.modelInput) {
      throw new RunModelInputUnavailableError();
    }
    let activeAuthority = authority;
    let pinnedPlan = await loadPinnedSkillPlan({
      db: env.DB,
      authority,
    });
    if (!pinnedPlan) {
      const { plan } = await resolveSkillPlanForPinnedRun(env.DB, {
        spaceId: authority.workspaceId,
        agentType: authority.modelInput.agentType,
        history: modelInput.history,
        runInputJson: authority.modelInput.runInputJson,
        availableToolNames,
      });
      const preparedPlan = await ensureInitialSkillPlan({
        db: env.DB,
        authority,
        skillLocale: plan.skillLocale,
        selectedSkills: plan.selectedSkillContents,
      });
      activeAuthority = await appendRunContextResourceReferences({
        db: env.DB,
        runId,
        expectedAttestation: authority.attestation,
        activationEventId:
          `skill_plan:${preparedPlan.planReference.resourceId}:${preparedPlan.planReference.resourceDigest}`,
        // The plan is the descriptor catalog authority. Individual Skill
        // content revisions are appended only when toolbox describe activates
        // that exact manual, before its instructions become model-visible.
        references: [preparedPlan.planReference],
      });
      pinnedPlan = await loadPinnedSkillPlan({
        db: env.DB,
        authority: activeAuthority,
      });
      if (!pinnedPlan) {
        throw new SkillRevisionUnavailableError(
          "Pinned Skill plan is missing after RunContext activation",
        );
      }
    }
    return ok({
      runAuthority: activeAuthority.attestation,
      descriptorCount: pinnedPlan.selectedSkills.length,
    });
  } catch (e: unknown) {
    if (e instanceof RunContextActivationConflictError) {
      return err("Run authority changed during Skill activation", 409);
    }
    if (e instanceof SkillRevisionUnavailableError) {
      return await invalidRunContextResponse({
        env,
        runId,
        stage: "skill_context",
        code: "skill_revision_invalid",
      });
    }
    if (e instanceof RunModelInputUnavailableError) {
      return await invalidRunContextResponse({
        env,
        runId,
        stage: "model_input",
        code: "model_input_record_invalid",
      });
    }
    const authorityError = await runAuthorityErrorResponse({
      error: e,
      env,
      runId,
      stage: "model_input",
    });
    if (authorityError) return authorityError;
    logError("Skill runtime context RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  } finally {
    if (executor) await cleanupRequestToolExecutor(executor);
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

  const terminalStatus =
    status === "completed" || status === "failed" || status === "cancelled";
  // Terminal writes use a single lease/status CAS and their own exact-outcome
  // idempotency check below. Permit the same token-bound lease to reach that
  // check after a commit, while still rejecting a reclaimed/stale lease here.
  const leaseError = await ensureRunLease(env, runId, body, {
    allowTerminalRetry: terminalStatus,
  });
  if (leaseError) return leaseError;

  // Lease identity is token-bound: executor-host stamps body.serviceId from the
  // verified per-run proxy token, so a stale (re-enqueued) container cannot
  // forge it. leaseVersion is only present when the agent echoes it.
  const serviceId = readRunServiceId(body);
  const leaseVersion =
    typeof body.leaseVersion === "number" ? body.leaseVersion : undefined;
  const normalizedUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    // Map the container's cached-prompt-token count onto the shared
    // AgentUsage `cacheReadTokens` field so runs.usage has one shape
    // regardless of execution path.
    ...(typeof usage.cachedInputTokens === "number"
      ? { cacheReadTokens: usage.cachedInputTokens }
      : {}),
  };

  try {
    if (terminalStatus) {
      const terminalRun = await getDb(env.DB)
        .select({ sessionId: runs.sessionId })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      if (!terminalRun) return err("Run not found", 404);
      const terminalPayload = buildTerminalPayload(
        runId,
        status,
        {
          ...(status === "completed" ? { success: true } : {}),
          ...(typeof output === "string" ? { output } : {}),
          ...(typeof errorMessage === "string"
            ? { error: errorMessage, message: errorMessage }
            : {}),
          usage: normalizedUsage,
        },
        terminalRun.sessionId ?? null,
      );
      const completedAt = new Date().toISOString();
      const eventType = status === "failed" ? "error" : status;
      const transition = await transitionRunTerminalAtomically(
        env.DB,
        {
          runId,
          status,
          expectedStatuses: ["running"],
          ...(serviceId ? { expectedServiceId: serviceId } : {}),
          ...(leaseVersion === undefined
            ? {}
            : { expectedLeaseVersion: leaseVersion }),
          completedAt,
          usage: normalizedUsage,
          ...(output === undefined ? {} : { output }),
          ...(errorMessage === undefined ? {} : { error: errorMessage }),
          eventType,
          terminalEvent: terminalPayload,
        },
        { offloadBucket: env.TAKOS_OFFLOAD },
      );
      let completionKey = transition.completionKey;
      let terminalEventId = transition.eventId;
      if (!transition.committed) {
        // A retry after an ambiguous terminal response finds no active row.
        // Treat only the exact same lease/outcome as idempotent; another
        // terminal winner remains a conflict. Its durable outbox can then be
        // flushed again using the completion key committed by that winner.
        const current = await getDb(env.DB)
          .select({
            status: runs.status,
            usage: runs.usage,
            output: runs.output,
            error: runs.error,
            serviceId: runs.serviceId,
            leaseVersion: runs.leaseVersion,
            completionKey: runs.completionKey,
          })
          .from(runs)
          .where(eq(runs.id, runId))
          .get();
        const idempotent = Boolean(
          current &&
          current.status === status &&
          current.usage === JSON.stringify(normalizedUsage) &&
          (output === undefined || current.output === output) &&
          (errorMessage === undefined || current.error === errorMessage) &&
          (!serviceId || current.serviceId === serviceId) &&
          (leaseVersion === undefined ||
            current.leaseVersion === leaseVersion) &&
          current.completionKey,
        );
        if (!idempotent || !current?.completionKey) {
          return err("Lease lost", 409);
        }
        completionKey = current.completionKey;
        const replayEventKey = `run:${runId}:control:${completionKey}:terminal-status:${status}`;
        const existingEvent = await getDb(env.DB)
          .select({ id: runEvents.id })
          .from(runEvents)
          .where(eq(runEvents.eventKey, replayEventKey))
          .get();
        terminalEventId = existingEvent?.id ?? null;
      }

      const eventKey = `run:${runId}:control:${completionKey}:terminal-status:${status}`;
      try {
        const stub = getRunNotifierStub(env, runId);
        const response = await stub.fetch(
          buildRunNotifierEmitRequest({
            ...buildRunNotifierEmitPayload(
              runId,
              eventType,
              terminalPayload,
              terminalEventId,
            ),
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
        // SQL remains the durable replay source; realtime emit is best effort.
        logWarn("Terminal run event notifier emit failed", {
          module: "executor-host",
          runId,
          status,
          error: String(notifyError),
        });
      }

      await recordCommittedRunUsage(env, runId, "legacy-run-status");

      if (status === "completed" || status === "failed") {
        await dispatchRunNotificationOutbox(env, {
          completionKey,
        }).catch((notificationError) => {
          logWarn("Legacy run-status notification outbox flush failed", {
            module: "executor-host",
            runId,
            error: String(notificationError),
          });
        });
      }
      return ok({ success: true, updated: true });
    }

    const result = await updateRunStatusImpl(
      env.DB,
      runId,
      normalizedUsage,
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
export interface CompleteRunAuthorityDependencies {
  resolveAuthority(runId: string, env: Env): Promise<RunExecutionAuthority>;
}

const completeRunAuthorityDependencies: CompleteRunAuthorityDependencies = {
  resolveAuthority: (runId, env) =>
    loadRunExecutionAuthority({ db: env.DB, runId }),
};

export async function handleCompleteRun(
  body: Record<string, unknown>,
  env: Env,
  dependencies: CompleteRunAuthorityDependencies =
    completeRunAuthorityDependencies,
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
  const rejectInvalidPayload = (reason: string): Response => {
    logWarn("Complete run payload rejected", {
      module: "executor-host",
      ...(runId ? { runId } : {}),
      reason,
    });
    return err(`Invalid complete-run payload: ${reason}`, 400);
  };
  if (!runId) return rejectInvalidPayload("run_id");
  if (!serviceId) return rejectInvalidPayload("service_id");
  if (status !== "completed" && status !== "failed") {
    return rejectInvalidPayload("status");
  }
  if (!usage) return rejectInvalidPayload("usage");
  if (!validUsageInteger(inputTokens)) {
    return rejectInvalidPayload("input_tokens");
  }
  if (!validUsageInteger(outputTokens)) {
    return rejectInvalidPayload("output_tokens");
  }
  if (
    cachedInputTokens !== undefined &&
    (!validUsageInteger(cachedInputTokens) || cachedInputTokens > inputTokens)
  ) {
    return rejectInvalidPayload("cached_input_tokens");
  }
  if (
    typeof leaseVersion !== "number" ||
    !Number.isSafeInteger(leaseVersion) ||
    leaseVersion < 0
  ) {
    return rejectInvalidPayload("lease_version");
  }
  if (messages === null) return rejectInvalidPayload("transcript");
  // completeRunAtomically owns both the active-lease CAS and exact committed
  // outcome replay check. Allow the same token-bound terminal lease to reach
  // that replay check; a reclaimed service/lease remains fenced immediately.
  const leaseError = await ensureRunLease(env, runId, body, {
    allowTerminalRetry: true,
  });
  if (leaseError) return leaseError;
  let runAuthority: RunExecutionAuthority;
  try {
    runAuthority = await dependencies.resolveAuthority(runId, env);
  } catch (authorityError) {
    const response = await runAuthorityErrorResponse({
      error: authorityError,
      env,
      runId,
      stage: "terminal_commit",
    });
    if (response) return response;
    logError("Complete-run authority lookup failed", authorityError, {
      module: "executor-host",
      runId,
    });
    return err("Complete-run authority lookup failed", 503);
  }
  const requestedAuthority = parseRunAuthorityAttestation(body.runAuthority);
  if (
    (body.runAuthority !== undefined && !requestedAuthority) ||
    (requestedAuthority
      ? !runAuthorityAttestationsEqual(
        requestedAuthority,
        runAuthority.attestation,
      )
      : runAuthority.attestation.contextRevision !== 1)
  ) {
    return err("Run authority attestation is stale", 409);
  }
  const output = typeof body.output === "string" ? body.output : undefined;
  const errorMessage = typeof body.error === "string" ? body.error : undefined;
  if (
    (output !== undefined &&
      new TextEncoder().encode(output).byteLength > 512 * 1024) ||
    (errorMessage !== undefined &&
      new TextEncoder().encode(errorMessage).byteLength > 64 * 1024)
  ) {
    return rejectInvalidPayload(
      output !== undefined &&
        new TextEncoder().encode(output).byteLength > 512 * 1024
        ? "output_size"
        : "error_size",
    );
  }
  const terminalRun = await getDb(env.DB)
    .select({
      sessionId: runs.sessionId,
      threadId: runs.threadId,
      engineCheckpoint: runs.engineCheckpoint,
      currentContextRevision: runs.currentContextRevision,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (!terminalRun?.threadId) return err("Run not found", 404);
  if (
    terminalRun.currentContextRevision !==
      runAuthority.attestation.contextRevision
  ) {
    return err("Run authority changed during finalization", 409);
  }
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
        expectedRunAuthority: runAuthority.attestation,
        requireModelCallAuthorityForCompletion:
          typeof body.runtimeProtocolVersion === "number" &&
          body.runtimeProtocolVersion >= 3,
      },
    );
    if (!result.committed) {
      return err("Lease lost", 409);
    }
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
        const response = await stub.fetch(
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
        if (!response.ok) {
          logWarn("Complete-run message notifier emit failed", {
            module: "executor-host",
            runId,
            index,
            notifierStatus: response.status,
          });
        }
      }
      const terminalResponse = await stub.fetch(
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
      if (!terminalResponse.ok) {
        logWarn("Complete-run terminal notifier emit failed", {
          module: "executor-host",
          runId,
          notifierStatus: terminalResponse.status,
        });
      }
    } catch (notifyError) {
      logWarn("Complete-run notifier emit failed", {
        module: "executor-host",
        runId,
        error: String(notifyError),
      });
    }

    await recordCommittedRunUsage(env, runId, "complete-run");

    try {
      await dispatchRunNotificationOutbox(env, {
        completionKey: result.completionKey,
      });
    } catch (notificationError) {
      logWarn("Complete-run user notification failed", {
        module: "executor-host",
        runId,
        error: String(notificationError),
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
  runAuthority: RunAuthorityAttestation | null;
};

export interface EngineCheckpointAuthorityDependencies {
  resolveAuthority(runId: string, env: Env): Promise<RunExecutionAuthority>;
  verifyCheckpointAuthority(params: {
    runId: string;
    checkpointAuthority: RunAuthorityAttestation;
    currentAuthority: RunExecutionAuthority;
    env: Env;
  }): Promise<void>;
}

const engineCheckpointAuthorityDependencies:
  EngineCheckpointAuthorityDependencies = {
    resolveAuthority: (runId, env) =>
      loadRunExecutionAuthority({ db: env.DB, runId }),
    verifyCheckpointAuthority: async (params) => {
      await verifyRunContextAttestation({
        db: params.env.DB,
        runId: params.runId,
        expected: params.checkpointAuthority,
        currentAuthority: params.currentAuthority,
      });
    },
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
  const runAuthority = stored.runAuthority === undefined
    ? null
    : parseRunAuthorityAttestation(stored.runAuthority);
  return checkpoint && usage &&
      (stored.runAuthority === undefined || runAuthority !== null)
    ? { checkpoint, usage, runAuthority }
    : null;
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

function supportsAuthorityCheckpointProtocol(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 3;
}

async function resolveCheckpointRequestAuthority(params: {
  body: Record<string, unknown>;
  env: Env;
  runId: string;
  stage: "checkpoint_save" | "checkpoint_load";
  dependencies: EngineCheckpointAuthorityDependencies;
}): Promise<
  | { authority: RunExecutionAuthority; requested: RunAuthorityAttestation }
  | Response
> {
  try {
    const authority = await params.dependencies.resolveAuthority(
      params.runId,
      params.env,
    );
    const requested = parseRunAuthorityAttestation(params.body.runAuthority);
    if (supportsAuthorityCheckpointProtocol(
      params.body.checkpointProtocolVersion,
    )) {
      if (
        !requested ||
        !runAuthorityAttestationsEqual(requested, authority.attestation)
      ) {
        return err("Run authority attestation is stale", 409);
      }
      return { authority, requested };
    }
    // Rolling compatibility for released v1/v2 wrappers: the Worker binds the
    // checkpoint to the current verified revision itself. Such wrappers cannot
    // perform progressive tool activation against the authority-gated broker,
    // so they can only produce a base-revision read-only completion.
    if (authority.attestation.contextRevision !== 1) {
      return err("Run authority checkpoint protocol is required", 409);
    }
    return { authority, requested: authority.attestation };
  } catch (error) {
    const authorityError = await runAuthorityErrorResponse({
      error,
      env: params.env,
      runId: params.runId,
      stage: params.stage,
    });
    if (authorityError) return authorityError;
    logError("Engine checkpoint authority lookup failed", error, {
      module: "executor-host",
      runId: params.runId,
    });
    return err("Engine checkpoint authority lookup failed", 503);
  }
}

export async function handleEngineCheckpointSave(
  body: Record<string, unknown>,
  env: Env,
  dependencies: EngineCheckpointAuthorityDependencies =
    engineCheckpointAuthorityDependencies,
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
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;
  const resolvedAuthority = await resolveCheckpointRequestAuthority({
    body,
    env,
    runId,
    stage: "checkpoint_save",
    dependencies,
  });
  if (resolvedAuthority instanceof Response) return resolvedAuthority;
  const { authority, requested: checkpointAuthority } = resolvedAuthority;
  let serialized: string;
  try {
    serialized = JSON.stringify({
      checkpoint,
      usage,
      runAuthority: checkpointAuthority,
    });
  } catch {
    return err("Invalid engine checkpoint payload", 400);
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_ENGINE_CHECKPOINT_BYTES
  ) {
    return err("Engine checkpoint is too large", 413);
  }

  try {
    const db = getDb(env.DB);
    const conditions = [
      eq(runs.id, runId),
      eq(runs.status, "running"),
      eq(
        runs.currentContextRevision,
        authority.attestation.contextRevision,
      ),
      exists(
        db.select({ revision: runContextRevisions.revision })
          .from(runContextRevisions)
          .where(and(
            eq(runContextRevisions.runId, runId),
            eq(
              runContextRevisions.revision,
              authority.attestation.contextRevision,
            ),
            eq(
              runContextRevisions.digest,
              authority.attestation.contextDigest,
            ),
            eq(
              runContextRevisions.runGrantDigest,
              authority.attestation.runGrantDigest,
            ),
          )),
      ),
    ];
    if (serviceId) conditions.push(eq(runs.serviceId, serviceId));
    if (typeof leaseVersion === "number") {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
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
  dependencies: EngineCheckpointAuthorityDependencies =
    engineCheckpointAuthorityDependencies,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = body.leaseVersion;
  if (!runId || !validCheckpointLeaseVersion(serviceId, leaseVersion)) {
    return err("Invalid engine checkpoint request", 400);
  }
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;
  const resolvedAuthority = await resolveCheckpointRequestAuthority({
    body,
    env,
    runId,
    stage: "checkpoint_load",
    dependencies,
  });
  if (resolvedAuthority instanceof Response) return resolvedAuthority;
  const { authority } = resolvedAuthority;
  try {
    const db = getDb(env.DB);
    const row = await db
      .select({
        checkpoint: runs.engineCheckpoint,
        currentContextRevision: runs.currentContextRevision,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    if (!row) return err("Run not found", 404);
    if (
      row.currentContextRevision !== authority.attestation.contextRevision
    ) {
      return err("Run authority changed during checkpoint load", 409);
    }
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
        checkpointAuthority: null,
        runAuthority: authority.attestation,
      });
    }
    const parsed = await loadStoredEngineCheckpoint(env, row.checkpoint);
    if (!parsed) {
      if (authoritativeFatalError) {
        return ok({
          checkpoint: null,
          usage: EMPTY_ENGINE_CHECKPOINT_USAGE,
          fatalError: authoritativeFatalError,
          checkpointAuthority: null,
          runAuthority: authority.attestation,
        });
      }
      return await invalidRunContextResponse({
        env,
        runId,
        stage: "checkpoint_load",
        code: "checkpoint_envelope_invalid",
      });
    }
    const checkpointAuthority = parsed.runAuthority ??
      (authority.attestation.contextRevision === 1
        ? authority.attestation
        : null);
    if (!checkpointAuthority) {
      return await invalidRunContextResponse({
        env,
        runId,
        stage: "checkpoint_load",
        code: "checkpoint_authority_missing",
      });
    }
    try {
      await dependencies.verifyCheckpointAuthority({
        runId,
        checkpointAuthority,
        currentAuthority: authority,
        env,
      });
    } catch (error) {
      if (error instanceof RunExecutionAuthorityUnavailableError) {
        return await invalidRunContextResponse({
          env,
          runId,
          stage: "checkpoint_load",
          code: "checkpoint_authority_invalid",
          checkpointContextRevision: checkpointAuthority.contextRevision,
        });
      }
      throw error;
    }
    return ok({
      checkpoint: parsed.checkpoint,
      usage: parsed.usage,
      fatalError: authoritativeFatalError,
      checkpointAuthority,
      runAuthority: authority.attestation,
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
  dependencies: RemoteToolExecutorDependencies = remoteToolExecutorDependencies,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  let executor: ToolExecutorLike | null = null;
  try {
    const authority = await dependencies.resolveAuthority(runId, env);
    executor = await dependencies.createExecutor(runId, env, authority);
    const visibleTools = selectModelVisibleTools(executor.getAvailableTools());
    const activated = await (
      dependencies.activateToolCatalog ??
        remoteToolExecutorDependencies.activateToolCatalog!
    )(env.DB, authority, visibleTools);
    return ok({
      catalogVersion: 2,
      sourceRunAuthority: authority.attestation,
      runAuthority: activated.authority.attestation,
      tools: activated.descriptors.map(({ snapshot }) => ({
        ...snapshot.definition,
        // This is an executor-host protocol attestation, not provider-supplied
        // metadata: execute() installs the same side-effect name set into the
        // Worker-owned ToolOperation fence before dispatch.
        durable_idempotency: snapshot.definition.side_effects === true,
      })),
      mcpFailedServers: executor.mcpFailedServers,
    });
  } catch (e: unknown) {
    const authorityError = await runAuthorityErrorResponse({
      error: e,
      env,
      runId,
      stage: "tool_catalog",
    });
    if (authorityError) return authorityError;
    logError("Tool catalog RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  } finally {
    if (executor) await cleanupRequestToolExecutor(executor);
  }
}

async function isToolCallActivationDescendant(params: {
  db: Env["DB"];
  runId: string;
  toolCallId: string;
  requested: RunAuthorityAttestation;
  current: RunAuthorityAttestation;
}): Promise<boolean> {
  const distance = params.current.contextRevision -
    params.requested.contextRevision;
  if (
    distance < 1 || distance > 2 ||
    params.current.runGrantDigest !== params.requested.runGrantDigest
  ) {
    return false;
  }
  const [source, lineage, baseKey, descriptorKey] = await Promise.all([
    getDb(params.db).select({ digest: runContextRevisions.digest })
      .from(runContextRevisions)
      .where(and(
        eq(runContextRevisions.runId, params.runId),
        eq(
          runContextRevisions.revision,
          params.requested.contextRevision,
        ),
      )).get(),
    getDb(params.db).select({
      revision: runContextRevisions.revision,
      parentRevision: runContextRevisions.parentRevision,
      activationEventKey: runContextRevisions.activationEventKey,
      runGrantDigest: runContextRevisions.runGrantDigest,
    }).from(runContextRevisions).where(and(
      eq(runContextRevisions.runId, params.runId),
      gte(
        runContextRevisions.revision,
        params.requested.contextRevision + 1,
      ),
      lte(runContextRevisions.revision, params.current.contextRevision),
    )).orderBy(runContextRevisions.revision).all(),
    runContextActivationEventKey(`tool_call:${params.toolCallId}`),
    runContextActivationEventKey(
      `tool_call:${params.toolCallId}:descriptor`,
    ),
  ]);
  if (
    source?.digest !== params.requested.contextDigest ||
    lineage.length !== distance ||
    lineage.some((row, index) =>
      row.revision !== params.requested.contextRevision + index + 1 ||
      row.parentRevision !== row.revision - 1 ||
      row.runGrantDigest !== params.requested.runGrantDigest
    )
  ) {
    return false;
  }
  if (distance === 1) {
    return lineage[0]?.activationEventKey === baseKey ||
      lineage[0]?.activationEventKey === descriptorKey;
  }
  return lineage[0]?.activationEventKey === descriptorKey &&
    lineage[1]?.activationEventKey === baseKey;
}

export async function handleToolExecute(
  body: Record<string, unknown>,
  env: Env,
  dependencies: RemoteToolExecutorDependencies = remoteToolExecutorDependencies,
): Promise<Response> {
  const { runId, toolCall, idempotencyKey } = body as {
    runId?: string;
    toolCall?: ToolCall;
    idempotencyKey?: unknown;
  };
  if (!runId || !toolCall || typeof toolCall !== "object") {
    return err("Missing runId or toolCall", 400);
  }
  const requestedAuthority = parseRunAuthorityAttestation(body.runAuthority);
  if (!requestedAuthority) {
    return err("Run authority attestation is required", 409);
  }
  if (
    typeof toolCall.id !== "string" ||
    typeof toolCall.name !== "string" ||
    typeof toolCall.arguments !== "object" ||
    toolCall.arguments == null
  ) {
    return err("Invalid toolCall payload", 400);
  }
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== "string" ||
      idempotencyKey.trim().length === 0 ||
      new TextEncoder().encode(idempotencyKey.trim()).byteLength > 512)
  ) {
    return err("Invalid idempotencyKey", 400);
  }

  // A superseded container must not keep running side-effecting tools (deploys,
  // space-file writes) for a run a fresh lease now owns — idempotency.ts only
  // dedups identical runId+tool+args, not divergent A-vs-B calls.
  const leaseError = await ensureRunLease(env, runId, body);
  if (leaseError) return leaseError;

  const identity = normalizeRemoteToolExecutorIdentity(body);
  const abortController = new AbortController();
  let executor: ToolExecutorLike | null = null;
  try {
    const authority = await dependencies.resolveAuthority(runId, env);
    if (
      !runAuthorityAttestationsEqual(
        requestedAuthority,
        authority.attestation,
      )
    ) {
      if (
        !env.DB ||
        typeof (env.DB as { prepare?: unknown }).prepare !== "function"
      ) {
        return err("Run authority attestation is stale", 409);
      }
      if (!await isToolCallActivationDescendant({
        db: env.DB,
        runId,
        toolCallId: toolCall.id,
        requested: requestedAuthority,
        current: authority.attestation,
      })) {
        return err("Run authority attestation is stale", 409);
      }
    }
    executor = await dependencies.createExecutor(
      runId,
      env,
      authority,
      abortController.signal,
    );
    const stopMonitor = new AbortController();
    const monitor = monitorRemoteToolExecutorLease(
      env,
      identity,
      abortController,
      stopMonitor.signal,
    );
    try {
      const result = await executor.execute(
        toolCall,
        typeof idempotencyKey === "string"
          ? { idempotencyKey: idempotencyKey.trim() }
          : undefined,
      );
      // Cancellation can race a handler that ignores AbortSignal. Never return
      // its stale result to the superseded container.
      if (abortController.signal.aborted) return err("Lease lost", 409);
      const finalAuthority = await dependencies.resolveAuthority(runId, env);
      return ok({
        ...result,
        runAuthority: finalAuthority.attestation,
      });
    } finally {
      stopMonitor.abort();
      await monitor;
    }
  } catch (e: unknown) {
    if (abortController.signal.aborted) return err("Lease lost", 409);
    const authorityError = await runAuthorityErrorResponse({
      error: e,
      env,
      runId,
      stage: "tool_execute",
    });
    if (authorityError) return authorityError;
    logError("Tool execute RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  } finally {
    abortController.abort();
    if (executor) await cleanupRequestToolExecutor(executor);
  }
}

export async function handleToolCleanup(
  body: Record<string, unknown>,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  // Executors are request-local, so all resources are already released by the
  // catalog/execute request boundary. Keep cleanup idempotent in the protocol.
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
