import { expect, test } from "bun:test";
import type { DurableObjectStateBinding } from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import {
  digestNotifierPayload,
  loadNotifierSnapshot,
  persistNotifierSnapshot,
} from "./notifier-journal.ts";
import { emptyArchiveRoot } from "./run-archive-index.ts";
import {
  prepareReceiptBootstrap,
  receiptNodeKey,
  type ReceiptBootstrapSource,
} from "./run-receipt-index.ts";
import { newReceiptIndexState } from "./run-receipt-maintenance.ts";
import { RunNotifierDO } from "./run-notifier.ts";

const RUN_ID = "receipt-recovery-run";
const NODE_PREFIX = "run-receipt-v1/nodes/";
const BOOTSTRAP_KEYS = ["bootstrap-receipt-a", "bootstrap-receipt-b", "bootstrap-receipt-c"];

type EmitReceipt = { key: string; digest: string; eventId: number };
type UsageReceipt = { requestId: string; digest: string };
type Snapshot = {
  schemaVersion: 5;
  archive: Record<string, unknown>;
  usageLedger: Record<string, unknown>;
  receiptIndex: Record<string, unknown>;
  eventBuffer: unknown[];
  eventIdCounter: number;
  runId: string;
  r2SegmentIndex: number;
  r2SegmentBuffer: unknown[];
  r2LastFlushedSegmentIndex: number;
  usageSegmentIndex: number;
  usageSegmentBuffer: unknown[];
  usageLastFlushedSegmentIndex: number;
  emitDedupKeys: unknown[];
  flushIntents: unknown[];
  emitReceipts: EmitReceipt[];
  usageReceipts: UsageReceipt[];
  legacyPendingRunCount: number;
  legacyPendingUsageCount: number;
};

function durableObjectState(values = new Map<string, unknown>()) {
  let serial = Promise.resolve();
  let alarm: number | null = null;
  let bufferHeadPuts = 0;
  let nodePuts = 0;
  let deleteCalls = 0;
  let headFault: { target: number; afterWrite: boolean } | null = null;
  let nodeFault: { target: number; afterWrite: boolean } | null = null;
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
      const entries = typeof key === "string" ? [[key, value] as const] : Object.entries(key);
      for (const [name, entry] of entries) {
        if (name === "bufferState") {
          bufferHeadPuts++;
          if (headFault?.target === bufferHeadPuts) {
            const fault = headFault;
            headFault = null;
            if (fault.afterWrite) values.set(name, structuredClone(entry));
            throw new Error("injected bufferState put failure");
          }
        }
        if (name.startsWith(NODE_PREFIX)) {
          nodePuts++;
          if (nodeFault?.target === nodePuts) {
            const fault = nodeFault;
            nodeFault = null;
            if (fault.afterWrite) values.set(name, structuredClone(entry));
            throw new Error("injected receipt node put failure");
          }
        }
        values.set(name, structuredClone(entry));
      }
    },
    async delete(key: string | string[]): Promise<number> {
      deleteCalls++;
      let removed = 0;
      for (const item of Array.isArray(key) ? key : [key]) if (values.delete(item)) removed++;
      return removed;
    },
    async list<T>(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<Map<string, T>> {
      const matching = [...values.entries()]
        .filter(([key]) => key.startsWith(options?.prefix ?? ""))
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([key]) => !options?.cursor || key > options.cursor);
      return new Map(matching.slice(0, options?.limit ?? matching.length) as [string, T][]);
    },
    async getAlarm(): Promise<number | null> { return alarm; },
    async setAlarm(when: number | Date): Promise<void> {
      alarm = when instanceof Date ? when.getTime() : when;
    },
    async deleteAlarm(): Promise<void> { alarm = null; },
  };
  const binding = {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const operation = serial.then(callback);
      serial = operation.then(() => undefined, () => undefined);
      return operation;
    },
    getWebSockets: () => [],
    getTags: () => [],
    acceptWebSocket: () => undefined,
  };
  return {
    storage,
    binding: binding as unknown as DurableObjectStateBinding,
    values,
    armBufferHeadPutFault(target: number, afterWrite: boolean) {
      bufferHeadPuts = 0;
      headFault = { target, afterWrite };
    },
    armNodePutFault(target: number, afterWrite = false) {
      nodePuts = 0;
      nodeFault = { target, afterWrite };
    },
    clearFaults() { headFault = null; nodeFault = null; },
    bufferHeadPuts: () => bufferHeadPuts,
    deleteCalls: () => deleteCalls,
  };
}

function archive(phase: "ready" | "repair" = "ready") {
  return { phase, root: emptyArchiveRoot(), build: null, stage: null,
    gcTopHash: null, gcRecords: 0, gcCleanupHash: null,
    error: phase === "repair" ? "archive repair required" : null };
}

function usageLedger() {
  return { phase: "ready", totals: { exec_seconds: 1 }, revision: 1,
    projectedRevision: 1, build: null, error: null };
}

function emitInput(index: number, key = "accepted-emit-" + index) {
  return { runId: RUN_ID, type: "progress", data: { index }, dedup_key: key };
}

function usageInput(requestId: string, units = 1) {
  return { runId: RUN_ID, meter_type: "exec_seconds", units, request_id: requestId };
}

async function makeSnapshot(options: {
  archivePhase?: "ready" | "repair";
  emitReceipts?: EmitReceipt[];
  usageReceipts?: UsageReceipt[];
  eventIdCounter?: number;
  receiptIndex?: Record<string, unknown>;
} = {}): Promise<Snapshot> {
  const emitReceipts = options.emitReceipts ?? [];
  const eventIdCounter = options.eventIdCounter ?? 0;
  return {
    schemaVersion: 5,
    archive: archive(options.archivePhase),
    usageLedger: usageLedger(),
    receiptIndex: options.receiptIndex ?? newReceiptIndexState("ready") as unknown as Record<string, unknown>,
    eventBuffer: Array.from({ length: eventIdCounter }, (_, index) => ({
      id: index + 1, type: "progress", data: { index }, timestamp: index + 1,
    })),
    eventIdCounter,
    runId: RUN_ID,
    r2SegmentIndex: 1,
    r2SegmentBuffer: [],
    r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
    flushIntents: [],
    emitReceipts,
    usageReceipts: options.usageReceipts ?? [],
    legacyPendingRunCount: 0,
    legacyPendingUsageCount: 0,
  };
}

async function emitReceipts(count: number): Promise<EmitReceipt[]> {
  const receipts: EmitReceipt[] = [];
  for (let index = 0; index < count; index++) {
    const input = emitInput(index);
    receipts.push({ key: input.dedup_key,
      digest: await digestNotifierPayload({ runId: RUN_ID, type: input.type, data: input.data }),
      eventId: index + 1 });
  }
  return receipts;
}

async function makeUsageReceipt(requestId: string, units = 1): Promise<UsageReceipt> {
  return { requestId, digest: await digestNotifierPayload({ runId: RUN_ID,
    meterType: "exec_seconds", units, referenceType: null, metadata: null }) };
}

function makeEnv(): Env {
  // DB is intentionally empty: these checks qualify journal recovery only.
  return { DB: {} as Env["DB"], OIDC_ISSUER_URL: "https://owner.example",
    OIDC_OWNER_SUBJECT: "owner-subject" } as Env;
}

async function fixture(snapshot: Snapshot, values = new Map<string, unknown>()) {
  const state = durableObjectState(values);
  const env = makeEnv();
  await persistNotifierSnapshot(state.storage as never, "run", snapshot);
  const make = () => new RunNotifierDO(state.binding, env);
  const notifier = make();
  await (notifier as unknown as { initialized: Promise<void> }).initialized;
  return { state, make, notifier };
}

async function rawSnapshot(state: ReturnType<typeof durableObjectState>): Promise<Snapshot> {
  return await loadNotifierSnapshot(state.storage as never, "run") as Snapshot;
}

async function post(notifier: RunNotifierDO, path: "/emit" | "/usage", body: unknown): Promise<Response> {
  return notifier.fetch(new Request("http://internal" + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

async function indexedFixture() {
  const emit = emitInput(0, "indexed-known-emit");
  const usage = usageInput("indexed-known-usage", 2);
  const source: ReceiptBootstrapSource = {
    emitReceipts: [{ key: emit.dedup_key,
      digest: await digestNotifierPayload({ runId: RUN_ID, type: emit.type, data: emit.data }),
      eventId: 1 }],
    usageReceipts: [await makeUsageReceipt(usage.request_id, usage.units)],
    emitDedupKeys: [],
  };
  const prepared = await prepareReceiptBootstrap(source);
  const snapshot = await makeSnapshot({ eventIdCounter: 1,
    receiptIndex: { ...newReceiptIndexState("ready"), root: prepared.plan.root } as unknown as Record<string, unknown> });
  const values = new Map<string, unknown>();
  for (const write of prepared.writes) values.set(receiptNodeKey(write.hash), write.json);
  return { snapshot, values, rootHash: prepared.plan.root.hash!, emit, usage };
}

async function installTreeFixture(snapshot: Snapshot, values: Map<string, unknown>) {
  return fixture(snapshot, values);
}

test("ready receipt root switch recovers a bufferState failure before commit", async () => {
  await assertRootSwitchFailureRecovery(false);
});

test("ready receipt root switch reads back a bufferState failure after durable commit", async () => {
  await assertRootSwitchFailureRecovery(true);
});

async function assertRootSwitchFailureRecovery(afterWrite: boolean): Promise<void> {
  const receipts = await emitReceipts(32);
  const f = await fixture(await makeSnapshot());
  try {
    for (let index = 0; index < receipts.length; index++) {
      const response = await post(f.notifier, "/emit", emitInput(index));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, eventId: index + 1 });
    }
    const original = await rawSnapshot(f.state);
    expect(original.eventIdCounter).toBe(32);
    expect(original.emitReceipts).toEqual(receipts);
    const expectedEvents = structuredClone(original.eventBuffer);

    // The first head put saves the plan; the second is the root-switch commit.
    f.state.armBufferHeadPutFault(2, afterWrite);
    await f.notifier.alarm();
    expect(f.state.bufferHeadPuts()).toBe(2);
    const recovered = await rawSnapshot(f.state);
    expect(recovered.eventIdCounter).toBe(32);
    expect(recovered.eventBuffer).toEqual(expectedEvents);
    expect(recovered.usageLedger).toEqual(original.usageLedger);
    if (afterWrite) {
      expect((recovered.receiptIndex as { root: { entries: number } }).root.entries).toBe(1);
      expect(recovered.receiptIndex.stage).toBeNull();
      expect(recovered.emitReceipts).toEqual(receipts.slice(1));
    } else {
      expect((recovered.receiptIndex as { root: unknown }).root)
        .toEqual((original.receiptIndex as { root: unknown }).root);
      expect(recovered.receiptIndex.stage).not.toBeNull();
      expect(recovered.emitReceipts).toEqual(receipts);
      // Unreachable immutable nodes do not become accepted receipt authority.
      expect([...f.state.values.keys()].some((key) => key.startsWith(NODE_PREFIX))).toBe(true);
    }
    expect((recovered.receiptIndex as { phase: string }).phase).toBe("ready");

    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    const duplicate = await post(cold, "/emit", emitInput(0));
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ success: true, duplicate: true, eventId: 1 });
    const afterDuplicate = await rawSnapshot(f.state);
    expect(afterDuplicate.eventIdCounter).toBe(32);
    expect(afterDuplicate.eventBuffer).toEqual(expectedEvents);
    expect(afterDuplicate.emitReceipts).toEqual(recovered.emitReceipts);
    expect(afterDuplicate.receiptIndex).toEqual(recovered.receiptIndex);
  } finally {
    f.state.clearFaults();
  }
}

test("receipt alarm progresses while the archive is in repair", async () => {
  const receipts = await emitReceipts(32);
  const original = await makeSnapshot({ archivePhase: "repair",
    emitReceipts: receipts, eventIdCounter: 32 });
  const f = await fixture(original);
  try {
    await f.notifier.alarm();
    const after = await rawSnapshot(f.state);
    expect(after.archive).toEqual(original.archive);
    expect((after.receiptIndex as { root: { entries: number } }).root.entries).toBeGreaterThan(0);
    expect(after.emitReceipts.length).toBeLessThan(receipts.length);
    expect(after.eventIdCounter).toBe(32);
    expect(after.usageLedger).toEqual(original.usageLedger);
  } finally {
    f.state.clearFaults();
  }
});

const corruptTreeCases = [
  { name: "missing root on a keyed new emit", damage: "missing" as const, path: "/emit" as const,
    request: (_known: Awaited<ReturnType<typeof indexedFixture>>) => emitInput(99, "new-after-tree-loss") },
  { name: "corrupt root on a keyed new usage", damage: "corrupt" as const, path: "/usage" as const,
    request: (_known: Awaited<ReturnType<typeof indexedFixture>>) => usageInput("new-after-tree-loss") },
  { name: "missing root on an emit duplicate", damage: "missing" as const, path: "/emit" as const,
    request: (known: Awaited<ReturnType<typeof indexedFixture>>) => known.emit },
  { name: "corrupt root on a usage duplicate", damage: "corrupt" as const, path: "/usage" as const,
    request: (known: Awaited<ReturnType<typeof indexedFixture>>) => known.usage },
];

for (const scenario of corruptTreeCases) {
  test("corrupt receipt tree fails closed: " + scenario.name, async () => {
    const known = await indexedFixture();
    const f = await installTreeFixture(known.snapshot, known.values);
    const original = await rawSnapshot(f.state);
    const nodeKey = receiptNodeKey(known.rootHash);
    if (scenario.damage === "missing") f.state.values.delete(nodeKey);
    else f.state.values.set(nodeKey, "not a canonical receipt node");
    const deleteCalls = f.state.deleteCalls();
    let response: Response | null = null;
    let rejected: unknown;
    try {
      response = await post(f.notifier, scenario.path, scenario.request(known));
    } catch (error) {
      rejected = error;
    }
    expect(f.state.deleteCalls()).toBe(deleteCalls);
    const after = await rawSnapshot(f.state);
    expect(after.eventIdCounter).toBe(original.eventIdCounter);
    expect(after.eventBuffer).toEqual(original.eventBuffer);
    expect(after.emitReceipts).toEqual(original.emitReceipts);
    expect(after.usageReceipts).toEqual(original.usageReceipts);
    expect(after.usageLedger).toEqual(original.usageLedger);
    expect(after.receiptIndex).toEqual(original.receiptIndex);
    expect(response?.status, rejected instanceof Error ? rejected.message : undefined).toBe(503);
  });
}

test("interrupted bootstrap survives cold restart and keeps inline receipts until root switch", async () => {
  const receipts = await Promise.all(BOOTSTRAP_KEYS.map(async (key, index) => {
    const input = emitInput(index, key);
    return { key, digest: await digestNotifierPayload({ runId: RUN_ID,
      type: input.type, data: input.data }), eventId: index + 1 };
  }));
  const source: ReceiptBootstrapSource = { emitReceipts: receipts,
    usageReceipts: [], emitDedupKeys: [] };
  const original = await makeSnapshot({ emitReceipts: receipts, eventIdCounter: receipts.length,
    receiptIndex: newReceiptIndexState("building") as unknown as Record<string, unknown> });
  const f = await fixture(original);
  try {
    // First alarm persists the immutable plan without staging any nodes.
    await f.notifier.alarm();
    const planned = await rawSnapshot(f.state);
    expect((planned.receiptIndex as { phase: string }).phase).toBe("building");
    expect((planned.receiptIndex as { bootstrapStage: { cursor: number } }).bootstrapStage.cursor).toBe(0);
    expect(planned.emitReceipts).toEqual(receipts);

    // A failed first node write leaves the exact source and cursor recoverable.
    f.state.armNodePutFault(1);
    await f.notifier.alarm();
    const interrupted = await rawSnapshot(f.state);
    expect((interrupted.receiptIndex as { phase: string }).phase).toBe("building");
    expect((interrupted.receiptIndex as { bootstrapStage: { cursor: number } }).bootstrapStage.cursor).toBe(0);
    expect(interrupted.emitReceipts).toEqual(receipts);
    f.state.clearFaults();

    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    const knownInput = emitInput(0, BOOTSTRAP_KEYS[0]!);
    const duplicate = await post(cold, "/emit", knownInput);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ success: true, duplicate: true, eventId: 1 });
    const fresh = await post(cold, "/emit", emitInput(9, "fresh-during-bootstrap"));
    expect(fresh.status).toBe(503);
    const stillBuilding = await rawSnapshot(f.state);
    expect(stillBuilding.eventIdCounter).toBe(original.eventIdCounter);
    expect(stillBuilding.eventBuffer).toEqual(original.eventBuffer);
    expect(stillBuilding.emitReceipts).toEqual(receipts);

    const prepared = await prepareReceiptBootstrap(source);
    const maxResumeAlarms = Math.ceil(prepared.plan.writeHashes.length / 16) + 1;
    let ready = false;
    for (let step = 0; step < maxResumeAlarms; step++) {
      await cold.alarm();
      const next = await rawSnapshot(f.state);
      if ((next.receiptIndex as { phase: string }).phase === "ready") {
        ready = true;
        expect((next.receiptIndex as { root: { entries: number } }).root.entries).toBe(receipts.length);
        expect(next.emitReceipts).toEqual([]);
        break;
      }
      expect(next.emitReceipts).toEqual(receipts);
    }
    expect(ready).toBe(true);
    const done = await rawSnapshot(f.state);
    expect(done.eventIdCounter).toBe(original.eventIdCounter);
    expect(done.eventBuffer).toEqual(original.eventBuffer);
  } finally {
    f.state.clearFaults();
  }
});
