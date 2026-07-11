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
}): SqlDatabaseBinding {
  const db = {
    select(fields?: Record<string, unknown>) {
      return {
        from() {
          return {
            where() {
              return {
                get: () => {
                  if (fields && Object.keys(fields).join(",") === "id") {
                    return Promise.resolve(opts.event ?? null);
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
    prepare() {
      return {};
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

test("terminal status persists its canonical event before returning", async () => {
  let inserted: Record<string, unknown> | null = null;
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
      updateResult: { meta: { changes: 1 } },
      onInsert: (values) => {
        inserted = values;
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
  assertEquals(inserted?.type, "error");
  assertEquals(inserted?.eventKey, "run:run_1:terminal-status:failed");
  const data = JSON.parse(String(inserted?.data)) as Record<string, unknown>;
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
