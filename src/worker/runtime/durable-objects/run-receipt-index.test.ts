import { expect, test } from "bun:test";
import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  emptyReceiptRoot,
  lookupReceipt,
  prepareReceiptBootstrap,
  prepareReceiptInsert,
  parseReceiptNodeRef,
  readReceiptBootstrapProgress,
  receiptBootstrapProgressKey,
  receiptNodeKey,
  stageReceiptBootstrapBatch,
  stageReceiptInsert,
  validateReceiptBootstrapPrefix,
  validateReceiptNode,
  visitReceiptIndexClosure,
  writeReceiptBootstrapProgress,
  type ReceiptEntry,
  type ReceiptRoot,
} from "./run-receipt-index.ts";
import {
  collectReceiptGarbage,
  newReceiptIndexState,
  prepareReceiptStage,
  stageReceiptRetirement,
  type ReceiptIndexState,
} from "./run-receipt-maintenance.ts";

const digest = "a".repeat(64);

function memoryStorage() {
  const values = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string): Promise<T | undefined> { return values.get(key) as T | undefined; },
    async put(key: string, value: unknown): Promise<void> { values.set(key, value); },
    async delete(key: string): Promise<boolean> { return values.delete(key); },
  } as DurableObjectStorageBinding;
  return { values, storage };
}

async function insert(storage: DurableObjectStorageBinding, root: ReceiptRoot,
  entry: ReceiptEntry): Promise<ReceiptRoot> {
  const { plan } = await prepareReceiptInsert(storage, root, entry);
  await stageReceiptInsert(storage, plan);
  return plan.root;
}

test("exact emit and usage namespaces survive split, controls, Unicode, and authenticated lookup", async () => {
  const { storage, values } = memoryStorage();
  let root = emptyReceiptRoot();
  const literal = "A\u0001:B/雪";
  root = await insert(storage, root, { namespace: "emit", key: literal, digest, eventId: 17 });
  root = await insert(storage, root, { namespace: "usage", key: literal, digest });
  for (let i = 0; i < 70; i++) root = await insert(storage, root,
    { namespace: "emit", key: `key-${String(i).padStart(3, "0")}`, digest, eventId: i + 18 });
  expect(root.height).toBeGreaterThan(1);
  expect(root.entries).toBe(72);
  expect(await lookupReceipt(storage, root, "emit", literal)).toEqual(
    { namespace: "emit", key: literal, digest, eventId: 17 });
  expect(await lookupReceipt(storage, root, "usage", literal)).toEqual(
    { namespace: "usage", key: literal, digest });
  expect(await visitReceiptIndexClosure(storage, root)).toBe(72);
  await expect(prepareReceiptInsert(storage, root,
    { namespace: "emit", key: literal, digest, eventId: 99 })).rejects.toThrow("duplicate key");

  const key = receiptNodeKey(root.hash!);
  const bytes = values.get(key) as string;
  values.set(key, bytes.replace('"v":1', '"v":2'));
  await expect(lookupReceipt(storage, root, "emit", literal)).rejects.toThrow();
  await expect(lookupReceipt(storage, root, "usage", "outside-root")).rejects.toThrow();
});

test("bulk bootstrap preserves modern-over-v1 priority and resumes from staged nodes", async () => {
  const { storage, values } = memoryStorage();
  const source = {
    emitReceipts: [{ key: "same", digest, eventId: 3 },
      { key: "modern", digest, eventId: 4 }],
    usageReceipts: [{ requestId: "same", digest }],
    emitDedupKeys: [["same", 10], ["opaque", 11]] as [string, number][],
  };
  const prepared = await prepareReceiptBootstrap(source);
  expect(prepared.plan.sourceCount).toBe(5);
  expect(prepared.plan.root.entries).toBe(4);
  let cursor = 0;
  expect(await readReceiptBootstrapProgress(storage, prepared.plan)).toEqual(
    { cursor: 0, json: null });
  while (cursor < prepared.plan.writeHashes.length) {
    cursor = await stageReceiptBootstrapBatch(storage, source, prepared.plan, cursor, prepared);
    await writeReceiptBootstrapProgress(storage, prepared.plan, cursor);
    expect((await readReceiptBootstrapProgress(storage, prepared.plan)).cursor).toBe(cursor);
  }
  await validateReceiptBootstrapPrefix(storage, prepared, cursor);
  expect(await lookupReceipt(storage, prepared.plan.root, "emit", "same")).toEqual(
    { namespace: "emit", key: "same", digest, eventId: 3 });
  expect(await lookupReceipt(storage, prepared.plan.root, "emit", "opaque")).toEqual(
    { namespace: "emit", key: "opaque", legacyAcceptedAt: 11 });
  expect(await lookupReceipt(storage, prepared.plan.root, "usage", "same")).toEqual(
    { namespace: "usage", key: "same", digest });
  expect(await visitReceiptIndexClosure(storage, prepared.plan.root)).toBe(4);
  await expect(stageReceiptBootstrapBatch(storage, { ...source, emitDedupKeys: [] },
    prepared.plan, 0, prepared)).rejects.toThrow("source changed");
  const rootKey = receiptNodeKey(prepared.plan.root.hash!);
  await validateReceiptNode(parseReceiptNodeRef(prepared.plan.root), values.get(rootKey) as string);
  values.set(receiptBootstrapProgressKey(prepared.plan.sourceDigest), "{}");
  await expect(readReceiptBootstrapProgress(storage, prepared.plan)).rejects.toThrow();
});

test("worst-case escaped legacy keys split before any node exceeds 64 KiB", async () => {
  const { storage, values } = memoryStorage();
  const source = { emitReceipts: [], usageReceipts: [], emitDedupKeys: Array.from(
    { length: 100 }, (_, index): [string, number] =>
      [`${String(index).padStart(4, "0")}${"\u0001".repeat(508)}`, index],
  ) };
  const prepared = await prepareReceiptBootstrap(source);
  expect(prepared.plan.root.entries).toBe(100);
  expect(prepared.plan.root.height).toBeGreaterThan(1);
  let cursor = 0;
  while (cursor < prepared.writes.length) {
    cursor = await stageReceiptBootstrapBatch(storage, source, prepared.plan, cursor, prepared);
  }
  expect(await visitReceiptIndexClosure(storage, prepared.plan.root)).toBe(100);
  const encoder = new TextEncoder();
  for (const [key, value] of values) {
    if (key.startsWith("run-receipt-v1/nodes/")) {
      expect(encoder.encode(value as string).length).toBeLessThanOrEqual(64 * 1024);
      const node = JSON.parse(value as string) as { t: "leaf" | "branch";
        entries?: unknown[]; children?: unknown[] };
      if (node.t === "leaf") expect(node.entries!.length).toBeLessThanOrEqual(64);
      else expect(node.children!.length).toBeLessThanOrEqual(8);
    }
  }
});

test("bootstrap sidecar is plan-bound, prefix-authenticated, and resumes an ambiguous PUT", async () => {
  const { storage, values } = memoryStorage();
  const source = { emitReceipts: Array.from({ length: 70 }, (_, index) =>
    ({ key: `id-${String(index).padStart(3, "0")}`, digest, eventId: index + 1 })),
    usageReceipts: [], emitDedupKeys: [] };
  const prepared = await prepareReceiptBootstrap(source);
  expect(prepared.writes.length).toBeGreaterThan(1);
  const staged = await stageReceiptBootstrapBatch(storage, source, prepared.plan, 0, prepared);
  const key = receiptBootstrapProgressKey(prepared.plan.sourceDigest);
  const ambiguousStorage = { ...storage,
    async put(name: string, value: unknown) {
      await storage.put(name, value);
      if (name === key) throw new Error("lost progress PUT ACK");
    },
  } as DurableObjectStorageBinding;
  await expect(writeReceiptBootstrapProgress(ambiguousStorage, prepared.plan, staged))
    .rejects.toThrow("lost progress PUT ACK");
  expect((await readReceiptBootstrapProgress(storage, prepared.plan)).cursor).toBe(staged);
  await validateReceiptBootstrapPrefix(storage, prepared, staged);

  const original = values.get(key) as string;
  for (const changed of [
    { ...JSON.parse(original), planHash: digest },
    { ...JSON.parse(original), sourceDigest: "b".repeat(64) },
    { ...JSON.parse(original), cursor: prepared.writes.length + 1 },
  ]) {
    values.set(key, JSON.stringify(changed));
    await expect(readReceiptBootstrapProgress(storage, prepared.plan)).rejects.toThrow();
  }
  values.set(key, original);
  const first = prepared.writes[0]!;
  values.delete(receiptNodeKey(first.hash));
  await expect(validateReceiptBootstrapPrefix(storage, prepared, staged))
    .rejects.toThrow("bootstrap prefix bytes");
  await expect(lookupReceipt(storage, prepared.plan.root, "emit", source.emitReceipts[0]!.key))
    .rejects.toThrow();
});

test("an immutable node collision or altered readback never advances bootstrap progress", async () => {
  const source = { emitReceipts: [{ key: "one", digest, eventId: 1 }],
    usageReceipts: [], emitDedupKeys: [] };
  const prepared = await prepareReceiptBootstrap(source);
  const { storage, values } = memoryStorage();
  const nodeKey = receiptNodeKey(prepared.writes[0]!.hash);
  values.set(nodeKey, "unrelated immutable bytes");
  await expect(stageReceiptBootstrapBatch(storage, source, prepared.plan, 0, prepared))
    .rejects.toThrow("immutable node collision");
  expect((await readReceiptBootstrapProgress(storage, prepared.plan)).cursor).toBe(0);
  values.delete(nodeKey);
  const alteredReadback = { ...storage,
    async put(name: string, value: unknown) {
      await storage.put(name, value);
      if (name === nodeKey) values.set(name, "modified after PUT");
    },
  } as DurableObjectStorageBinding;
  await expect(stageReceiptBootstrapBatch(alteredReadback, source, prepared.plan, 0, prepared))
    .rejects.toThrow("bulk node readback");
  expect((await readReceiptBootstrapProgress(storage, prepared.plan)).cursor).toBe(0);
});

test("retirement survives a lost cleanup acknowledgement and never deletes a live node", async () => {
  const { storage, values } = memoryStorage();
  let root = emptyReceiptRoot();
  root = await insert(storage, root, { namespace: "emit", key: "a", digest, eventId: 1 });
  const { plan } = await prepareReceiptInsert(storage, root,
    { namespace: "emit", key: "b", digest, eventId: 2 });
  const current = { ...newReceiptIndexState(), root };
  const stage = await prepareReceiptStage(current, "drain", plan);
  await stageReceiptInsert(storage, plan);
  await stageReceiptRetirement(storage, stage);
  let committed: ReceiptIndexState = { ...current, root: plan.root,
    gcTopHash: stage.gc!.hash, gcRecords: 1 };
  await collectReceiptGarbage(storage, committed, async (next) => { committed = next; });
  expect(committed.gcTopHash).toBeNull();
  expect(committed.gcRecords).toBe(0);
  expect(values.has(receiptNodeKey(root.hash!))).toBe(false);
  expect(await lookupReceipt(storage, committed.root, "emit", "a")).not.toBeNull();

  // A content-addressed old leaf can become live again through a later root.
  const revived = { ...newReceiptIndexState(), root,
    gcTopHash: stage.gc!.hash, gcRecords: 1 };
  await stageReceiptInsert(storage, (await prepareReceiptInsert(storage,
    emptyReceiptRoot(), { namespace: "emit", key: "a", digest, eventId: 1 })).plan);
  await stageReceiptRetirement(storage, stage);
  let afterRevival: ReceiptIndexState = revived;
  await collectReceiptGarbage(storage, afterRevival,
    async (next) => { afterRevival = next; });
  expect(values.has(receiptNodeKey(root.hash!))).toBe(true);
  expect(await lookupReceipt(storage, afterRevival.root, "emit", "a")).not.toBeNull();
});
