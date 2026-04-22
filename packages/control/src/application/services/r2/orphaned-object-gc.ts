import type { D1Database, R2Bucket } from "../../../shared/types/bindings.ts";
import {
  blobs,
  getDb,
  sessionFiles,
  sessions,
  snapshots,
} from "../../../infra/db/index.ts";
import { and, eq, inArray } from "drizzle-orm";

type OffloadEnv = {
  DB: D1Database;
  TENANT_SOURCE?: R2Bucket;
  TAKOS_OFFLOAD?: R2Bucket;
};

type CursorState = {
  version: 1;
  last_success_at: string;
  cursors: { blobs?: string; trees?: string };
};

export interface R2OrphanedObjectGcSummary {
  skipped: boolean;
  reason?: string;
  dry_run: boolean;
  started_at: string;
  min_age_minutes: number;
  scanned: { blobs: number; trees: number };
  candidates: { blobs: number; trees: number };
  deleted: { blobs: number; trees: number };
  next_cursors: { blobs?: string; trees?: string };
}

const STATE_KEY = "ops/job-state/r2-orphaned-object-gc.json";
const AUDIT_PREFIX = "ops/r2-orphaned-object-gc";

export const r2OrphanedObjectGcDeps = {
  getDb,
  readJson,
  writeJson,
};

function stableIsoNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function safeKeyTimestamp(iso: string): string {
  return iso.replace(/:/g, "-");
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return await obj.json<T>();
  } catch {
    return null;
  }
}

async function writeJson(
  bucket: R2Bucket,
  key: string,
  value: unknown,
): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
}

function uploadedMs(obj: { uploaded?: Date }): number | null {
  if (!(obj.uploaded instanceof Date)) return null;
  const ms = obj.uploaded.getTime();
  return Number.isFinite(ms) ? ms : null;
}

const WORKSPACE_ID_RE = /^[a-zA-Z0-9_-]{6,128}$/;

function parseBlobKey(key: string): { spaceId: string; hash: string } | null {
  if (!key.startsWith("blobs/")) return null;
  const parts = key.slice(6).split("/");
  if (parts.length !== 2) return null;
  const [spaceId, hash] = parts;
  if (!WORKSPACE_ID_RE.test(spaceId) || !/^[0-9a-f]{64}$/.test(hash)) {
    return null;
  }
  return { spaceId, hash };
}

function parseTreeKey(
  key: string,
): { spaceId: string; snapshotId: string } | null {
  if (!key.startsWith("trees/") || !key.endsWith(".json.gz")) return null;
  const parts = key.slice(6).split("/");
  if (parts.length !== 2) return null;
  const [spaceId, name] = parts;
  const snapshotId = name.slice(0, -8);
  if (!WORKSPACE_ID_RE.test(spaceId) || !WORKSPACE_ID_RE.test(snapshotId)) {
    return null;
  }
  return { spaceId, snapshotId };
}

function groupBySpaceId<T extends { spaceId: string }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    let list = map.get(item.spaceId);
    if (!list) {
      list = [];
      map.set(item.spaceId, list);
    }
    list.push(item);
  }
  return map;
}

function skippedSummary(reason: string): R2OrphanedObjectGcSummary {
  return {
    skipped: true,
    reason,
    dry_run: true,
    started_at: stableIsoNoMillis(new Date()),
    min_age_minutes: 0,
    scanned: { blobs: 0, trees: 0 },
    candidates: { blobs: 0, trees: 0 },
    deleted: { blobs: 0, trees: 0 },
    next_cursors: {},
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export async function runR2OrphanedObjectGcBatch(
  env: OffloadEnv,
  options?: {
    dryRun?: boolean;
    listLimit?: number;
    maxDeletes?: number;
    minAgeMinutes?: number;
  },
): Promise<R2OrphanedObjectGcSummary> {
  const source = env.TENANT_SOURCE;
  if (!source) return skippedSummary("TENANT_SOURCE bucket not configured");

  const offload = env.TAKOS_OFFLOAD;
  if (!offload) return skippedSummary("TAKOS_OFFLOAD bucket not configured");

  const dryRun = options?.dryRun ?? false;
  const listLimit = clamp(options?.listLimit ?? 200, 1, 1000);
  const maxDeletes = clamp(options?.maxDeletes ?? 200, 0, 1000);
  const minAgeMinutes = clamp(
    options?.minAgeMinutes ?? 24 * 60,
    0,
    30 * 24 * 60,
  );

  const startedAt = stableIsoNoMillis(new Date());
  const cutoffMs = Date.now() - minAgeMinutes * 60_000;

  const prior = await r2OrphanedObjectGcDeps.readJson<CursorState>(
    offload,
    STATE_KEY,
  );
  const cursors = prior?.version === 1 && prior.cursors
    ? { ...prior.cursors }
    : {};

  const db = r2OrphanedObjectGcDeps.getDb(env.DB);

  const summary: R2OrphanedObjectGcSummary = {
    skipped: false,
    dry_run: dryRun,
    started_at: startedAt,
    min_age_minutes: minAgeMinutes,
    scanned: { blobs: 0, trees: 0 },
    candidates: { blobs: 0, trees: 0 },
    deleted: { blobs: 0, trees: 0 },
    next_cursors: {},
  };

  const deletedKeys: { blobs: string[]; trees: string[] } = {
    blobs: [],
    trees: [],
  };

  // Blob GC: delete objects whose DB blob row is missing AND not referenced by any session_file.
  const blobsPage = await source.list({
    prefix: "blobs/",
    cursor: cursors.blobs,
    limit: listLimit,
  });
  summary.next_cursors.blobs = blobsPage.truncated
    ? blobsPage.cursor
    : undefined;

  const blobCandidates: Array<{ key: string; spaceId: string; hash: string }> =
    [];
  for (const obj of blobsPage.objects) {
    summary.scanned.blobs += 1;
    if (minAgeMinutes > 0) {
      const ms = uploadedMs(obj);
      if (ms === null || ms > cutoffMs) continue;
    }
    const parsed = parseBlobKey(obj.key);
    if (parsed) blobCandidates.push({ key: obj.key, ...parsed });
  }
  summary.candidates.blobs = blobCandidates.length;

  const blobDeletes: string[] = [];
  for (const [spaceId, items] of groupBySpaceId(blobCandidates)) {
    const hashes = [...new Set(items.map((i) => i.hash))];
    if (hashes.length === 0) continue;

    const existing = new Set(
      (await db.select({ hash: blobs.hash }).from(blobs)
        .where(and(eq(blobs.accountId, spaceId), inArray(blobs.hash, hashes)))
        .all()).map((b) => b.hash),
    );

    const referenced = new Set(
      (await db.selectDistinct({ hash: sessionFiles.hash })
        .from(sessionFiles)
        .innerJoin(sessions, eq(sessionFiles.sessionId, sessions.id))
        .where(
          and(
            inArray(sessionFiles.hash, hashes),
            eq(sessions.accountId, spaceId),
          ),
        )
        .all()).map((r) => r.hash),
    );

    for (const item of items) {
      if (!existing.has(item.hash) && !referenced.has(item.hash)) {
        blobDeletes.push(item.key);
      }
    }
  }

  const blobDeletesLimited = blobDeletes.slice(0, maxDeletes);
  if (!dryRun && blobDeletesLimited.length > 0) {
    await source.delete(blobDeletesLimited);
  }
  summary.deleted.blobs = blobDeletesLimited.length;
  deletedKeys.blobs.push(...blobDeletesLimited);

  // Tree GC: delete objects whose DB snapshot row is missing.
  const treesPage = await source.list({
    prefix: "trees/",
    cursor: cursors.trees,
    limit: listLimit,
  });
  summary.next_cursors.trees = treesPage.truncated
    ? treesPage.cursor
    : undefined;

  const treeCandidates: Array<
    { key: string; spaceId: string; snapshotId: string }
  > = [];
  for (const obj of treesPage.objects) {
    summary.scanned.trees += 1;
    if (minAgeMinutes > 0) {
      const ms = uploadedMs(obj);
      if (ms === null || ms > cutoffMs) continue;
    }
    const parsed = parseTreeKey(obj.key);
    if (parsed) treeCandidates.push({ key: obj.key, ...parsed });
  }
  summary.candidates.trees = treeCandidates.length;

  const treeDeletes: string[] = [];
  for (const [spaceId, items] of groupBySpaceId(treeCandidates)) {
    const ids = [...new Set(items.map((i) => i.snapshotId))];
    if (ids.length === 0) continue;

    const existingIds = new Set(
      (await db.select({ id: snapshots.id }).from(snapshots)
        .where(
          and(eq(snapshots.accountId, spaceId), inArray(snapshots.id, ids)),
        )
        .all()).map((s) => s.id),
    );

    for (const item of items) {
      if (!existingIds.has(item.snapshotId)) {
        treeDeletes.push(item.key);
      }
    }
  }

  const treeDeletesLimited = treeDeletes.slice(0, maxDeletes);
  if (!dryRun && treeDeletesLimited.length > 0) {
    await source.delete(treeDeletesLimited);
  }
  summary.deleted.trees = treeDeletesLimited.length;
  deletedKeys.trees.push(...treeDeletesLimited);

  const nextCursors: CursorState["cursors"] = {};
  if (summary.next_cursors.blobs) {
    nextCursors.blobs = summary.next_cursors.blobs;
  }
  if (summary.next_cursors.trees) {
    nextCursors.trees = summary.next_cursors.trees;
  }

  await writeJson(
    offload,
    STATE_KEY,
    {
      version: 1,
      last_success_at: stableIsoNoMillis(new Date()),
      cursors: nextCursors,
    } satisfies CursorState,
  );

  if (deletedKeys.blobs.length > 0 || deletedKeys.trees.length > 0) {
    await writeJson(
      offload,
      `${AUDIT_PREFIX}/deleted/${safeKeyTimestamp(startedAt)}.json`,
      {
        started_at: startedAt,
        dry_run: dryRun,
        min_age_minutes: minAgeMinutes,
        deleted: deletedKeys,
      },
    );
  }

  return summary;
}
