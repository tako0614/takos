import { test } from "bun:test";
import { assertEquals } from "@std/assert";
import { RolloutService, type RolloutState } from "../rollout.ts";
import type { Env } from "../../../../shared/types/index.ts";

/**
 * Regression test for the advanceStage double-advance race.
 *
 * advanceStage performs a read-modify-write (loadState -> compute next stage
 * -> persist). Without a cross-isolate guard, a user-triggered advanceStage
 * racing with the alarm-driven auto-promote advanceStage could both read the
 * same currentStageIndex and each advance by one, skipping a stage.
 *
 * Correctness is enforced by the optimistic-concurrency compare-and-swap in
 * saveState: the persisted write only lands if the stored rolloutState still
 * matches the version the writer read. The mock DB below models that CAS via
 * the monotonic stateVersion so it exercises the REAL cross-isolate guard, not
 * just the in-isolate latency mutex (which a per-isolate Map cannot provide
 * across replicas in production).
 */

const BUNDLE_ID = "bundle-1";
const DEPLOYMENT_ID = "deploy-canary";
const SERVICE_ID = "svc-1";
const HOSTNAME = "app.example.test";

interface MockStore {
  rolloutState: string;
}

type MockQueryChain = {
  from(): MockQueryChain;
  where(): MockQueryChain | Promise<unknown>;
  set(values: Record<string, unknown>): MockQueryChain;
  values(): MockQueryChain;
  get(): Promise<unknown>;
  onConflictDoNothing(): Promise<unknown>;
  then(resolve: (v: unknown) => unknown): Promise<unknown>;
};

/**
 * Minimal drizzle-like DB. getDb() returns objects that already expose
 * select/insert/update/delete as-is, so this stub is used directly.
 *
 * Reads of bundleDeployments.rolloutState return the current store value;
 * updates that set rolloutState write it back. All other selects resolve to a
 * benign deployment row, and non-rolloutState updates are no-ops. An injected
 * delay on the bundleDeployments read widens the race window so an unserialized
 * implementation would deterministically double-advance.
 */
function createMockDb(store: MockStore, readDelayMs: number) {
  const makeChain = (terminalGet: () => Promise<unknown>): MockQueryChain => {
    const chain: MockQueryChain = {
      from: () => chain,
      where: () => chain,
      set: () => chain,
      values: () => chain,
      get: terminalGet,
      onConflictDoNothing: () => Promise.resolve({ meta: { changes: 0 } }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve),
    };
    return chain;
  };

  // getDb() passes through objects exposing select/insert/update/delete; the
  // unused insert/delete keep this object on the drizzle-like fast path so it
  // is not re-wrapped as a raw D1 binding.
  const noop = () => {
    const chain: MockQueryChain = {
      values: () => chain,
      set: () => chain,
      where: () => Promise.resolve(undefined),
      from: () => chain,
      get: () => Promise.resolve(undefined),
      onConflictDoNothing: () => Promise.resolve({ meta: { changes: 0 } }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve),
    };
    return chain;
  };

  return {
    insert: noop,
    delete: noop,
    select: (fields?: Record<string, unknown>) => {
      const selectsRolloutState = !!fields && "rolloutState" in fields;
      // Snapshot the stored value when the query is issued, then model the DB
      // round-trip latency. This mirrors a real read: a concurrent unserialized
      // advance issues its read against the same pre-write snapshot.
      const snapshot = store.rolloutState;
      return makeChain(async () => {
        if (selectsRolloutState) {
          if (readDelayMs > 0) {
            await new Promise((r) => setTimeout(r, readDelayMs));
          }
          return { rolloutState: snapshot };
        }
        // deployment / active deployment lookups
        return {
          id: "deploy-active",
          artifactRef: "artifact://active",
        };
      });
    },
    update: (table: unknown) => {
      // Capture set() payload so rolloutState writes hit the store.
      let pending: Record<string, unknown> | undefined;
      const chain: MockQueryChain = {
        set: (values: Record<string, unknown>) => {
          pending = values;
          return chain;
        },
        values: () => chain,
        from: () => chain,
        get: () => Promise.resolve(undefined),
        onConflictDoNothing: () => Promise.resolve({ meta: { changes: 0 } }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(undefined).then(resolve),
        where: () => {
          if (pending && typeof pending.rolloutState === "string") {
            // Model the compare-and-swap: saveState bumps stateVersion
            // monotonically, so a write is only accepted if it is based on the
            // currently-stored version (incoming === stored + 1). A racing
            // writer that read the same prior version computes a stale version
            // and is rejected (0 rows changed), exactly like the SQL
            // `UPDATE ... WHERE rollout_state = <prior>` guard.
            const incoming = JSON.parse(pending.rolloutState as string) as {
              stateVersion?: number;
            };
            const stored = JSON.parse(store.rolloutState) as {
              stateVersion?: number;
            };
            const incomingVersion = incoming.stateVersion ?? 0;
            const storedVersion = stored.stateVersion ?? 0;
            if (incomingVersion === storedVersion + 1) {
              store.rolloutState = pending.rolloutState as string;
              return Promise.resolve({ meta: { changes: 1 } });
            }
            return Promise.resolve({ meta: { changes: 0 } });
          }
          return Promise.resolve({ meta: { changes: 0 } });
        },
      };
      void table;
      return chain;
    },
  };
}

function makeService(store: MockStore, readDelayMs: number): RolloutService {
  const env = {
    DB: createMockDb(store, readDelayMs),
    // Short-circuits upsertHostnameRouting via the routing-store fast path so
    // the test does not need a KV / DO routing backend.
    ROUTING_STORE: {
      putRecord: () => Promise.resolve(),
    },
    ROUTING_DO: {
      idFromName: () => ({}),
      get: () => ({
        fetch: () => Promise.resolve(new Response("ok")),
      }),
    },
    // No ROLLOUT_HEALTH_KV: skip health check path.
  } as unknown as Env;
  return new RolloutService(env);
}

function initialState(): RolloutState {
  return {
    status: "in_progress",
    currentStageIndex: 0,
    stages: [
      { weight: 1, pauseMinutes: 0 },
      { weight: 25, pauseMinutes: 0 },
      { weight: 50, pauseMinutes: 0 },
      { weight: 100, pauseMinutes: 0 },
    ],
    healthCheck: null,
    autoPromote: false,
    stageEnteredAt: new Date().toISOString(),
    deploymentId: DEPLOYMENT_ID,
    serviceId: SERVICE_ID,
  };
}

test("concurrent advanceStage does not double-advance (stays serialized)", async () => {
  const store: MockStore = {
    rolloutState: JSON.stringify(initialState()),
  };
  const service = makeService(store, 10);

  // Fire two concurrent advances (e.g. user action + alarm auto-promote).
  const [a, b] = await Promise.all([
    service.advanceStage(BUNDLE_ID, HOSTNAME),
    service.advanceStage(BUNDLE_ID, HOSTNAME),
  ]);

  const indexes = [a.currentStageIndex, b.currentStageIndex].sort();
  // Serialized: one advances 0->1, the other 1->2. Without the lock both would
  // read index 0 and land on 1 (a skipped, double advance to the same stage).
  assertEquals(indexes, [1, 2]);

  const persisted = JSON.parse(store.rolloutState) as RolloutState;
  assertEquals(persisted.currentStageIndex, 2);
  assertEquals(persisted.status, "in_progress");
});

test("sequential advanceStage advances one stage at a time", async () => {
  const store: MockStore = {
    rolloutState: JSON.stringify(initialState()),
  };
  const service = makeService(store, 0);

  const first = await service.advanceStage(BUNDLE_ID, HOSTNAME);
  assertEquals(first.currentStageIndex, 1);

  const second = await service.advanceStage(BUNDLE_ID, HOSTNAME);
  assertEquals(second.currentStageIndex, 2);

  const persisted = JSON.parse(store.rolloutState) as RolloutState;
  assertEquals(persisted.currentStageIndex, 2);
});
