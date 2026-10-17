import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  emptyReceiptRoot,
  hashReceiptJSON,
  parseReceiptBulkPlan,
  parseReceiptInsertPlan,
  parseReceiptNodeRef,
  parseReceiptRoot,
  receiptNodeKey,
  receiptRefIsLive,
  validateReceiptNode,
  type ReceiptInsertPlan,
  type ReceiptBulkPlan,
  type ReceiptNodeRef,
  type ReceiptRoot,
} from "./run-receipt-index.ts";

export const MAX_RECEIPT_GC_RECORDS = 128;
const GC_PREFIX = "run-receipt-v1/retired/";
const HASH = /^[a-f0-9]{64}$/;
const MAX_GC_BYTES = 112 * 1024;

export type ReceiptStage = {
  purpose: "build" | "drain";
  plan: ReceiptInsertPlan;
  gc: { hash: string; json: string } | null;
};
export type ReceiptIndexState = {
  phase: "building" | "ready" | "repair";
  root: ReceiptRoot;
  bootstrapStage: { plan: ReceiptBulkPlan; cursor: number } | null;
  stage: ReceiptStage | null;
  gcTopHash: string | null;
  gcRecords: number;
  gcCleanupHash: string | null;
  error: string | null;
};
export type ReceiptRetiredRecord = {
  schemaVersion: 1;
  nodes: ReceiptNodeRef[];
  previous: string | null;
};

function fail(reason: string): never {
  throw new Error(`Invalid run receipt maintenance: ${reason}`);
}
function object(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("object");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))) fail("fields");
  return value;
}
function nullableHash(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || !HASH.test(raw)) fail("hash");
  return raw;
}
function integer(raw: unknown, maximum: number): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > maximum) fail("integer");
  return raw;
}
function sameRoot(left: ReceiptRoot, right: ReceiptRoot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseReceiptRetiredRecord(raw: unknown): ReceiptRetiredRecord {
  const value = object(raw, ["schemaVersion", "nodes", "previous"]);
  if (value.schemaVersion !== 1 || !Array.isArray(value.nodes) ||
    value.nodes.length < 1 || value.nodes.length > 16) fail("retired record");
  const nodes = value.nodes.map(parseReceiptNodeRef);
  if (new Set(nodes.map((node) => node.hash)).size !== nodes.length) fail("retired duplicates");
  return { schemaVersion: 1, nodes, previous: nullableHash(value.previous) };
}

export function receiptRetiredKey(recordHash: string): string {
  if (!HASH.test(recordHash)) fail("gc key");
  return GC_PREFIX + recordHash;
}

export function newReceiptIndexState(phase: "building" | "ready" = "ready"): ReceiptIndexState {
  return { phase, root: emptyReceiptRoot(), bootstrapStage: null, stage: null,
    gcTopHash: null, gcRecords: 0, gcCleanupHash: null, error: null };
}

export function parseReceiptIndexState(raw: unknown): ReceiptIndexState {
  const value = object(raw, ["phase", "root", "bootstrapStage", "stage", "gcTopHash",
    "gcRecords", "gcCleanupHash", "error"]);
  if (value.phase !== "building" && value.phase !== "ready" && value.phase !== "repair") fail("phase");
  const root = parseReceiptRoot(value.root);
  const gcTopHash = nullableHash(value.gcTopHash);
  const gcRecords = integer(value.gcRecords, MAX_RECEIPT_GC_RECORDS);
  const gcCleanupHash = nullableHash(value.gcCleanupHash);
  if ((gcTopHash === null) !== (gcRecords === 0) ||
    gcCleanupHash !== null && gcCleanupHash === gcTopHash) fail("gc frontier");
  if (value.error !== null && (typeof value.error !== "string" || !value.error ||
    value.error.length > 512)) fail("error");
  if ((value.phase === "repair") !== (value.error !== null)) fail("repair phase");
  let bootstrapStage: ReceiptIndexState["bootstrapStage"] = null;
  if (value.bootstrapStage !== null) {
    const b = object(value.bootstrapStage, ["plan", "cursor"]);
    const plan = parseReceiptBulkPlan(b.plan);
    const cursor = integer(b.cursor, plan.writeHashes.length);
    if (value.phase !== "building" || root.hash !== null || value.stage !== null ||
      gcTopHash !== null || gcCleanupHash !== null) fail("bootstrap frontier");
    bootstrapStage = { plan, cursor };
  }
  let stage: ReceiptStage | null = null;
  if (value.stage !== null) {
    const s = object(value.stage, ["purpose", "plan", "gc"]);
    if (s.purpose !== "build" && s.purpose !== "drain") fail("stage purpose");
    const plan = parseReceiptInsertPlan(s.plan);
    if (!sameRoot(plan.previousRoot, root) || gcCleanupHash !== null ||
      (s.purpose === "build") !== (value.phase === "building")) fail("stage frontier");
    let gc: ReceiptStage["gc"] = null;
    if (s.gc !== null) {
      const g = object(s.gc, ["hash", "json"]);
      const recordHash = nullableHash(g.hash);
      if (recordHash === null || typeof g.json !== "string" ||
        new TextEncoder().encode(g.json).length > MAX_GC_BYTES) fail("stage gc");
      const record = parseReceiptRetiredRecord(JSON.parse(g.json));
      if (record.previous !== gcTopHash ||
        JSON.stringify(record.nodes) !== JSON.stringify(plan.retired)) fail("stage gc frontier");
      gc = { hash: recordHash, json: g.json };
    }
    if ((plan.retired.length === 0) !== (gc === null) ||
      gc !== null && gcRecords >= MAX_RECEIPT_GC_RECORDS) fail("stage gc capacity");
    stage = { purpose: s.purpose, plan, gc };
  }
  return { phase: value.phase, root, bootstrapStage, stage, gcTopHash, gcRecords,
    gcCleanupHash, error: value.error as string | null };
}

export async function prepareReceiptStage(
  current: ReceiptIndexState, purpose: ReceiptStage["purpose"], plan: ReceiptInsertPlan,
): Promise<ReceiptStage> {
  const index = parseReceiptIndexState(current);
  const parsedPlan = parseReceiptInsertPlan(plan);
  if (index.stage || index.gcCleanupHash ||
    !sameRoot(parsedPlan.previousRoot, index.root) ||
    (purpose === "build") !== (index.phase === "building") ||
    parsedPlan.retired.length > 0 && index.gcRecords >= MAX_RECEIPT_GC_RECORDS) {
    throw new Error("Run receipt maintenance capacity exhausted; accepted receipts are retained");
  }
  const json = JSON.stringify({ schemaVersion: 1, nodes: parsedPlan.retired,
    previous: index.gcTopHash });
  return { purpose, plan: parsedPlan,
    gc: parsedPlan.retired.length ? { hash: await hashReceiptJSON(json), json } : null };
}

export async function readReceiptRetiredRecord(
  storage: DurableObjectStorageBinding, recordHash: string,
): Promise<ReceiptRetiredRecord> {
  const raw = await storage.get<unknown>(receiptRetiredKey(recordHash));
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_GC_BYTES ||
    await hashReceiptJSON(raw) !== recordHash) fail("gc integrity");
  const record = parseReceiptRetiredRecord(JSON.parse(raw));
  if (JSON.stringify(record) !== raw) fail("gc noncanonical JSON");
  return record;
}

export async function stageReceiptRetirement(
  storage: DurableObjectStorageBinding, stage: ReceiptStage,
): Promise<void> {
  if (!stage.gc) return;
  const record = parseReceiptRetiredRecord(JSON.parse(stage.gc.json));
  if (JSON.stringify(record) !== stage.gc.json ||
    await hashReceiptJSON(stage.gc.json) !== stage.gc.hash) fail("stage gc digest");
  const key = receiptRetiredKey(stage.gc.hash);
  const existing = await storage.get<unknown>(key);
  if (existing === undefined) await storage.put(key, stage.gc.json);
  else if (existing !== stage.gc.json) fail("gc collision");
  await readReceiptRetiredRecord(storage, stage.gc.hash);
}

/** One bounded record; caller serializes this with point reads and root publication. */
export async function collectReceiptGarbage(
  storage: DurableObjectStorageBinding, current: ReceiptIndexState,
  commit: (next: ReceiptIndexState) => Promise<void>,
): Promise<void> {
  let index = parseReceiptIndexState(current);
  if (index.stage) return;
  if (index.gcCleanupHash) {
    await storage.delete(receiptRetiredKey(index.gcCleanupHash));
    index = { ...index, gcCleanupHash: null };
    await commit(index);
  }
  if (!index.gcTopHash) return;
  const recordHash = index.gcTopHash;
  const record = await readReceiptRetiredRecord(storage, recordHash);
  for (const ref of record.nodes) {
    // Content addressing can reintroduce a once-retired leaf after a split.
    // A later retirement will authorize its eventual removal.
    if (await receiptRefIsLive(storage, index.root, ref)) continue;
    const key = receiptNodeKey(ref.hash);
    const present = await storage.get<unknown>(key);
    if (present !== undefined) {
      if (typeof present !== "string") fail("retired node type");
      await validateReceiptNode(ref, present);
      await storage.delete(key);
    }
  }
  index = { ...index, gcTopHash: record.previous, gcRecords: index.gcRecords - 1,
    gcCleanupHash: recordHash };
  await commit(index);
  await storage.delete(receiptRetiredKey(recordHash));
  await commit({ ...index, gcCleanupHash: null });
}
