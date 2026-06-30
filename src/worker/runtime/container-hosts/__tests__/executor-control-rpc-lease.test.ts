import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { Env } from "../../../shared/types/index.ts";
import {
  handleAddMessage,
  handleMemoryFinalize,
  handleRunEvent,
  handleToolExecute,
  handleUpdateRunStatus,
} from "../executor-control-rpc.ts";
import { updateRunStatusImpl } from "../../../application/services/agent/runner-history.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";

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
  updateResult?: unknown;
  onUpdate?: () => void;
}): SqlDatabaseBinding {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => opts.run,
                all: async () => [],
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
            where: async () => opts.updateResult ?? {},
          };
        },
      };
    },
    insert() {
      return {
        values: () => ({
          run: async () => ({}),
          returning: () => ({ get: async () => ({}) }),
        }),
      };
    },
    delete() {
      return { where: async () => ({}) };
    },
    prepare() {
      return {};
    },
  };
  return db as unknown as SqlDatabaseBinding;
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
  ["tool-execute", handleToolExecute, {
    runId: "run_1",
    serviceId: "lease_A",
    toolCall: { id: "t1", name: "noop", arguments: {} },
  }],
  ["run-event", handleRunEvent, {
    runId: "run_1",
    serviceId: "lease_A",
    type: "progress",
    data: {},
    sequence: 1,
  }],
  ["add-message", handleAddMessage, {
    runId: "run_1",
    serviceId: "lease_A",
    threadId: "thr_1",
    message: { role: "assistant", content: "x" },
  }],
  ["memory-finalize", handleMemoryFinalize, {
    runId: "run_1",
    serviceId: "lease_A",
    claims: [],
    evidence: [],
  }],
];

for (const [name, handler, body] of SIDE_EFFECT_HANDLERS) {
  test(`${name} returns 409 when the lease was reclaimed`, async () => {
    const env = {
      DB: makeDb({
        run: {
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
