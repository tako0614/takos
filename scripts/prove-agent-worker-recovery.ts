#!/usr/bin/env bun

/** A local, real-handler/process proof of a committed tool RPC with a lost HTTP acknowledgement. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  accountMemberships,
  accounts,
  artifacts,
  getDb,
  messages,
  runEvents,
  runs,
  threads,
  toolOperations,
} from "../src/worker/infra/db/index.ts";
import { createSqliteSqlDatabase } from "../src/worker/local-platform/persistent-d1.ts";
import { dispatchControlRpc } from "../src/worker/runtime/executor-proxy-api.ts";
import { agentControlRpcPath, isControlRpcPath } from "../src/worker/runtime/container-hosts/executor-utils.ts";
import type { Env } from "../src/worker/shared/types/index.ts";

type Json = Record<string, unknown>;
type Identity = { runId: string; serviceId: string; leaseVersion: number };
type RequestTrace = { path: string; identity: string; body: Json; status: number };

const PHASE_MS = 45_000;
const RUN_MS = 150_000;
const OVERALL_MS = 300_000;
const MAX_LOG_BYTES = 24_000;

function requireValue(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function object(value: unknown, detail: string): Json {
  requireValue(value && typeof value === "object" && !Array.isArray(value), `${detail} must be an object`);
  return value as Json;
}

function parseArgs(args: readonly string[]): { binary: string; root: string } {
  let binary: string | undefined;
  let root: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    requireValue((flag === "--binary" || flag === "--root") && value && !value.startsWith("--"),
      "usage: bun scripts/prove-agent-worker-recovery.ts --binary <absolute-path> [--root <Takos-root>]");
    if (flag === "--binary") {
      requireValue(binary === undefined, "duplicate --binary");
      binary = value;
    } else {
      requireValue(root === undefined, "duplicate --root");
      root = value;
    }
  }
  requireValue(binary && isAbsolute(binary), "--binary must be an absolute path");
  return { binary, root: resolve(root ?? join(import.meta.dir, "..")) };
}

async function withTimeout<T>(promise: Promise<T>, label: string, ms = PHASE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function binarySha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function freeLoopbackPort(): Promise<number> {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
  const port = reservation.port;
  reservation.stop(true);
  requireValue(typeof port === "number" && port > 0, "failed to reserve a loopback port");
  return port;
}

function safeChildEnv(port: number, startToken: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.PORT = String(port);
  env.TAKOS_AGENT_BIND_HOST = "127.0.0.1";
  env.TAKOS_AGENT_START_TOKEN = startToken;
  env.TAKOS_AGENT_TOOL_ALLOWLIST = "create_artifact";
  env.NO_PROXY = "localhost,127.0.0.1,::1";
  env.no_proxy = env.NO_PROXY;
  env.RUST_LOG = "info";
  return env;
}

async function drain(stream: ReadableStream<Uint8Array> | null, sink: { value: string }): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sink.value = `${sink.value}${decoder.decode(value)}`.slice(-MAX_LOG_BYTES);
    }
  } finally {
    reader.releaseLock();
  }
}

type Child = ReturnType<typeof Bun.spawn>;
async function launch(
  binary: string,
  port: number,
  token: string,
  registerChild: (child: Child) => void,
  isTimedOut: () => boolean,
): Promise<{ child: Child; log: { value: string } }> {
  requireValue(!isTimedOut(), "overall deadline expired before wrapper launch");
  const child = Bun.spawn([binary], {
    env: safeChildEnv(port, token),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Register before the first await: the watchdog must see even a child whose
  // health check has not yet finished and whose launch has not returned.
  registerChild(child);
  const log = { value: "" };
  const noteDrainFailure = (error: unknown) => {
    log.value = `${log.value}\nlog drain failed: ${String(error)}`.slice(-MAX_LOG_BYTES);
  };
  void drain(child.stdout as ReadableStream<Uint8Array>, log).catch(noteDrainFailure);
  void drain(child.stderr as ReadableStream<Uint8Array>, log).catch(noteDrainFailure);
  try {
    const deadline = Date.now() + PHASE_MS;
    while (Date.now() < deadline) {
      requireValue(!isTimedOut(), "overall deadline expired during wrapper startup");
      if (child.exitCode !== null) throw new Error(`wrapper exited before health (${child.exitCode}): ${log.value}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
        if (response.ok) {
          requireValue(!isTimedOut(), "overall deadline expired during wrapper startup");
          return { child, log };
        }
      } catch { /* listener is starting */ }
      await Bun.sleep(100);
    }
    throw new Error(`wrapper did not bind loopback port ${port}: ${log.value}`);
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function stop(child: Child | undefined): Promise<number | undefined> {
  if (!child) return undefined;
  if (child.exitCode === null) child.kill("SIGKILL");
  return await withTimeout(child.exited, "reap wrapper", 10_000);
}

async function start(port: number, token: string, base: string, rpcToken: string, identity: Identity): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      runId: identity.runId,
      workerId: identity.serviceId,
      serviceId: identity.serviceId,
      leaseVersion: identity.leaseVersion,
      model: "gpt-local",
      checkpointProtocolVersion: 2,
      executorTier: 1,
      executorContainerId: `local-${identity.leaseVersion}`,
      controlRpcBaseUrl: base,
      controlRpcToken: rpcToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  requireValue(response.ok, `wrapper /start failed (${response.status}): ${body.slice(0, 1000)}`);
}

type ProofWatchdog = {
  timedOut: boolean;
  context?: string;
  abort: () => Promise<void>;
};

export async function proveAgentWorkerRecovery(options: { binary: string; root: string }): Promise<Json> {
  const watchdog: ProofWatchdog = { timedOut: false, abort: async () => undefined };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      watchdog.timedOut = true;
      void watchdog.abort().then(
        () => reject(new Error(`agent Worker recovery proof exceeded ${OVERALL_MS}ms; context=${watchdog.context ?? "not-created"}; own wrapper processes reaped`)),
        (error) => reject(new Error(`agent Worker recovery proof exceeded ${OVERALL_MS}ms; context=${watchdog.context ?? "not-created"}; cleanup failed: ${String(error)}`)),
      );
    }, OVERALL_MS);
  });
  try {
    return await Promise.race([runAgentWorkerRecovery(options, watchdog), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runAgentWorkerRecovery(options: { binary: string; root: string }, watchdog: ProofWatchdog): Promise<Json> {
  // The bridge and model fixture are always loopback. Do not let an operator
  // proxy setting redirect even this proof's own local fetches.
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[key];
  process.env.NO_PROXY = "localhost,127.0.0.1,::1";
  process.env.no_proxy = process.env.NO_PROXY;
  const { root, binary } = options;
  requireValue(isAbsolute(binary) && (await stat(binary)).isFile(), "--binary must name an existing file");
  requireValue((await stat(join(root, "db/migrations-control/migrations"))).isDirectory(), "--root must name the Takos checkout with control migrations");
  await mkdir(join(root, "tmp"), { recursive: true });
  const context = join(root, "tmp", `agent-worker-recovery-${randomUUID()}`);
  await mkdir(context);
  watchdog.context = context;
  const localBinary = join(context, "takos-agent");
  let binarySHA256 = "";
  const dbFile = join(context, "recovery.sqlite");
  const oldIdentity: Identity = { runId: `run_${randomUUID()}`, serviceId: `service_old_${randomUUID()}`, leaseVersion: 7 };
  const newIdentity: Identity = { ...oldIdentity, serviceId: `service_new_${randomUUID()}`, leaseVersion: 8 };
  const oldToken = randomUUID();
  const newToken = randomUUID();
  const startToken = randomUUID();
  const modelKey = `local-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const workspaceId = `space_${randomUUID()}`;
  const threadId = `thread_${randomUUID()}`;
  const now = new Date().toISOString();
  const trace: RequestTrace[] = [];
  const modelInputs: Json[] = [];
  let toolCatalog: Json | undefined;
  const operationCommitted = deferred<void>();
  const terminalAcknowledged = deferred<void>();
  const releaseOldAcknowledgement = deferred<void>();
  let holdFirstAcknowledgement = true;
  let oldAcknowledgementReleased = false;
  let oldChild: Child | undefined;
  let newChild: Child | undefined;
  const children = new Set<Child>();
  let oldLog = { value: "" };
  let newLog = { value: "" };
  let server: ReturnType<typeof Bun.serve> | undefined;
  let dbBinding: Awaited<ReturnType<typeof createSqliteSqlDatabase>> | undefined;
  let succeeded = false;
  let result: Json | undefined;
  let phase = "setup";
  let primaryFailure: Error | undefined;
  let cleanupFailure: Error | undefined;
  let abortPromise: Promise<void> | undefined;
  watchdog.abort = () => abortPromise ??= (async () => {
    releaseOldAcknowledgement.resolve();
    const stopped = await Promise.allSettled([...children].map((child) => stop(child)));
    const failures = stopped.flatMap((result, index) => result.status === "rejected"
      ? [`wrapper ${index + 1} reap: ${String(result.reason)}`]
      : []);
    try {
      await server?.stop(true);
    } catch (error) {
      failures.push(`bridge stop: ${String(error)}`);
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
  })();
  try {
    phase = "copy reviewed executable";
    await copyFile(binary, localBinary);
    await chmod(localBinary, 0o700);
    binarySHA256 = await binarySha256(localBinary);
    requireValue(!watchdog.timedOut, "overall deadline expired while preparing executable");
    phase = "migrate and seed";
    dbBinding = await withTimeout(createSqliteSqlDatabase(dbFile, join(root, "db/migrations-control/migrations")), "full SQLite migrations", RUN_MS);
    requireValue(!watchdog.timedOut, "overall deadline expired while migrating SQLite");
    const db = getDb(dbBinding);
    await db.insert(accounts).values({ id: accountId, type: "user", status: "active", name: "Proof User", slug: `proof-user-${randomUUID()}`, ownerAccountId: accountId, createdAt: now, updatedAt: now });
    await db.insert(accounts).values({ id: workspaceId, type: "team", status: "active", name: "Proof Workspace", slug: `proof-space-${randomUUID()}`, ownerAccountId: accountId, createdAt: now, updatedAt: now });
    await db.insert(accountMemberships).values({ id: `membership_${randomUUID()}`, accountId: workspaceId, memberId: accountId, role: "owner", status: "active", createdAt: now, updatedAt: now });
    await db.insert(threads).values({ id: threadId, accountId: workspaceId, title: "Recovery proof", nextMessageSequence: 1, createdAt: now, updatedAt: now });
    await db.insert(runs).values({ id: oldIdentity.runId, accountId: workspaceId, requesterAccountId: accountId, threadId, status: "running", serviceId: oldIdentity.serviceId, leaseVersion: 7, agentType: "default", model: "gpt-local", input: JSON.stringify({ message: "Create the proof artifact" }), startedAt: now, createdAt: now });
    await db.insert(messages).values({ id: `msg_${randomUUID()}`, threadId, role: "user", content: "Create the proof artifact", sequence: 0, createdAt: now });

    const bridgePort = await freeLoopbackPort();
    const bridgeBase = `http://127.0.0.1:${bridgePort}`;
    const env = {
      DB: dbBinding,
      ENVIRONMENT: "development",
      OPENAI_API_KEY: modelKey,
      OPENAI_BASE_URL: `${bridgeBase}/v1`,
      RUN_NOTIFIER: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ success: true }) }) },
    } as unknown as Env;
    const tokens = new Map<string, Identity>([[oldToken, oldIdentity], [newToken, newIdentity]]);
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: bridgePort,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
          if (request.headers.get("authorization") !== `Bearer ${modelKey}`) return Response.json({ error: "unauthorized" }, { status: 401 });
          const body = object(await request.json(), "model request");
          modelInputs.push(body);
          const callNumber = modelInputs.length;
          if (callNumber > 2) return Response.json({ error: "unexpected model call" }, { status: 409 });
          return Response.json({
            id: `chatcmpl-proof-${callNumber}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "gpt-local",
            choices: [{ index: 0, message: callNumber === 1
              ? { role: "assistant", content: null, tool_calls: [{ id: "call-recovery-1", type: "function", function: { name: "create_artifact", arguments: JSON.stringify({ type: "doc", title: "recovery-proof", content: "local fixture" }) } }] }
              : { role: "assistant", content: "recovered answer", tool_calls: [] }, finish_reason: callNumber === 1 ? "tool_calls" : "stop" }],
            usage: { prompt_tokens: callNumber === 1 ? 11 : 13, completion_tokens: callNumber === 1 ? 3 : 5, prompt_tokens_details: { cached_tokens: callNumber === 1 ? 2 : 1 } },
          });
        }
        if (!isControlRpcPath(url.pathname) || (request.method !== "POST" && request.method !== "GET")) return Response.json({ error: "not found" }, { status: 404 });
        const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/u)?.[1];
        const identity = bearer ? tokens.get(bearer) : undefined;
        if (!identity || request.headers.get("x-takos-run-id") !== identity.runId) return Response.json({ error: "unauthorized" }, { status: 401 });
        const body = request.method === "POST" ? object(await request.json(), "control RPC request") : Object.fromEntries(url.searchParams);
        body.runId = identity.runId;
        body.serviceId = identity.serviceId;
        body.workerId = identity.serviceId;
        body.leaseVersion = identity.leaseVersion;
        const response = await dispatchControlRpc(url.pathname, body, env);
        if (!response) return Response.json({ error: "unmapped control RPC" }, { status: 404 });
        if (url.pathname === agentControlRpcPath("tool-catalog") && response.ok) {
          toolCatalog = object(await response.clone().json(), "real tool catalog");
        }
        trace.push({ path: url.pathname, identity: identity.serviceId, body, status: response.status });
        if (url.pathname === agentControlRpcPath("complete-run") && identity.serviceId === newIdentity.serviceId && response.ok) {
          terminalAcknowledged.resolve();
        }
        if (url.pathname === agentControlRpcPath("tool-execute") && identity.serviceId === oldIdentity.serviceId && response.ok && holdFirstAcknowledgement) {
          holdFirstAcknowledgement = false;
          operationCommitted.resolve();
          await withTimeout(releaseOldAcknowledgement.promise, "release old tool acknowledgement", RUN_MS);
          oldAcknowledgementReleased = true;
        }
        return response;
      },
    });

    phase = "first process";
    const oldPort = await freeLoopbackPort();
    ({ child: oldChild, log: oldLog } = await launch(localBinary, oldPort, startToken, (child) => children.add(child), () => watchdog.timedOut));
    requireValue(!watchdog.timedOut, "overall deadline expired before first start");
    await start(oldPort, startToken, bridgeBase, oldToken, oldIdentity);
    await withTimeout(operationCommitted.promise, "first committed tool operation", RUN_MS);
    const firstRun = await db.select().from(runs).where(eq(runs.id, oldIdentity.runId)).get();
    const firstArtifacts = await db.select().from(artifacts).where(eq(artifacts.runId, oldIdentity.runId));
    const firstOperations = await db.select().from(toolOperations).where(eq(toolOperations.runId, oldIdentity.runId));
    requireValue(firstRun?.engineCheckpoint, "running checkpoint was not stored before tool RPC");
    const stored = object(JSON.parse(firstRun.engineCheckpoint), "stored checkpoint envelope");
    const checkpoint = object(stored.checkpoint, "engine checkpoint");
    const firstUsage = object(stored.usage, "first checkpoint usage");
    const state = object(checkpoint.state_json, "engine checkpoint state");
    const pending = state.pending_tool_calls;
    requireValue(checkpoint.graph_id === "external-context-v1" && checkpoint.current_node === "execute_tools" && checkpoint.status === "running", "first checkpoint is not the pending execute_tools node");
    requireValue(typeof checkpoint.loop_id === "string" && checkpoint.loop_id.length > 0 && Array.isArray(pending) && object(pending[0], "pending tool").id === "call-recovery-1", "first checkpoint lost the correlated call or loop");
    requireValue(firstUsage.inputTokens === 11 && firstUsage.outputTokens === 3 && firstUsage.cachedInputTokens === 2, "first model usage was not durable before the lost acknowledgement");
    requireValue(firstArtifacts.length === 1 && firstOperations.length === 1 && firstOperations[0]?.status === "completed", "real tool effect/operation did not commit exactly once");
    const operationKey = firstOperations[0]!.operationKey;
    const firstAttempt = trace.find((item) => item.path === agentControlRpcPath("tool-execute"));
    requireValue(Array.isArray(toolCatalog?.tools) && toolCatalog.tools.some((item) => {
      const tool = object(item, "catalog tool");
      return tool.name === "create_artifact" && tool.side_effects === true && tool.durable_idempotency === true;
    }), "real Worker tool catalog did not attest durable create_artifact idempotency");
    requireValue(operationKey && firstAttempt?.body.idempotencyKey === operationKey, "operation key was not engine supplied");
    requireValue(modelInputs.length === 1, "old process called model more than once");

    phase = "kill and reclaim";
    const oldExit = await stop(oldChild);
    requireValue(typeof oldExit === "number", "old OS process did not exit");
    requireValue(!watchdog.timedOut, "overall deadline expired before lease reclaim");
    await db.update(runs).set({ serviceId: newIdentity.serviceId, leaseVersion: 8, serviceHeartbeat: new Date().toISOString() }).where(and(eq(runs.id, oldIdentity.runId), eq(runs.serviceId, oldIdentity.serviceId), eq(runs.leaseVersion, 7)));
    releaseOldAcknowledgement.resolve();
    await withTimeout((async () => { while (!oldAcknowledgementReleased) await Bun.sleep(10); })(), "old acknowledgement release");
    const beforeStale = await db.select().from(runs).where(eq(runs.id, oldIdentity.runId)).get();
    const beforeStaleArtifacts = await db.select().from(artifacts).where(eq(artifacts.runId, oldIdentity.runId));
    const beforeStaleOperations = await db.select().from(toolOperations).where(eq(toolOperations.runId, oldIdentity.runId));
    const beforeStaleMessages = await db.select().from(messages).where(eq(messages.threadId, threadId));
    const beforeStaleEvents = await db.select().from(runEvents).where(eq(runEvents.runId, oldIdentity.runId));
    const staleBodies: [string, Json][] = [
      ["heartbeat", {}],
      ["engine-checkpoint-save", { checkpoint, usage: stored.usage, checkpointProtocolVersion: 2 }],
      ["tool-execute", { toolCall: { id: "call-recovery-1", name: "create_artifact", arguments: { type: "doc", title: "recovery-proof", content: "local fixture" } }, idempotencyKey: operationKey }],
      ["complete-run", { status: "completed", usage: { inputTokens: 24, outputTokens: 8, cachedInputTokens: 3 }, messages: [], output: "stale" }],
    ];
    for (const [endpoint, payload] of staleBodies) {
      const stale = await fetch(`${bridgeBase}${agentControlRpcPath(endpoint)}`, { method: "POST", headers: { authorization: `Bearer ${oldToken}`, "x-takos-run-id": oldIdentity.runId, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
      requireValue(stale.status === 409, `stale ${endpoint} was not fenced: ${stale.status}`);
    }
    const afterStale = await db.select().from(runs).where(eq(runs.id, oldIdentity.runId)).get();
    const afterStaleArtifacts = await db.select().from(artifacts).where(eq(artifacts.runId, oldIdentity.runId));
    const afterStaleOperations = await db.select().from(toolOperations).where(eq(toolOperations.runId, oldIdentity.runId));
    const afterStaleMessages = await db.select().from(messages).where(eq(messages.threadId, threadId));
    const afterStaleEvents = await db.select().from(runEvents).where(eq(runEvents.runId, oldIdentity.runId));
    requireValue(
      JSON.stringify(beforeStale) === JSON.stringify(afterStale) &&
        JSON.stringify(beforeStaleArtifacts) === JSON.stringify(afterStaleArtifacts) &&
        JSON.stringify(beforeStaleOperations) === JSON.stringify(afterStaleOperations) &&
        JSON.stringify(beforeStaleMessages) === JSON.stringify(afterStaleMessages) &&
        JSON.stringify(beforeStaleEvents) === JSON.stringify(afterStaleEvents) &&
        afterStale?.status === "running",
      "stale RPC mutated durable SQL",
    );

    phase = "replacement process";
    requireValue(!watchdog.timedOut, "overall deadline expired before replacement");
    const newPort = await freeLoopbackPort();
    ({ child: newChild, log: newLog } = await launch(localBinary, newPort, startToken, (child) => children.add(child), () => watchdog.timedOut));
    requireValue(!watchdog.timedOut, "overall deadline expired before replacement start");
    await start(newPort, startToken, bridgeBase, newToken, newIdentity);
    const deadline = Date.now() + RUN_MS;
    let completed = await db.select().from(runs).where(eq(runs.id, oldIdentity.runId)).get();
    while (completed?.status !== "completed" && Date.now() < deadline) {
      if (newChild.exitCode !== null) throw new Error(`replacement process exited (${newChild.exitCode}): ${newLog.value}`);
      await Bun.sleep(100);
      completed = await db.select().from(runs).where(eq(runs.id, oldIdentity.runId)).get();
    }
    requireValue(completed?.status === "completed", `replacement did not finish: ${newLog.value}`);
    await withTimeout(terminalAcknowledged.promise, "replacement complete-run acknowledgement", PHASE_MS);
    const finalArtifacts = await db.select().from(artifacts).where(eq(artifacts.runId, oldIdentity.runId));
    const finalOperations = await db.select().from(toolOperations).where(eq(toolOperations.runId, oldIdentity.runId));
    const finalMessages = await db.select().from(messages).where(eq(messages.threadId, threadId));
    const finalEvents = await db.select().from(runEvents).where(eq(runEvents.runId, oldIdentity.runId));
    const toolAttempts = trace.filter((item) => item.path === agentControlRpcPath("tool-execute") && item.status === 200);
    const checkpointLoads = trace.filter((item) => item.path === agentControlRpcPath("engine-checkpoint-load"));
    const replacementCheckpointSaves = trace.filter((item) => item.path === agentControlRpcPath("engine-checkpoint-save") && item.identity === newIdentity.serviceId && item.status === 200);
    const finalizations = trace.filter((item) => item.path === agentControlRpcPath("complete-run") && item.status === 200);
    requireValue(toolAttempts.length === 2 && toolAttempts[0]?.body.idempotencyKey === operationKey && toolAttempts[1]?.body.idempotencyKey === operationKey && toolAttempts[1]?.identity === newIdentity.serviceId, "replacement did not retry the same operation key exactly once");
    requireValue(checkpointLoads.some((item) => item.identity === newIdentity.serviceId && item.status === 200), "replacement did not load persisted checkpoint");
    requireValue(replacementCheckpointSaves.some((item) => object(item.body.checkpoint, "replacement checkpoint").loop_id === checkpoint.loop_id), "replacement checkpoint did not preserve the engine loop ID");
    requireValue(finalArtifacts.length === 1 && finalOperations.length === 1 && finalOperations[0]?.status === "completed" && finalOperations[0].operationKey === operationKey, "replacement duplicated the artifact or operation");
    requireValue(Number(modelInputs.length) === 2, "model call count drifted from two");
    const resumedMessages = modelInputs[1]?.messages;
    requireValue(Array.isArray(resumedMessages) && resumedMessages.some((item) => object(item, "resumed model message").tool_calls && JSON.stringify(item).includes("call-recovery-1")) && resumedMessages.some((item) => object(item, "resumed model message").role === "tool" && JSON.stringify(item).includes("call-recovery-1")), "resumed model input lacks correlated tool transcript");
    const usage = object(JSON.parse(completed.usage), "committed usage");
    requireValue(usage.inputTokens === 24 && usage.outputTokens === 8 && usage.cacheReadTokens === 3, "cumulative usage mismatch");
    requireValue(completed.serviceId === newIdentity.serviceId && completed.leaseVersion === 8 && completed.engineCheckpoint === null && completed.completionKey, "replacement did not atomically complete and clear checkpoint");
    requireValue(finalizations.length === 1 && finalizations[0]?.identity === newIdentity.serviceId, "terminal commit was not owned solely by replacement");
    requireValue(finalMessages.length === 4 && finalMessages.some((item) => item.role === "assistant" && item.content === "recovered answer") && finalMessages.some((item) => item.role === "tool" && item.toolCallId === "call-recovery-1"), "durable terminal transcript has missing or duplicate messages");
    requireValue(finalEvents.filter((item) => item.type === "completed").length === 1, "expected one durable terminal event");
    requireValue(!watchdog.timedOut, "overall deadline expired before final proof");
    succeeded = true;
    result = {
      ok: true, proof: "real Worker handlers, SQLite migrations, ToolExecutor, compiled Rust process restart",
      limitation: "Local bridge substitutes production proxy-token verification and RUN_NOTIFIER is a local stub; Accounts, Container/image, queue, SSE delivery, and live deployment are untested.",
      binarySHA256, checkpoint: { graph: checkpoint.graph_id, node: checkpoint.current_node, loopId: checkpoint.loop_id },
      tool: { attempts: toolAttempts.length, operationKey, completedOperations: finalOperations.length, artifacts: finalArtifacts.length },
      modelCalls: modelInputs.length, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cacheReadTokens },
      terminal: { status: completed.status, leaseVersion: completed.leaseVersion, messages: finalMessages.length, completedEvents: 1, checkpointCleared: true },
      staleRpcStatuses: staleBodies.map(([endpoint]) => ({ endpoint, status: 409 })),
    };
  } catch (error) {
    primaryFailure = new Error(`agent Worker recovery proof failed in ${phase}; context=${context}; oldLogs=${oldLog.value.slice(-3000)}; newLogs=${newLog.value.slice(-3000)}; cause=${error instanceof Error ? error.message : String(error)}`);
  } finally {
    releaseOldAcknowledgement.resolve();
    const cleanupFailures: string[] = [];
    try {
      await watchdog.abort();
    } catch (error) {
      cleanupFailures.push(String(error));
    }
    try {
      dbBinding?.close();
    } catch (error) {
      cleanupFailures.push(`SQLite close: ${String(error)}`);
    }
    if (cleanupFailures.length > 0) {
      cleanupFailure = new Error(`context=${context}; cleanup=${cleanupFailures.join("; ")}`);
    }
    if (succeeded && !watchdog.timedOut && !cleanupFailure) {
      try {
        await rm(context, { recursive: true, force: true });
      } catch (error) {
        cleanupFailure = new Error(`own context cleanup failed; context=${context}; cause=${String(error)}`);
      }
    }
  }
  if (primaryFailure && cleanupFailure) throw new Error(`${primaryFailure.message}; ${cleanupFailure.message}`);
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
  requireValue(result, "proof finished without result");
  return result;
}

if (import.meta.main) {
  try {
    const result = await proveAgentWorkerRecovery(parseArgs(Bun.argv.slice(2)));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
