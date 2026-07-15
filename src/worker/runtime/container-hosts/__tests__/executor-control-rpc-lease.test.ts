import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { Env } from "../../../shared/types/index.ts";
import {
  handleAddMessage,
  handleRunEvent,
  handleToolExecute,
  handleUpdateRunStatus,
} from "../executor-control-rpc.ts";
import { updateRunStatusImpl } from "../../../application/services/agent/runner-history.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { dispatchControlRpc } from "../../executor-proxy-api.ts";
import {
  agentControlRpcPath,
  CONTROL_RPC_ENDPOINTS,
} from "../executor-utils.ts";
import { handleRunFail, handleRunReset } from "../executor-run-state.ts";

type CapturedStatement = {
  queryText: string;
  boundValues: unknown[];
  bind(...values: unknown[]): CapturedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{
    results: T[];
    meta: { changes: number };
  }>;
};

/**
 * Guards the run-lease fence on the run-scoped control-RPC write path.
 *
 * The run lifecycle is built on a per-run lease: stale-recovery re-enqueues a
 * run under a NEW serviceId/leaseVersion while the original (now superseded)
 * container keeps a valid proxy token for up to STALE_PROXY_TOKEN_MS. Every
 * run-scoped DB-write RPC must therefore reject a write whose token-bound
 * serviceId no longer matches the run's current lease — exactly like
 * handleHeartbeat / handleRunFail already do. A regression that dropped the
 * fence would let a zombie container flip a reclaimed run's status (corrupting
 * the ledger / billing) or keep executing side-effecting tools for it.
 */

// Minimal drizzle-like double: getDb() returns it as-is (it exposes
// select/insert/update/delete). `.from().where().get()` resolves to the single
// configured run row; `update().set().where()` resolves to a configurable
// result and records whether it was reached.
function makeDb(opts: {
  run: Record<string, unknown> | null;
  event?: { id: number } | null;
  updateResult?: unknown;
  onUpdate?: () => void;
  onInsert?: (values: Record<string, unknown>) => void;
  onBatch?: (statements: CapturedStatement[]) => void;
}): SqlDatabaseBinding {
  let event = opts.event ?? null;
  const statement = (
    queryText: string,
    boundValues: unknown[] = [],
  ): CapturedStatement => ({
    queryText,
    boundValues,
    bind(...values: unknown[]) {
      return statement(queryText, values);
    },
    async first<T>() {
      if (!queryText.includes('SELECT "engine_checkpoint"')) return null;
      if (!opts.run || opts.run.status !== "running") return null;
      return {
        engineCheckpoint: opts.run.engineCheckpoint ?? null,
      } as T;
    },
    async run<T>() {
      return { results: [] as T[], meta: { changes: 0 } };
    },
  });
  const db = {
    select(fields?: Record<string, unknown>) {
      return {
        from() {
          return {
            where() {
              return {
                get: () => {
                  if (fields && Object.keys(fields).join(",") === "id") {
                    return Promise.resolve(event);
                  }
                  if (fields && Object.keys(fields).join(",") === "sessionId") {
                    return Promise.resolve(
                      opts.run
                        ? { sessionId: opts.run.sessionId ?? null }
                        : null,
                    );
                  }
                  return Promise.resolve(opts.run);
                },
                all: () => Promise.resolve([]),
                limit: () => ({ all: () => Promise.resolve([]) }),
              };
            },
          };
        },
      };
    },
    update() {
      opts.onUpdate?.();
      return {
        set() {
          return {
            where: () => Promise.resolve(opts.updateResult ?? {}),
          };
        },
      };
    },
    insert() {
      return {
        values: (values: Record<string, unknown>) => {
          opts.onInsert?.(values);
          return {
            run: () => Promise.resolve({}),
            returning: () => ({ get: () => Promise.resolve({ id: 1 }) }),
          };
        },
      };
    },
    delete() {
      return { where: () => Promise.resolve({}) };
    },
    prepare(queryText: string) {
      return statement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      opts.onBatch?.(statements);
      const update = statements[0];
      const hasExpectedService = Boolean(
        update?.queryText.includes('"service_id" = ?'),
      );
      const hasExpectedLease = Boolean(
        update?.queryText.includes('"lease_version" = ?'),
      );
      const expectedService = hasExpectedService
        ? update?.boundValues[
            update.boundValues.length - (hasExpectedLease ? 2 : 1)
          ]
        : undefined;
      const expectedLease = hasExpectedLease
        ? update?.boundValues[update.boundValues.length - 1]
        : undefined;
      const committed = Boolean(
        opts.run?.status === "running" &&
        (!hasExpectedService || opts.run.serviceId === expectedService) &&
        (!hasExpectedLease || opts.run.leaseVersion === expectedLease),
      );
      if (committed && opts.run && update) {
        let valueIndex = 3;
        opts.run.status = update.boundValues[0];
        opts.run.completedAt = update.boundValues[1];
        opts.run.completionKey = update.boundValues[2];
        if (update.queryText.includes('"error" = ?')) {
          opts.run.error = update.boundValues[valueIndex++];
        }
        if (update.queryText.includes('"output" = ?')) {
          opts.run.output = update.boundValues[valueIndex++];
        }
        if (update.queryText.includes('"usage" = ?')) {
          opts.run.usage = update.boundValues[valueIndex++];
        }
        event = { id: 1 };
      }
      return statements.map((_item, index) => ({
        results:
          committed && index === statements.length - 1 ? [{ id: 1 }] : [],
        meta: { changes: committed ? 1 : 0 },
      }));
    },
  };
  return db as unknown as SqlDatabaseBinding;
}

function makeRunNotifier(): Env["RUN_NOTIFIER"] {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.resolve(Response.json({ success: true })),
    }),
  } as unknown as Env["RUN_NOTIFIER"];
}

test("updateRunStatusImpl rejects a stale lease without writing", async () => {
  let updateCalled = false;
  const db = makeDb({
    run: {
      status: "running",
      usage: "{}",
      output: null,
      error: null,
      serviceId: "lease_B",
      leaseVersion: 1,
    },
    onUpdate: () => {
      updateCalled = true;
    },
  });
  const result = await updateRunStatusImpl(
    db,
    "run_1",
    { inputTokens: 5, outputTokens: 5 },
    "completed",
    "stale output",
    undefined,
    { serviceId: "lease_A" },
  );
  assertEquals(result, { updated: false, leaseLost: true });
  // The zombie write must never reach the UPDATE statement.
  assertEquals(updateCalled, false);
});

test("updateRunStatusImpl accepts a write from the current lease", async () => {
  let updateCalled = false;
  const db = makeDb({
    run: {
      status: "running",
      usage: "{}",
      output: null,
      error: null,
      serviceId: "lease_A",
      leaseVersion: 1,
    },
    updateResult: { meta: { changes: 1 } },
    onUpdate: () => {
      updateCalled = true;
    },
  });
  const result = await updateRunStatusImpl(
    db,
    "run_1",
    { inputTokens: 5, outputTokens: 5 },
    "completed",
    "ok output",
    undefined,
    { serviceId: "lease_A" },
  );
  assertEquals(result, { updated: true, leaseLost: false });
  assertEquals(updateCalled, true);
});

test("updateRunStatusImpl stays lease-agnostic when no lease is supplied", async () => {
  let updateCalled = false;
  const db = makeDb({
    run: {
      status: "running",
      usage: "{}",
      output: null,
      error: null,
      serviceId: "lease_B",
      leaseVersion: 1,
    },
    updateResult: { meta: { changes: 1 } },
    onUpdate: () => {
      updateCalled = true;
    },
  });
  const result = await updateRunStatusImpl(
    db,
    "run_1",
    { inputTokens: 5, outputTokens: 5 },
    "completed",
    "ok output",
  );
  // No lease => no fence (in-process local-platform path); the write lands.
  assertEquals(result.leaseLost, false);
  assertEquals(updateCalled, true);
});

test("handleUpdateRunStatus returns 409 when the lease was reclaimed", async () => {
  const env = {
    DB: makeDb({
      run: {
        status: "running",
        usage: "{}",
        output: null,
        error: null,
        serviceId: "lease_B",
        leaseVersion: 1,
      },
    }),
  } as unknown as Env;
  const res = await handleUpdateRunStatus(
    {
      runId: "run_1",
      serviceId: "lease_A",
      status: "completed",
      usage: { inputTokens: 5, outputTokens: 5 },
      output: "stale",
    },
    env,
  );
  assertEquals(res.status, 409);
});

test("handleUpdateRunStatus succeeds for the current lease", async () => {
  const env = {
    DB: makeDb({
      run: {
        status: "running",
        usage: "{}",
        output: null,
        error: null,
        serviceId: "lease_A",
        leaseVersion: 1,
      },
      updateResult: { meta: { changes: 1 } },
    }),
    RUN_NOTIFIER: makeRunNotifier(),
  } as unknown as Env;
  const res = await handleUpdateRunStatus(
    {
      runId: "run_1",
      serviceId: "lease_A",
      status: "completed",
      usage: { inputTokens: 5, outputTokens: 5 },
      output: "ok",
    },
    env,
  );
  assertEquals(res.status, 200);
});

const SIDE_EFFECT_HANDLERS: Array<
  [
    string,
    (body: Record<string, unknown>, env: Env) => Promise<Response>,
    Record<string, unknown>,
  ]
> = [
  [
    "tool-execute",
    handleToolExecute,
    {
      runId: "run_1",
      serviceId: "lease_A",
      toolCall: { id: "t1", name: "noop", arguments: {} },
    },
  ],
  [
    "run-event",
    handleRunEvent,
    {
      runId: "run_1",
      serviceId: "lease_A",
      leaseVersion: 1,
      type: "progress",
      data: {},
      sequence: 1,
    },
  ],
  [
    "add-message",
    handleAddMessage,
    {
      runId: "run_1",
      serviceId: "lease_A",
      threadId: "thr_1",
      message: { role: "assistant", content: "x" },
    },
  ],
];

for (const [name, handler, body] of SIDE_EFFECT_HANDLERS) {
  test(`${name} returns 409 when the lease was reclaimed`, async () => {
    const env = {
      DB: makeDb({
        run: {
          status: "running",
          serviceId: "lease_B",
          leaseVersion: 1,
          accountId: "space_A",
          threadId: "thr_1",
        },
      }),
    } as unknown as Env;
    const res = await handler(body, env);
    assertEquals(res.status, 409);
  });
}

for (const [name, handler, body] of SIDE_EFFECT_HANDLERS) {
  test(`${name} returns 409 after the run was cancelled`, async () => {
    const env = {
      DB: makeDb({
        run: {
          status: "cancelled",
          serviceId: "lease_A",
          leaseVersion: 1,
          accountId: "space_A",
          threadId: "thr_1",
        },
      }),
    } as unknown as Env;
    const res = await handler(body, env);
    assertEquals(res.status, 409);
  });
}

test("handleUpdateRunStatus rejects a terminal write after cancellation", async () => {
  let updateCalled = false;
  const env = {
    DB: makeDb({
      run: {
        status: "cancelled",
        usage: "{}",
        output: null,
        error: null,
        serviceId: "lease_A",
        leaseVersion: 1,
      },
      onUpdate: () => {
        updateCalled = true;
      },
    }),
  } as unknown as Env;
  const res = await handleUpdateRunStatus(
    {
      runId: "run_1",
      serviceId: "lease_A",
      status: "completed",
      usage: { inputTokens: 5, outputTokens: 5 },
      output: "must not land",
    },
    env,
  );
  assertEquals(res.status, 409);
  assertEquals(updateCalled, false);
});

test("terminal status atomically persists event/outbox and exact retry is idempotent", async () => {
  const batches: CapturedStatement[][] = [];
  const env = {
    DB: makeDb({
      run: {
        status: "running",
        usage: "{}",
        output: null,
        error: null,
        serviceId: "lease_A",
        leaseVersion: 1,
        sessionId: "session_1",
      },
      event: null,
      onBatch: (statements) => {
        batches.push(statements);
      },
    }),
    RUN_NOTIFIER: makeRunNotifier(),
  } as unknown as Env;
  const res = await handleUpdateRunStatus(
    {
      runId: "run_1",
      serviceId: "lease_A",
      leaseVersion: 1,
      status: "failed",
      usage: { inputTokens: 5, outputTokens: 5 },
      error: "agent execution timed out",
    },
    env,
  );
  assertEquals(res.status, 200);
  const replay = await handleUpdateRunStatus(
    {
      runId: "run_1",
      serviceId: "lease_A",
      leaseVersion: 1,
      status: "failed",
      usage: { inputTokens: 5, outputTokens: 5 },
      error: "agent execution timed out",
    },
    env,
  );
  assertEquals(replay.status, 200);
  // The first call owns one atomic batch; replay observes its completion key
  // and only re-flushes the existing outbox.
  assertEquals(batches.length, 1);
  const outbox = batches[0].filter((statement) =>
    statement.queryText.includes('INSERT INTO "run_notification_outbox"'),
  );
  assertEquals(outbox.length, 1);
  const event = batches[0].find((statement) =>
    statement.queryText.includes('INSERT INTO "run_events"'),
  );
  assertEquals(Boolean(event), true);
  assertEquals(event?.boundValues[0], "error");
  assertEquals(
    String(event?.boundValues[1]).includes("terminal-status:failed"),
    true,
  );
  const data = JSON.parse(String(event?.boundValues[2])) as Record<
    string,
    unknown
  >;
  assertEquals(data.status, "failed");
  assertEquals(data.error, "agent execution timed out");
});

test("the central dispatch fence rejects a stale lease for every data RPC", async () => {
  const env = {
    DB: makeDb({
      run: {
        status: "running",
        serviceId: "lease_new",
        leaseVersion: 12,
      },
    }),
  } as unknown as Env;

  for (const endpoint of CONTROL_RPC_ENDPOINTS) {
    // Cleanup only releases the cache entry for this exact identity and is
    // intentionally lease-agnostic so stale resources can be reclaimed.
    if (endpoint.name === "tool-cleanup") continue;
    const dispatched = dispatchControlRpc(
      agentControlRpcPath(endpoint.name),
      {
        runId: "run_1",
        serviceId: "lease_old",
        leaseVersion: 11,
      },
      env,
    );
    if (!dispatched) throw new Error(`missing RPC ${endpoint.name}`);
    const response = await dispatched;
    assertEquals(
      response.status,
      409,
      `${endpoint.name} must be fenced before its handler`,
    );
  }
});

test("run-fail and run-reset surface a lease race instead of false success", async () => {
  const env = {
    DB: makeDb({
      run: {
        status: "running",
        serviceId: "lease_old",
        leaseVersion: 4,
      },
      updateResult: { meta: { changes: 0 } },
    }),
  } as unknown as Env;

  const failed = await handleRunFail(
    {
      runId: "run_1",
      serviceId: "lease_old",
      leaseVersion: 4,
      error: "boom",
    },
    env,
  );
  assertEquals(failed.status, 409);

  const reset = await handleRunReset(
    {
      runId: "run_1",
      serviceId: "lease_old",
      leaseVersion: 4,
    },
    env,
  );
  assertEquals(reset.status, 409);
});
