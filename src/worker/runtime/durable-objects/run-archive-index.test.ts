import { expect, test } from "bun:test";
import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  archiveNodeKey,
  emptyArchiveRoot,
  hashArchiveJSON,
  parseArchiveDescriptor,
  parseArchiveInsertPlan,
  parseArchiveRoot,
  prepareArchiveInsert,
  queryArchive,
  stageArchiveInsert,
  type ArchiveDescriptor,
  type ArchiveRoot,
} from "./run-archive-index.ts";

const SHA = "a".repeat(64);

function descriptor(firstEventId: number, lastEventId = firstEventId, segmentIndex = firstEventId): ArchiveDescriptor {
  return { key: `runs/one/segments/${String(segmentIndex).padStart(6, "0")}.jsonl.gz`,
    segmentIndex, firstEventId, lastEventId,
    count: 1, sha256: SHA, bytes: 32 };
}

function storageHarness() {
  const values = new Map<string, unknown>();
  let gets = 0;
  let puts = 0;
  let failPutAt = Infinity;
  let failReadbackKey: string | null = null;
  const storage = {
    async get(key: string) {
      gets++;
      if (failReadbackKey === key && values.has(key)) throw new Error("injected readback failure");
      return values.get(key);
    },
    async put(key: string, value: unknown) {
      puts++;
      if (puts === failPutAt) throw new Error("injected write failure");
      values.set(key, value);
    },
    async list() { throw new Error("full storage list forbidden"); },
  } as unknown as DurableObjectStorageBinding;
  return { storage, values, counters: () => ({ gets, puts }), resetGets: () => { gets = 0; },
    failSecondPut: () => { failPutAt = puts + 2; },
    failReadback: (key: string) => { failReadbackKey = key; } };
}

async function insert(h: ReturnType<typeof storageHarness>, root: ArchiveRoot, d: ArchiveDescriptor): Promise<ArchiveRoot> {
  const plan = await prepareArchiveInsert(h.storage, root, d);
  await stageArchiveInsert(h.storage, plan);
  return plan.root;
}

test("sparse event IDs, gaps, out-of-order insertion and six-digit rollover", async () => {
  const h = storageHarness();
  let root = emptyArchiveRoot();
  const descriptors = [descriptor(9_999_999, 10_000_000, 1_000_001), descriptor(2, 5, 1),
    descriptor(900, 902, 999_999), descriptor(7, 8, 2), descriptor(100, 101, 17)];
  for (const d of descriptors) root = await insert(h, root, d);
  expect((await queryArchive(h.storage, root, 0, 512)).descriptors.map((d) => d.firstEventId))
    .toEqual([2, 7, 100, 900, 9_999_999]);
  expect((await queryArchive(h.storage, root, 5, 2))).toEqual({
    descriptors: [descriptors[3], descriptors[4]], hasMore: true,
  });
  expect(await queryArchive(h.storage, root, 10_000_000, 2)).toEqual({ descriptors: [], hasMore: false });
  expect(root.entries).toBe(5);
});

test("exact duplicate is inert; metadata conflict and all overlapping ranges fail", async () => {
  const h = storageHarness();
  const a = descriptor(100, 199);
  const root = await insert(h, emptyArchiveRoot(), a);
  const duplicate = await prepareArchiveInsert(h.storage, root, a);
  expect(duplicate).toMatchObject({ root, duplicate: true, writes: [], retired: [] });
  await stageArchiveInsert(h.storage, duplicate);
  await expect(prepareArchiveInsert(h.storage, root, { ...a, bytes: 33 })).rejects.toThrow(/overlap/);
  for (const d of [descriptor(99, 100, 2), descriptor(150, 151, 3), descriptor(199, 201, 4)]) {
    await expect(prepareArchiveInsert(h.storage, root, d)).rejects.toThrow(/overlap/);
  }
});

test("old root survives partial staging writes and failed readback", async () => {
  const h = storageHarness();
  let root = emptyArchiveRoot();
  for (let i = 1; i <= 32; i++) root = await insert(h, root, descriptor(i * 10));
  const before = (await queryArchive(h.storage, root, 0, 512)).descriptors;
  const plan = await prepareArchiveInsert(h.storage, root, descriptor(400));
  expect(plan.writes.length).toBeGreaterThan(1);
  h.failSecondPut();
  await expect(stageArchiveInsert(h.storage, plan)).rejects.toThrow(/injected write failure/);
  expect(h.values.has(archiveNodeKey(plan.writes[0]!.hash))).toBe(true);
  expect((await queryArchive(h.storage, root, 0, 512)).descriptors).toEqual(before);

  const next = storageHarness();
  const plan2 = await prepareArchiveInsert(next.storage, emptyArchiveRoot(), descriptor(1));
  next.failReadback(archiveNodeKey(plan2.root.hash!));
  await expect(stageArchiveInsert(next.storage, plan2)).rejects.toThrow(/injected readback failure/);
  expect(await queryArchive(next.storage, emptyArchiveRoot(), 0, 1)).toEqual({ descriptors: [], hasMore: false });
});

test("node hashes, canonical bytes and child metadata are checked on query paths", async () => {
  const h = storageHarness();
  const root = await insert(h, emptyArchiveRoot(), descriptor(1));
  h.values.set(archiveNodeKey(root.hash!), JSON.stringify({ v: 1, t: "leaf", entries: [descriptor(2)] }));
  await expect(queryArchive(h.storage, root, 0, 1)).rejects.toThrow(/hash or metadata/);

  const h2 = storageHarness();
  let branchRoot = emptyArchiveRoot();
  for (let i = 1; i <= 33; i++) branchRoot = await insert(h2, branchRoot, descriptor(i * 10));
  const branch = JSON.parse(h2.values.get(archiveNodeKey(branchRoot.hash!)) as string);
  branch.children[0].entries++;
  const forgedJson = JSON.stringify(branch);
  const forgedHash = await hashArchiveJSON(forgedJson);
  const forgedRoot = { ...branchRoot, hash: forgedHash, entries: branchRoot.entries + 1 };
  h2.values.set(archiveNodeKey(forgedHash), forgedJson);
  await expect(queryArchive(h2.storage, forgedRoot, 0, 1)).rejects.toThrow(/node hash or metadata/);
});

test("out-of-order insert routes across branch gaps and rejects sibling overlap", async () => {
  const h = storageHarness();
  let root = emptyArchiveRoot();
  for (let i = 1; i <= 64; i++) root = await insert(h, root, descriptor(i * 100));
  expect(root.height).toBe(2);
  const oldRoot = root;
  const inGap = descriptor(3_550, 3_560, 1_000_002);
  root = await insert(h, root, inGap);
  const around = await queryArchive(h.storage, root, 3_500, 3);
  expect(around.descriptors.map((d) => d.firstEventId)).toEqual([3_550, 3_600, 3_700]);
  expect((await queryArchive(h.storage, oldRoot, 3_500, 1)).descriptors[0]?.firstEventId).toBe(3_600);
  await expect(prepareArchiveInsert(h.storage, root, descriptor(3_560, 3_600, 1_000_003)))
    .rejects.toThrow(/overlap|branch order/);
});

test("strict parsers and deterministic journal plan reject malformed bounds or staging", async () => {
  expect(() => parseArchiveDescriptor({ ...descriptor(1), count: 2 })).toThrow();
  expect(() => parseArchiveDescriptor({ ...descriptor(1), key: "non-ascii-あ" })).toThrow();
  expect(() => parseArchiveRoot({ ...emptyArchiveRoot(), entries: 1 })).toThrow();
  const h = storageHarness();
  const plan = await prepareArchiveInsert(h.storage, emptyArchiveRoot(), descriptor(1));
  expect(parseArchiveInsertPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  expect(await prepareArchiveInsert(h.storage, emptyArchiveRoot(), descriptor(1))).toEqual(plan);
  expect(() => parseArchiveInsertPlan({ ...plan, retired: Array(17).fill(SHA) })).toThrow();
  await expect(stageArchiveInsert(h.storage, { ...plan, writes: [{ ...plan.writes[0]!, hash: SHA }] }))
    .rejects.toThrow(/insert plan root|plan differs|staged hash/);
  expect(h.values.size).toBe(0);
  h.values.set(archiveNodeKey(plan.root.hash!), "different bytes");
  await expect(stageArchiveInsert(h.storage, plan)).rejects.toThrow(/immutable node collision/);
  h.values.delete(archiveNodeKey(plan.root.hash!));
  await stageArchiveInsert(h.storage, plan);
  const stagedCount = h.values.size;
  await stageArchiveInsert(h.storage, plan);
  expect(h.values.size).toBe(stagedCount);
});

test("10,000 descriptors remain bounded on cold query and insert", async () => {
  const h = storageHarness();
  let root = emptyArchiveRoot();
  for (let i = 1; i <= 10_000; i++) root = await insert(h, root, descriptor(i * 10));
  expect(root.entries).toBe(10_000);
  expect(root.height).toBeGreaterThan(2);
  h.resetGets();
  const page = await queryArchive(h.storage, root, 99_980, 1);
  expect(page.descriptors.map((d) => d.firstEventId)).toEqual([99_990]);
  expect(page.hasMore).toBe(true);
  expect(h.counters().gets).toBeLessThanOrEqual(root.height + 2);
  h.resetGets();
  const plan = await prepareArchiveInsert(h.storage, root, descriptor(100_010));
  expect(h.counters().gets).toBeLessThanOrEqual(root.height);
  expect(plan.writes.length).toBeLessThanOrEqual(root.height * 2 + 1);
  expect(plan.writes.every((w) => new TextEncoder().encode(w.json).byteLength <= 32 * 1024)).toBe(true);
}, 120_000);
