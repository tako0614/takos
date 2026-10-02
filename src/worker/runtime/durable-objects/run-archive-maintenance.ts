import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  emptyArchiveRoot,
  parseArchiveRoot,
  type ArchiveRoot,
} from "../../shared/contracts/run-archive.ts";
import {
  archiveNodeKey,
  hashArchiveJSON,
  parseArchiveInsertPlan,
  type ArchiveInsertPlan,
} from "./run-archive-index.ts";

export const MAX_ARCHIVE_GC_RECORDS = 128;
const HASH = /^[a-f0-9]{64}$/;
const GC_PREFIX = "run-archive-v3/retired/";

export type ArchiveBuild = {
  cursor: string | null;
  seenCursorHashes: string[];
  keys: string[];
  keyIndex: number;
  nextCursor: string | null;
  truncated: boolean;
  pageLoaded: boolean;
  scanned: number;
  ringWitnesses: number[];
};

export type ArchiveStage = {
  purpose: "flush" | "build";
  plan: ArchiveInsertPlan;
  gc: { hash: string; json: string } | null;
};

export type RunArchiveState = {
  phase: "building" | "ready" | "repair";
  root: ArchiveRoot;
  build: ArchiveBuild | null;
  stage: ArchiveStage | null;
  gcTopHash: string | null;
  gcRecords: number;
  gcCleanupHash: string | null;
  error: string | null;
};

type RetiredRecord = { schemaVersion: 1; nodes: string[]; previous: string | null };

function fail(field: string): never {
  throw new Error(`Invalid run archive maintenance: ${field}`);
}

function object(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("object");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))) fail("fields");
  return value;
}

function integer(raw: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0 || raw > max) fail("integer");
  return raw;
}

function nullableHash(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || !HASH.test(raw)) fail("hash");
  return raw;
}

function cursor(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 8192) fail("cursor");
  return raw;
}

function parseRetiredRecord(raw: unknown): RetiredRecord {
  const value = object(raw, ["schemaVersion", "nodes", "previous"]);
  if (value.schemaVersion !== 1 || !Array.isArray(value.nodes) ||
    value.nodes.length < 1 || value.nodes.length > 32) fail("retired record");
  const nodes = value.nodes.map((hash) => {
    const parsed = nullableHash(hash);
    if (parsed === null) fail("retired node");
    return parsed;
  });
  if (new Set(nodes).size !== nodes.length) fail("retired duplicates");
  return { schemaVersion: 1, nodes, previous: nullableHash(value.previous) };
}

export function newRunArchiveState(): RunArchiveState {
  return {
    phase: "building", root: emptyArchiveRoot(),
    build: { cursor: null, seenCursorHashes: [], keys: [], keyIndex: 0,
      nextCursor: null, truncated: false, pageLoaded: false, scanned: 0, ringWitnesses: [] },
    stage: null, gcTopHash: null, gcRecords: 0, gcCleanupHash: null, error: null,
  };
}

export function parseRunArchiveState(raw: unknown): RunArchiveState {
  const value = object(raw, ["phase", "root", "build", "stage", "gcTopHash",
    "gcRecords", "gcCleanupHash", "error"]);
  if (value.phase !== "building" && value.phase !== "ready" && value.phase !== "repair") fail("phase");
  let build: ArchiveBuild | null = null;
  if (value.build !== null) {
    const b = object(value.build, ["cursor", "seenCursorHashes", "keys", "keyIndex",
      "nextCursor", "truncated", "pageLoaded", "scanned", "ringWitnesses"]);
    if (!Array.isArray(b.ringWitnesses) || b.ringWitnesses.length > 100 ||
      b.ringWitnesses.some((id) => !Number.isSafeInteger(id) || (id as number) < 1) ||
      new Set(b.ringWitnesses).size !== b.ringWitnesses.length) fail("ring witnesses");
    if (!Array.isArray(b.seenCursorHashes) || b.seenCursorHashes.length > 32768 ||
      b.seenCursorHashes.some((hash) => typeof hash !== "string" || !HASH.test(hash)) ||
      new Set(b.seenCursorHashes).size !== b.seenCursorHashes.length) fail("build cursors");
    if (!Array.isArray(b.keys) || b.keys.length > 32 ||
      b.keys.some((key) => typeof key !== "string" || !/^[\x21-\x7e]{1,160}$/.test(key)) ||
      new Set(b.keys).size !== b.keys.length) fail("build keys");
    if (typeof b.truncated !== "boolean" || typeof b.pageLoaded !== "boolean") fail("build page");
    build = { cursor: cursor(b.cursor), seenCursorHashes: b.seenCursorHashes.slice(),
      keys: b.keys.slice(), keyIndex: integer(b.keyIndex, b.keys.length),
      nextCursor: cursor(b.nextCursor), truncated: b.truncated,
      pageLoaded: b.pageLoaded, scanned: integer(b.scanned), ringWitnesses: b.ringWitnesses.slice() };
    if ((!build.pageLoaded && (build.keys.length > 0 || build.keyIndex > 0 ||
      build.nextCursor !== null || build.truncated)) ||
      (build.pageLoaded && build.truncated && build.nextCursor === null)) fail("build page state");
  }
  if (value.phase === "ready" && build !== null || value.phase === "building" && build === null) fail("build phase");
  const root = parseArchiveRoot(value.root);
  const gcTopHash = nullableHash(value.gcTopHash);
  const gcRecords = integer(value.gcRecords, MAX_ARCHIVE_GC_RECORDS);
  const gcCleanupHash = nullableHash(value.gcCleanupHash);
  if ((gcRecords === 0) !== (gcTopHash === null) || gcCleanupHash === gcTopHash && gcTopHash !== null) fail("gc frontier");
  if (value.error !== null && (typeof value.error !== "string" ||
    !value.error || value.error.length > 512)) fail("error");
  if ((value.phase === "repair") !== (value.error !== null)) fail("repair error");
  let stage: ArchiveStage | null = null;
  if (value.stage !== null) {
    const s = object(value.stage, ["purpose", "plan", "gc"]);
    if (s.purpose !== "flush" && s.purpose !== "build") fail("stage purpose");
    const plan = parseArchiveInsertPlan(s.plan);
    if (JSON.stringify(plan.previousRoot) !== JSON.stringify(root)) fail("stage previous root");
    let gc: ArchiveStage["gc"] = null;
    if (s.gc !== null) {
      const g = object(s.gc, ["hash", "json"]);
      const hash = nullableHash(g.hash);
      if (hash === null || typeof g.json !== "string" || g.json.length > 8192) fail("stage gc");
      const retired = parseRetiredRecord(JSON.parse(g.json));
      if (retired.previous !== gcTopHash ||
        JSON.stringify(retired.nodes) !== JSON.stringify(plan.retired)) fail("stage retired frontier");
      gc = { hash, json: g.json };
    }
    if ((plan.retired.length === 0) !== (gc === null) || gcCleanupHash !== null ||
      gc !== null && gcRecords === MAX_ARCHIVE_GC_RECORDS) fail("stage gc budget");
    if (s.purpose === "build" && value.phase === "ready" ||
      s.purpose === "flush" && value.phase === "building") fail("stage phase");
    stage = { purpose: s.purpose, plan, gc };
  }
  return { phase: value.phase, root, build, stage, gcTopHash, gcRecords,
    gcCleanupHash, error: value.error as string | null };
}

export async function prepareArchiveStage(
  archive: RunArchiveState, purpose: ArchiveStage["purpose"], plan: ArchiveInsertPlan,
): Promise<ArchiveStage> {
  if (archive.stage || archive.gcCleanupHash ||
    plan.retired.length > 0 && archive.gcRecords >= MAX_ARCHIVE_GC_RECORDS) {
    throw new Error("Run archive cleanup capacity exhausted; pending data is retained");
  }
  const json = JSON.stringify({ schemaVersion: 1, nodes: plan.retired, previous: archive.gcTopHash });
  return { purpose, plan, gc: plan.retired.length > 0
    ? { hash: await hashArchiveJSON(json), json } : null };
}

export function archiveRetiredKey(hash: string): string {
  if (!HASH.test(hash)) fail("gc key");
  return GC_PREFIX + hash;
}

async function readRetired(storage: DurableObjectStorageBinding, hash: string): Promise<RetiredRecord> {
  const raw = await storage.get<unknown>(archiveRetiredKey(hash));
  if (typeof raw !== "string" || raw.length > 8192 || await hashArchiveJSON(raw) !== hash) fail("gc integrity");
  return parseRetiredRecord(JSON.parse(raw));
}

export async function stageArchiveRetirement(
  storage: DurableObjectStorageBinding, stage: ArchiveStage,
): Promise<void> {
  if (!stage.gc) return;
  if (await hashArchiveJSON(stage.gc.json) !== stage.gc.hash) fail("stage gc digest");
  const key = archiveRetiredKey(stage.gc.hash);
  const existing = await storage.get<unknown>(key);
  if (existing === undefined) await storage.put(key, stage.gc.json);
  else if (existing !== stage.gc.json) fail("gc collision");
  await readRetired(storage, stage.gc.hash);
}

/** Caller serializes this with query traversal and root publication. */
export async function collectRunArchiveGarbage(
  storage: DurableObjectStorageBinding,
  archive: RunArchiveState,
  commit: (next: RunArchiveState) => Promise<void>,
): Promise<void> {
  if (archive.stage) return;
  if (archive.gcCleanupHash) {
    // The prior head already removed this record from the live chain.
    await storage.delete(archiveRetiredKey(archive.gcCleanupHash));
    archive = { ...archive, gcCleanupHash: null };
    await commit(archive);
  }
  if (!archive.gcTopHash) return;
  const hash = archive.gcTopHash;
  const record = await readRetired(storage, hash);
  if (record.nodes.includes(archive.root.hash ?? "")) fail("retired live root");
  for (const node of record.nodes) await storage.delete(archiveNodeKey(node));
  // Advance authority before removing the record. Failures retry idempotently.
  archive = { ...archive, gcTopHash: record.previous, gcRecords: archive.gcRecords - 1,
    gcCleanupHash: hash };
  await commit(archive);
  await storage.delete(archiveRetiredKey(hash));
  await commit({ ...archive, gcCleanupHash: null });
}
