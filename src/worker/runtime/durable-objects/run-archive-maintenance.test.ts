import { expect, test } from "bun:test";
import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  archiveNodeKey,
  hashArchiveJSON,
  prepareArchiveInsert,
  queryArchive,
  stageArchiveInsert,
  type ArchiveDescriptor,
} from "./run-archive-index.ts";
import {
  archiveRetiredKey,
  collectRunArchiveGarbage,
  MAX_ARCHIVE_GC_RECORDS,
  newRunArchiveState,
  parseRunArchiveState,
  prepareArchiveStage,
  stageArchiveRetirement,
  type RunArchiveState,
} from "./run-archive-maintenance.ts";

const SHA = "a".repeat(64);

function descriptor(n: number): ArchiveDescriptor {
  return { key: `runs/one/segments/${String(1_000_000 + n)}.jsonl.gz`,
    segmentIndex: 1_000_000 + n, firstEventId: n * 10,
    lastEventId: n * 10 + 2, count: 3, sha256: SHA, bytes: 64 };
}

function harness() {
  const values = new Map<string, unknown>();
  const deletes: string[] = [];
  let puts = 0;
  let throwDeleteAfter: string | null = null;
  let throwDeleteBefore: string | null = null;
  const storage = {
    async get(key: string) { return values.get(key); },
    async put(key: string, value: unknown) { puts++; values.set(key, value); },
    async delete(key: string) {
      if (throwDeleteBefore === key) {
        throwDeleteBefore = null;
        throw new Error("injected delete-before failure");
      }
      deletes.push(key);
      const existed = values.delete(key);
      if (throwDeleteAfter === key) {
        throwDeleteAfter = null;
        throw new Error("injected delete-after failure");
      }
      return existed;
    },
    async list() { throw new Error("full storage list forbidden"); },
  } as unknown as DurableObjectStorageBinding;
  let authoritative: RunArchiveState = parseRunArchiveState({ ...newRunArchiveState(), phase: "ready", build: null });
  const head = () => structuredClone(authoritative);
  const commit = async (next: RunArchiveState) => {
    authoritative = parseRunArchiveState(structuredClone(next));
  };
  const setHead = (next: RunArchiveState) => {
    authoritative = parseRunArchiveState(structuredClone(next));
  };
  return { storage, values, deletes, head, commit, setHead,
    puts: () => puts,
    failDeleteAfter: (key: string) => { throwDeleteAfter = key; },
    failDeleteBefore: (key: string) => { throwDeleteBefore = key; } };
}

async function publish(h: ReturnType<typeof harness>, item: ArchiveDescriptor) {
  const before = h.head();
  const plan = await prepareArchiveInsert(h.storage, before.root, item);
  const stage = await prepareArchiveStage(before, "flush", plan);
  const putsBeforeJournal = h.puts();
  await h.commit({ ...before, stage });
  expect(h.puts()).toBe(putsBeforeJournal);
  await stageArchiveInsert(h.storage, stage.plan);
  await stageArchiveRetirement(h.storage, stage);
  const journaled = h.head();
  await h.commit({ ...journaled, root: plan.root, stage: null,
    gcTopHash: stage.gc?.hash ?? journaled.gcTopHash,
    gcRecords: journaled.gcRecords + (stage.gc ? 1 : 0) });
  return { plan, stage };
}

test("out-of-order branch splits, committed retirement and GC preserve every live child", async () => {
  const h = harness();
  const order = Array.from({ length: 301 }, (_, i) => (i * 73) % 301 + 1);
  for (const n of order) {
    await publish(h, descriptor(n));
    await collectRunArchiveGarbage(h.storage, h.head(), h.commit);
    expect(h.head().gcRecords).toBe(0);
    expect(h.head().gcCleanupHash).toBeNull();
  }
  const final = h.head();
  expect(final.root.height).toBeGreaterThan(1);
  expect(final.root.entries).toBe(301);
  const page = await queryArchive(h.storage, final.root, 0, 512);
  expect(page.hasMore).toBe(false);
  expect(page.descriptors).toEqual(Array.from({ length: 301 }, (_, i) => descriptor(i + 1)));
  expect(h.values.has(archiveNodeKey(final.root.hash!))).toBe(true);
  expect(h.deletes.some((key) => key.startsWith("run-archive-v3/nodes/"))).toBe(true);
}, 30_000);

test("delete succeeds then throws: committed root remains readable and retry is idempotent", async () => {
  const h = harness();
  await publish(h, descriptor(1));
  await publish(h, descriptor(2));
  const before = h.head();
  const retired = JSON.parse(h.values.get(archiveRetiredKey(before.gcTopHash!)) as string);
  const nodeKey = archiveNodeKey(retired.nodes[0]);
  h.failDeleteAfter(nodeKey);
  await expect(collectRunArchiveGarbage(h.storage, h.head(), h.commit))
    .rejects.toThrow(/injected delete-after failure/);
  expect(h.head()).toEqual(before);
  expect((await queryArchive(h.storage, before.root, 0, 10)).descriptors).toEqual([descriptor(1), descriptor(2)]);
  await collectRunArchiveGarbage(h.storage, h.head(), h.commit);
  expect(h.head().gcRecords).toBe(0);
});

test("head advance failures before and after commit recover from authoritative clone", async () => {
  for (const failAfterCommit of [false, true]) {
    const h = harness();
    await publish(h, descriptor(1));
    await publish(h, descriptor(2));
    let once = true;
    const ambiguousCommit = async (next: RunArchiveState) => {
      if (once) {
        once = false;
        if (failAfterCommit) await h.commit(next);
        throw new Error("injected head advance failure");
      }
      await h.commit(next);
    };
    await expect(collectRunArchiveGarbage(h.storage, h.head(), ambiguousCommit))
      .rejects.toThrow(/injected head advance failure/);
    const reloaded = parseRunArchiveState(h.head());
    expect((await queryArchive(h.storage, reloaded.root, 0, 10)).descriptors)
      .toEqual([descriptor(1), descriptor(2)]);
    for (let i = 0; i < 3 && (h.head().gcRecords || h.head().gcCleanupHash); i++) {
      await collectRunArchiveGarbage(h.storage, h.head(), h.commit);
    }
    expect(h.head().gcRecords).toBe(0);
    expect(h.head().gcCleanupHash).toBeNull();
  }
});

test("retired-record deletion and cleanup-head failures retain or finish the witness", async () => {
  for (const failClearHead of [false, true]) {
    const h = harness();
    await publish(h, descriptor(1));
    await publish(h, descriptor(2));
    const top = h.head().gcTopHash!;
    if (!failClearHead) h.failDeleteBefore(archiveRetiredKey(top));
    let commits = 0;
    const clearFailingCommit = async (next: RunArchiveState) => {
      commits++;
      if (failClearHead && commits === 2) throw new Error("injected clear-head failure");
      await h.commit(next);
    };
    await expect(collectRunArchiveGarbage(h.storage, h.head(), clearFailingCommit))
      .rejects.toThrow(/injected (delete-before|clear-head) failure/);
    const reloaded = parseRunArchiveState(h.head());
    expect(reloaded.gcCleanupHash).toBe(top);
    expect(reloaded.gcRecords).toBe(0);
    for (let i = 0; i < 3 && (h.head().gcCleanupHash || h.head().gcRecords); i++) {
      await collectRunArchiveGarbage(h.storage, h.head(), h.commit);
    }
    expect(h.head().gcRecords).toBe(0);
    expect(h.head().gcCleanupHash).toBeNull();
  }
});

test("staged plan blocks GC; missing, digest-bad and malformed witnesses delete no nodes", async () => {
  const h = harness();
  await publish(h, descriptor(1));
  await publish(h, descriptor(2));
  const before = h.head();
  const plan = await prepareArchiveInsert(h.storage, before.root, descriptor(3));
  const stage = await prepareArchiveStage(before, "flush", plan);
  await collectRunArchiveGarbage(h.storage, { ...before, stage }, h.commit);
  expect(h.deletes).toEqual([]);
  const key = archiveRetiredKey(before.gcTopHash!);
  const goodRecord = h.values.get(key);
  h.values.delete(key);
  await expect(collectRunArchiveGarbage(h.storage, before, h.commit)).rejects.toThrow(/gc integrity/);
  h.values.set(key, "broken");
  await expect(collectRunArchiveGarbage(h.storage, before, h.commit)).rejects.toThrow(/gc integrity/);
  const malformed = JSON.stringify({ schemaVersion: 1, nodes: [], previous: null });
  const malformedHash = await hashArchiveJSON(malformed);
  h.values.set(archiveRetiredKey(malformedHash), malformed);
  await expect(collectRunArchiveGarbage(h.storage, { ...before, gcTopHash: malformedHash }, h.commit))
    .rejects.toThrow(/retired record/);
  expect(h.deletes).toEqual([]);
  expect(h.head()).toEqual(before);
  h.values.set(key, goodRecord);
});

test("128-record backlog refuses another staged retirement without losing live root", async () => {
  const h = harness();
  await publish(h, descriptor(1));
  const plan = await prepareArchiveInsert(h.storage, h.head().root, descriptor(2));
  const full = { ...h.head(), gcTopHash: SHA, gcRecords: MAX_ARCHIVE_GC_RECORDS };
  await expect(prepareArchiveStage(full, "flush", plan)).rejects.toThrow(/capacity exhausted/);
  expect((await queryArchive(h.storage, h.head().root, 0, 10)).descriptors).toEqual([descriptor(1)]);
});
