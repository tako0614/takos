import type { DurableNamespaceBinding } from "../shared/types/bindings.ts";
import type { Env } from "../shared/types/index.ts";
import type {
  AgentExecutorDispatchPayload,
  LocalExecutorGatewayStub,
  LocalFetch,
} from "./runtime-types.ts";
import { createLocalExecutionContext } from "./execution-context.ts";
import { getDb } from "../infra/db/index.ts";
import { accounts, messages, runs, threads } from "../infra/db/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { persistMessage } from "../application/services/agent/message-persistence.ts";
import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  buildTerminalPayload,
  getRunNotifierStub,
} from "../application/services/run-notifier/index.ts";
import {
  handleAddMessage,
  handleConversationHistory,
  handleMemoryActivation,
  handleMemoryFinalize,
  handleRunEvent,
  handleSkillCatalog,
  handleSkillPlan,
  handleSkillRuntimeContext,
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
  handleUpdateRunStatus,
} from "../runtime/container-hosts/executor-control-rpc.ts";
import { readRunBootstrapInstallationContext } from "../runtime/container-hosts/executor-run-state.ts";
import { getAgentConfig } from "../application/services/agent/runner-config.ts";
import { affectedRowCount } from "../shared/utils/affected-row-count.ts";
import { recordRunUsageBatch } from "../application/services/app-usage/usage-recorder.ts";
import { jsonResponse, readBearerToken } from "./runtime-http.ts";
import { logWarn } from "../shared/utils/logger.ts";
import {
  hasAgentInternalRpcEnvelope,
  verifyAgentInternalRpcFromHeaders,
} from "./agent-internal-rpc-verify.ts";

type LocalExecutorHostEnv = Env & {
  EXECUTOR_CONTAINER: DurableNamespaceBinding<LocalExecutorGatewayStub>;
  TAKOS_AGENT_CONTROL_RPC_BASE_URL?: string;
  PROXY_BASE_URL?: string;
  /**
   * Operator-provided HMAC key shared with the Rust agent
   * (`TAKOS_AGENT_INTERNAL_RPC_KEY`). When set, every agent-control RPC must
   * carry a valid `takos-internal-v3` signed envelope in addition to the
   * per-run bearer proxy token. When unset, envelope verification is skipped
   * for backward compatibility (a warning is logged).
   */
  TAKOS_AGENT_INTERNAL_RPC_KEY?: string;
};

// Mirrors the Rust agent's outbound envelope constants
// (`CONTROL_RPC_INTERNAL_*` in `takos/containers/agent/src/control_rpc.rs`).
const AGENT_INTERNAL_RPC_EXPECTED_CALLER = "takos-agent";
const AGENT_INTERNAL_RPC_EXPECTED_AUDIENCE = "takos-worker";
const AGENT_INTERNAL_RPC_REQUIRED_CAPABILITY = "agent-control.rpc";

let warnedAgentInternalRpcDisabled = false;

const localExecutorProxyUsageCounters = new Map<string, number>();
const AGENT_CONTROL_RPC_PATH_PREFIX = "/api/internal/v1/agent-control";

function isAgentControlRpcPath(path: string): boolean {
  return path.startsWith(`${AGENT_CONTROL_RPC_PATH_PREFIX}/`);
}

function agentControlRpcPath(endpoint: string): string {
  return `${AGENT_CONTROL_RPC_PATH_PREFIX}/${endpoint.replace(/^\/+/, "")}`;
}

function recordLocalExecutorProxyUsage(path: string): void {
  const bucket = path === agentControlRpcPath("tool-catalog")
    ? "tool-catalog"
    : path === agentControlRpcPath("conversation-history")
    ? "conversation-history"
    : path === agentControlRpcPath("skill-runtime-context")
    ? "skill-runtime-context"
    : path === agentControlRpcPath("skill-catalog")
    ? "skill-catalog"
    : path === agentControlRpcPath("skill-plan")
    ? "skill-plan"
    : path === agentControlRpcPath("memory-activation")
    ? "memory-activation"
    : path === agentControlRpcPath("memory-finalize")
    ? "memory-finalize"
    : path === agentControlRpcPath("add-message")
    ? "add-message"
    : path === agentControlRpcPath("update-run-status")
    ? "update-run-status"
    : path === agentControlRpcPath("run-config")
    ? "run-config"
    : path === agentControlRpcPath("tool-execute")
    ? "tool-execute"
    : path === agentControlRpcPath("tool-cleanup")
    ? "tool-cleanup"
    : path === agentControlRpcPath("run-event")
    ? "run-event"
    : path.startsWith("/proxy/")
    ? "other-proxy"
    : isAgentControlRpcPath(path)
    ? "other-control-rpc"
    : "other";
  localExecutorProxyUsageCounters.set(
    bucket,
    (localExecutorProxyUsageCounters.get(bucket) ?? 0) + 1,
  );
}

function getLocalExecutorProxyUsageSnapshot(): Record<string, number> {
  return Object.fromEntries(
    [...localExecutorProxyUsageCounters.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    ),
  );
}

function localExecutorUnauthorized(): Response {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

function parseControlRpcJsonBody(
  rawBody: string,
  path: string,
): Record<string, unknown> {
  if (rawBody.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (e) {
    logWarn("Failed to parse executor control RPC request body", {
      module: "local-executor",
      path,
      error: String(e),
    });
    return {};
  }
}

function localExecutorError(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

function readRunServiceId(body: Record<string, unknown>): string | null {
  if (typeof body.serviceId === "string" && body.serviceId.length > 0) {
    return body.serviceId;
  }
  if (typeof body.workerId === "string" && body.workerId.length > 0) {
    return body.workerId;
  }
  return null;
}

function isLocalExecutorGatewayStub(
  value: unknown,
): value is LocalExecutorGatewayStub {
  return typeof value === "object" && value !== null &&
    "dispatchStart" in value && typeof value.dispatchStart === "function" &&
    "verifyProxyToken" in value && typeof value.verifyProxyToken === "function";
}

function getLocalExecutorGatewayBinding(
  env: LocalExecutorHostEnv,
  runId: string,
): LocalExecutorGatewayStub {
  const namespace = env.EXECUTOR_CONTAINER;
  const stub = typeof namespace.getByName === "function"
    ? namespace.getByName(runId)
    : namespace.get(namespace.idFromName(runId));
  if (!isLocalExecutorGatewayStub(stub)) {
    throw new Error(`Executor gateway binding for run ${runId} is invalid`);
  }
  return stub;
}

async function resolveLocalExecutionUserIdForRun(
  env: LocalExecutorHostEnv,
  runId: string,
): Promise<string> {
  const db = getDb(env.DB);
  const runRow = await db.select({
    accountId: runs.accountId,
    requesterAccountId: runs.requesterAccountId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!runRow?.accountId) {
    throw new Error(
      `Run not found while resolving execution user for run ${runId}`,
    );
  }

  if (runRow.requesterAccountId) {
    return runRow.requesterAccountId;
  }

  const workspace = await db.select({
    type: accounts.type,
    ownerAccountId: accounts.ownerAccountId,
  }).from(accounts).where(eq(accounts.id, runRow.accountId)).get();

  if (workspace?.ownerAccountId) {
    return workspace.ownerAccountId;
  }

  if (workspace?.type === "user") {
    return runRow.accountId;
  }

  return runRow.accountId;
}

async function localHandleRunBootstrap(
  runId: string,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  if (!runId) return localExecutorError("Missing runId", 400);

  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status,
    accountId: runs.accountId,
    input: runs.input,
    sessionId: runs.sessionId,
    threadId: runs.threadId,
    agentType: runs.agentType,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) {
    return localExecutorError(`Run not found: ${runId}`, 404);
  }

  const thread = await db.select({
    accountId: threads.accountId,
  }).from(threads).where(eq(threads.id, run.threadId)).get();

  if (!thread) {
    return localExecutorError(`Thread not found: ${run.threadId}`, 404);
  }

  if (thread.accountId !== run.accountId) {
    return localExecutorError(
      `Thread ${run.threadId} does not belong to account ${run.accountId}`,
      409,
    );
  }

  const userId = await resolveLocalExecutionUserIdForRun(env, runId);
  return jsonResponse({
    status: run.status,
    spaceId: run.accountId,
    ...readRunBootstrapInstallationContext(run.input),
    sessionId: run.sessionId ?? null,
    threadId: run.threadId,
    userId,
    agentType: run.agentType,
  });
}

async function localHandleRunStatus(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  if (!runId) return localExecutorError("Missing runId", 400);
  const db = getDb(env.DB);
  const row = await db.select({ status: runs.status }).from(runs).where(
    eq(runs.id, runId),
  ).limit(1);
  return jsonResponse({ status: row[0]?.status ?? null });
}

async function localHandleRunRecord(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  if (!runId) return localExecutorError("Missing runId", 400);
  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status,
    input: runs.input,
    parentRunId: runs.parentRunId,
  }).from(runs).where(eq(runs.id, runId)).get();
  return jsonResponse({
    status: run?.status ?? null,
    input: run?.input ?? null,
    parentRunId: run?.parentRunId ?? null,
  });
}

async function localHandleHeartbeat(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = typeof body.leaseVersion === "number"
    ? body.leaseVersion
    : undefined;
  if (!runId || !serviceId) {
    return localExecutorError("Missing runId or serviceId", 400);
  }

  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const conditions = [eq(runs.id, runId), eq(runs.serviceId, serviceId)];
  if (typeof leaseVersion === "number") {
    conditions.push(eq(runs.leaseVersion, leaseVersion));
  }
  const result = await db.update(runs).set({ serviceHeartbeat: now }).where(
    and(...conditions),
  );
  if (affectedRowCount(result) === 0) {
    return localExecutorError("Lease lost", 409);
  }
  return jsonResponse({ success: true });
}

async function localHandleRunFail(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = typeof body.leaseVersion === "number"
    ? body.leaseVersion
    : undefined;
  const errorMessage = typeof body.error === "string" ? body.error : null;
  if (!runId || !serviceId) {
    return localExecutorError("Missing runId or serviceId", 400);
  }
  if (!errorMessage?.trim()) return localExecutorError("Missing error", 400);

  const db = getDb(env.DB);
  const conditions = [
    eq(runs.id, runId),
    eq(runs.serviceId, serviceId),
    eq(runs.status, "running"),
  ];
  if (typeof leaseVersion === "number") {
    conditions.push(eq(runs.leaseVersion, leaseVersion));
  }
  const result = await db.update(runs).set({
    status: "failed",
    error: errorMessage,
    completedAt: new Date().toISOString(),
  }).where(and(...conditions));
  return jsonResponse({ success: true, updated: affectedRowCount(result) > 0 });
}

async function localHandleRunReset(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) {
    return localExecutorError("Missing runId or serviceId", 400);
  }
  const db = getDb(env.DB);
  await db.update(runs)
    .set({ status: "queued", serviceId: null, serviceHeartbeat: null })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.serviceId, serviceId),
        eq(runs.status, "running"),
      ),
    );
  return jsonResponse({ success: true });
}

async function localHandleRunContext(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  if (!runId) return localExecutorError("Missing runId", 400);

  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status,
    threadId: runs.threadId,
    sessionId: runs.sessionId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) {
    return jsonResponse({
      status: null,
      threadId: null,
      sessionId: null,
      lastUserMessage: null,
    });
  }

  const latestUserMessage = run.threadId
    ? await db.select({ content: messages.content })
      .from(messages)
      .where(
        and(eq(messages.threadId, run.threadId), eq(messages.role, "user")),
      )
      .orderBy(desc(messages.sequence))
      .get()
    : null;

  return jsonResponse({
    status: run.status ?? null,
    threadId: run.threadId ?? null,
    sessionId: run.sessionId ?? null,
    lastUserMessage: latestUserMessage?.content ?? null,
  });
}

async function localHandleRunConfig(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const explicitAgentType = typeof body.agentType === "string"
    ? body.agentType
    : null;

  let agentType = explicitAgentType;
  if (!agentType && runId) {
    const db = getDb(env.DB);
    const run = await db.select({ agentType: runs.agentType }).from(runs).where(
      eq(runs.id, runId),
    ).get();
    agentType = run?.agentType ?? null;
  }

  const config = getAgentConfig(agentType ?? "default", env);
  return jsonResponse({
    ...config,
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

async function localAugmentJsonSuccessResponse(
  response: Response,
  augment: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return response;
  }

  return jsonResponse(
    augment(payload as Record<string, unknown>),
    response.status,
  );
}

async function localHandleSkillPlanCompat(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  return localAugmentJsonSuccessResponse(
    await handleSkillPlan(body, env),
    (payload) => {
      const locale = typeof payload.locale === "string"
        ? payload.locale
        : typeof payload.skillLocale === "string"
        ? payload.skillLocale
        : "en";
      return {
        ...payload,
        locale,
        skillLocale: typeof payload.skillLocale === "string"
          ? payload.skillLocale
          : locale,
      };
    },
  );
}

async function localHandleSkillCatalogCompat(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  return localAugmentJsonSuccessResponse(
    await handleSkillCatalog(body, env),
    (payload) => {
      const locale = typeof payload.locale === "string" ? payload.locale : "en";
      return {
        ...payload,
        locale,
      };
    },
  );
}

async function localHandleSkillRuntimeContextCompat(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  return localAugmentJsonSuccessResponse(
    await handleSkillRuntimeContext(body, env),
    (payload) => ({
      ...payload,
    }),
  );
}

async function localHandleNoLlmComplete(
  body: Record<string, unknown>,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const response = typeof body.response === "string" ? body.response : null;
  if (!runId || !serviceId) {
    return localExecutorError("Missing runId or serviceId", 400);
  }
  if (!response?.trim()) return localExecutorError("Missing response", 400);

  const db = getDb(env.DB);
  const run = await db.select({
    id: runs.id,
    threadId: runs.threadId,
    sessionId: runs.sessionId,
    serviceId: runs.serviceId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) return localExecutorError("Run not found", 404);
  if (run.serviceId !== serviceId) {
    return localExecutorError("Run service mismatch", 409);
  }

  if (run.threadId) {
    await persistMessage(
      { db: env.DB, env, threadId: run.threadId },
      { role: "assistant", content: response },
    );
  }

  const completedAt = new Date().toISOString();
  await db.update(runs)
    .set({
      status: "completed",
      output: JSON.stringify({ response, mode: "no-llm" }),
      usage: JSON.stringify({ inputTokens: 0, outputTokens: 0 }),
      completedAt,
    })
    .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId)));

  try {
    const stub = getRunNotifierStub(env, runId);
    await stub.fetch(buildRunNotifierEmitRequest(
      buildRunNotifierEmitPayload(runId, "message", { content: response }),
    ));
    await stub.fetch(buildRunNotifierEmitRequest(
      buildRunNotifierEmitPayload(
        runId,
        "completed",
        buildTerminalPayload(runId, "completed", {
          success: true,
          mode: "no-llm",
        }, run.sessionId ?? null),
      ),
    ));
  } catch {
    // Local completion should not fail on notifier transport issues.
  }

  return jsonResponse({ success: true });
}

async function localHandleExecutorControlRpc(
  request: Request,
  env: LocalExecutorHostEnv,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const controlPath = path;
  const runId = request.headers.get("X-Takos-Run-Id");
  const token = readBearerToken(request.headers.get("Authorization"));
  if (!runId || !token) return localExecutorUnauthorized();

  const stub = getLocalExecutorGatewayBinding(env, runId);
  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.capability !== "control") {
    return localExecutorUnauthorized();
  }

  // Read the raw body text once so the HMAC body-digest check covers the exact
  // wire bytes the agent signed, then parse JSON from the same bytes.
  const rawBody = request.method === "POST" ? await request.text() : "";

  // Defense-in-depth on top of the per-run bearer token: when the operator has
  // provisioned the shared HMAC key, every agent-control RPC must carry a valid
  // `takos-internal-v3` signed envelope. When the key is unset, skip the check
  // for backward compatibility but warn that signature verification is off.
  const internalRpcKey = env.TAKOS_AGENT_INTERNAL_RPC_KEY?.trim();
  if (internalRpcKey) {
    const verified = await verifyAgentInternalRpcFromHeaders({
      method: request.method,
      path,
      // The agent signs control RPC with `query: None`; query string is not
      // part of the agent-control canonical message.
      query: undefined,
      body: rawBody,
      secret: internalRpcKey,
      headers: request.headers,
      expectedCaller: AGENT_INTERNAL_RPC_EXPECTED_CALLER,
      expectedAudience: AGENT_INTERNAL_RPC_EXPECTED_AUDIENCE,
      requiredCapabilities: [AGENT_INTERNAL_RPC_REQUIRED_CAPABILITY],
    });
    if (!verified) {
      logWarn(
        "Rejected agent-control RPC with missing/invalid signed envelope",
        {
          module: "local-executor",
          path,
          runId,
          envelopePresent: String(hasAgentInternalRpcEnvelope(request.headers)),
        },
      );
      return localExecutorUnauthorized();
    }
  } else if (!warnedAgentInternalRpcDisabled) {
    warnedAgentInternalRpcDisabled = true;
    logWarn(
      "TAKOS_AGENT_INTERNAL_RPC_KEY not set; agent-control RPC signature verification is disabled (bearer token only)",
      { module: "local-executor" },
    );
  }

  const body = request.method === "POST"
    ? parseControlRpcJsonBody(rawBody, path)
    : Object.fromEntries(new URL(request.url).searchParams.entries());

  if (typeof body === "object" && body !== null) {
    const bodyRunId =
      typeof (body as Record<string, unknown>).runId === "string"
        ? (body as Record<string, unknown>).runId as string
        : null;
    const bodyServiceId = readRunServiceId(body as Record<string, unknown>);
    if (bodyRunId && bodyRunId !== tokenInfo.runId) {
      return localExecutorUnauthorized();
    }
    if (bodyServiceId && bodyServiceId !== tokenInfo.serviceId) {
      return localExecutorUnauthorized();
    }
  }

  recordLocalExecutorProxyUsage(path);

  switch (controlPath) {
    case agentControlRpcPath("heartbeat"):
      return localHandleHeartbeat(body as Record<string, unknown>, env);
    case agentControlRpcPath("run-status"):
      return localHandleRunStatus(body as Record<string, unknown>, env);
    case agentControlRpcPath("run-record"):
      return localHandleRunRecord(body as Record<string, unknown>, env);
    case agentControlRpcPath("run-bootstrap"):
      return localHandleRunBootstrap(
        typeof (body as Record<string, unknown>).runId === "string"
          ? (body as Record<string, unknown>).runId as string
          : "",
        env,
      );
    case agentControlRpcPath("run-fail"):
      return localHandleRunFail(body as Record<string, unknown>, env);
    case agentControlRpcPath("run-reset"):
      return localHandleRunReset(body as Record<string, unknown>, env);
    case agentControlRpcPath("run-config"):
      return localHandleRunConfig(body as Record<string, unknown>, env);
    case agentControlRpcPath("api-keys"):
      return jsonResponse({
        openai: env.OPENAI_API_KEY ?? null,
        anthropic: env.ANTHROPIC_API_KEY ?? null,
        google: env.GOOGLE_API_KEY ?? null,
      });
    case agentControlRpcPath("run-usage"): {
      const runId = typeof (body as Record<string, unknown>).runId === "string"
        ? (body as Record<string, unknown>).runId as string
        : null;
      if (!runId) return localExecutorError("Missing runId", 400);
      await recordRunUsageBatch(env, runId);
      return jsonResponse({ recorded: true });
    }
    case agentControlRpcPath("run-context"):
      return localHandleRunContext(body as Record<string, unknown>, env);
    case agentControlRpcPath("conversation-history"):
      return handleConversationHistory(body as Record<string, unknown>, env);
    case agentControlRpcPath("skill-runtime-context"):
      return localHandleSkillRuntimeContextCompat(
        body as Record<string, unknown>,
        env,
      );
    case agentControlRpcPath("skill-catalog"):
      return localHandleSkillCatalogCompat(
        body as Record<string, unknown>,
        env,
      );
    case agentControlRpcPath("skill-plan"):
      return localHandleSkillPlanCompat(body as Record<string, unknown>, env);
    case agentControlRpcPath("memory-activation"):
      return handleMemoryActivation(body as Record<string, unknown>, env);
    case agentControlRpcPath("memory-finalize"):
      return handleMemoryFinalize(body as Record<string, unknown>, env);
    case agentControlRpcPath("add-message"):
      return handleAddMessage(body as Record<string, unknown>, env);
    case agentControlRpcPath("update-run-status"):
      return handleUpdateRunStatus(body as Record<string, unknown>, env);
    case agentControlRpcPath("tool-catalog"):
      return handleToolCatalog(body as Record<string, unknown>, env);
    case agentControlRpcPath("tool-execute"):
      return handleToolExecute(body as Record<string, unknown>, env);
    case agentControlRpcPath("tool-cleanup"):
      return handleToolCleanup(body as Record<string, unknown>);
    case agentControlRpcPath("run-event"):
      return handleRunEvent(body as Record<string, unknown>, env);
    case agentControlRpcPath("no-llm-complete"):
      return localHandleNoLlmComplete(body as Record<string, unknown>, env);
    default:
      return localExecutorError(
        `Unsupported local executor control RPC: ${path}`,
        501,
      );
  }
}

export async function buildLocalExecutorHostFetch(
  env: LocalExecutorHostEnv,
): Promise<LocalFetch> {
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "takos-executor-host" });
    }

    if (url.pathname === "/internal/proxy-usage" && request.method === "GET") {
      return jsonResponse({
        status: "ok",
        service: "takos-executor-host",
        counts: getLocalExecutorProxyUsageSnapshot(),
      });
    }

    if (url.pathname === "/dispatch" && request.method === "POST") {
      const body = await request.json().catch(() => null) as
        | AgentExecutorDispatchPayload
        | null;
      if (!body?.runId || !body.serviceId?.trim() || !body.workerId?.trim()) {
        return localExecutorError("Missing runId, serviceId, or workerId", 400);
      }
      const stub = getLocalExecutorGatewayBinding(env, body.runId);
      const result = await stub.dispatchStart(body);
      return new Response(result.body, { status: result.status });
    }

    if (isAgentControlRpcPath(url.pathname)) {
      return localHandleExecutorControlRpc(request, env);
    }

    return new Response("takos-executor-host", { status: 200 });
  };
}
