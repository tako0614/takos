import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import { CloudflareApiClient } from '../cloudflare/api-client';
import { sha256Hex } from '../../../shared/utils/encoding-utils';

type BackupEnv = {
  DB: D1Database;
  TAKOS_OFFLOAD?: R2Bucket;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
};

type OffloadEnv = {
  TAKOS_OFFLOAD?: R2Bucket;
};

export interface D1BackupSummary {
  skipped: boolean;
  reason?: string;
  key?: string;
  bytes?: number;
  sha256?: string;
  deleted_old_backups?: number;
}

export interface BackupIntegrityCheckSummary {
  skipped: boolean;
  reason?: string;
  key?: string;
  bytes?: number;
  sha256?: string;
  expected_sha256?: string;
}

export interface BackupInventorySummary {
  skipped: boolean;
  reason?: string;
  prefix?: string;
  objects?: number;
  total_bytes?: number;
  oldest_key?: string | null;
  newest_key?: string | null;
}

type JobState = {
  last_success_at: string;
  meta?: Record<string, unknown>;
};

const JOB_STATE_PREFIX = 'ops/job-state';
const BACKUP_PREFIX = 'backups/d1/takos-control-db/';
const LATEST_MANIFEST_KEY = `${BACKUP_PREFIX}latest.json`;
const D1_DB_NAME = 'takos-control-db';

function stableIsoNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeKeyTimestamp(iso: string): string {
  return iso.replace(/:/g, '-');
}

function parseBackupExtension(key: string): string | null {
  if (key.endsWith('.sql')) return '.sql';
  if (key.endsWith('.sqlite')) return '.sqlite';
  return null;
}

function parseBackupCreatedAtMs(key: string): number | null {
  if (!key.startsWith(BACKUP_PREFIX)) return null;
  const ext = parseBackupExtension(key);
  if (!ext) return null;

  const base = key.slice(BACKUP_PREFIX.length, -ext.length);
  const tIndex = base.indexOf('T');
  if (tIndex === -1) return null;

  const datePart = base.slice(0, tIndex);
  const timePart = base.slice(tIndex + 1);
  if (!timePart.endsWith('Z')) return null;

  const iso = `${datePart}T${timePart.slice(0, -1).replace(/-/g, ':')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parseInventoryCreatedAtMs(key: string): number | null {
  const invPrefix = `${BACKUP_PREFIX}inventory/`;
  if (!key.startsWith(invPrefix)) return null;
  if (!key.endsWith('.json')) return null;

  const name = key.slice(invPrefix.length, -'.json'.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return null;
  const ms = Date.parse(`${name}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isUnsupportedDbDumpError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('DB.dump() is not implemented');
}

type D1DatabaseListing = {
  uuid: string;
  name: string;
};

async function resolveD1DatabaseUuid(
  cfClient: CloudflareApiClient,
  databaseName: string
): Promise<string> {
  const dbs = await cfClient.accountGet<D1DatabaseListing[]>(
    `/d1/database?name=${encodeURIComponent(databaseName)}&per_page=100&page=1`
  );

  const match = dbs.find((db) => db.name === databaseName) ?? null;
  if (!match?.uuid) {
    throw new Error(`D1 database not found: ${databaseName}`);
  }
  return match.uuid;
}

type D1ExportPolling = {
  at_bookmark?: string;
  status?: 'complete' | 'error';
  error?: string;
  messages?: string[];
  result?: {
    filename?: string;
    signed_url?: string;
  };
};

async function exportD1DatabaseSql(
  cfClient: CloudflareApiClient,
  databaseUuid: string
): Promise<{ filename?: string; signedUrl: string; atBookmark?: string }> {
  const maxAttempts = 30;
  let currentBookmark: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const poll = await cfClient.accountPost<D1ExportPolling>(
      `/d1/database/${databaseUuid}/export`,
      {
        output_format: 'polling',
        ...(currentBookmark ? { current_bookmark: currentBookmark } : {}),
      },
    );

    if (poll.at_bookmark) currentBookmark = poll.at_bookmark;
    if (poll.status === 'complete') {
      const signedUrl = poll.result?.signed_url ? String(poll.result.signed_url) : '';
      if (!signedUrl) {
        throw new Error('D1 export completed but no signed_url was returned');
      }
      return {
        filename: poll.result?.filename,
        signedUrl,
        atBookmark: poll.at_bookmark,
      };
    }
    if (poll.status === 'error') {
      throw new Error(poll.error || 'D1 export failed');
    }

    const delayMs = Math.min(5_000, 250 * Math.pow(1.4, attempt));
    await sleep(delayMs);
  }

  throw new Error('D1 export did not complete within polling budget');
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

async function writeJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

function getUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isDailyDue(state: JobState | null, now: Date): boolean {
  if (!state?.last_success_at) return true;
  const lastDay = String(state.last_success_at).slice(0, 10);
  return lastDay !== getUtcDayKey(now);
}

function isWeeklyDue(state: JobState | null, now: Date): boolean {
  if (!state?.last_success_at) return true;
  const lastMs = Date.parse(state.last_success_at);
  if (!Number.isFinite(lastMs)) return true;
  return (now.getTime() - lastMs) >= 7 * 24 * 60 * 60 * 1000;
}

export async function runD1DailyBackup(
  env: BackupEnv,
  options?: {
    retentionDays?: number;
    force?: boolean;
  }
): Promise<D1BackupSummary> {
  const bucket = env.TAKOS_OFFLOAD;
  if (!bucket) {
    return { skipped: true, reason: 'TAKOS_OFFLOAD bucket not configured' };
  }

  const retentionDays = Math.max(1, Math.min(options?.retentionDays ?? 35, 365));
  const now = new Date();

  const stateKey = `${JOB_STATE_PREFIX}/d1-daily-backup.json`;
  const state = await readJson<JobState>(bucket, stateKey);
  if (!options?.force && !isDailyDue(state, now)) {
    return { skipped: true, reason: 'already backed up today (UTC)' };
  }

  const startedAt = stableIsoNoMillis(now);

  let bytes = 0;
  let sha256 = '';
  let body: ArrayBuffer;
  let ext: '.sql' | '.sqlite' = '.sqlite';
  let backupKind: 'd1_export_sql' | 'd1_dump' = 'd1_dump';
  let exportFilename: string | undefined;

  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
    const cfClient = new CloudflareApiClient({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
    const databaseUuid = await resolveD1DatabaseUuid(cfClient, D1_DB_NAME);
    const exportResult = await exportD1DatabaseSql(cfClient, databaseUuid);

    const download = await fetch(exportResult.signedUrl);
    if (!download.ok) {
      throw new Error(`D1 export download failed (${download.status}): ${download.statusText}`);
    }

    body = await download.arrayBuffer();
    bytes = body.byteLength;
    sha256 = await sha256Hex(body);
    ext = '.sql';
    backupKind = 'd1_export_sql';
    exportFilename = exportResult.filename;
  } else {
    // Fallback for tests/local envs. Some local adapters do not implement DB.dump().
    try {
      body = await env.DB.dump();
    } catch (err) {
      if (isUnsupportedDbDumpError(err)) {
        return {
          skipped: true,
          reason: 'DB.dump() is not supported by this local database adapter; configure Cloudflare D1 export credentials instead.',
        };
      }
      throw err;
    }
    bytes = body.byteLength;
    sha256 = await sha256Hex(body);
    ext = '.sqlite';
    backupKind = 'd1_dump';
  }

  const tsKey = safeKeyTimestamp(startedAt);
  const key = `${BACKUP_PREFIX}${tsKey}${ext}`;

  await bucket.put(key, body, {
    httpMetadata: {
      contentType: ext === '.sql' ? 'application/sql; charset=utf-8' : 'application/x-sqlite3',
    },
    customMetadata: {
      kind: backupKind,
      db: 'takos-control-db',
      created_at: startedAt,
      sha256,
      bytes: String(bytes),
      ...(exportFilename ? { export_filename: exportFilename } : {}),
    },
  });

  await writeJson(bucket, LATEST_MANIFEST_KEY, {
    key,
    created_at: startedAt,
    sha256,
    bytes,
    format: ext === '.sql' ? 'sql' : 'sqlite',
  });

  await writeJson(bucket, stateKey, {
    last_success_at: stableIsoNoMillis(new Date()),
    meta: { key, sha256, bytes, retention_days: retentionDays },
  } satisfies JobState);

  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  let deleted = 0;

  while (true) {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });
    const toDelete: string[] = [];

    for (const obj of page.objects) {
      if (obj.key === LATEST_MANIFEST_KEY) continue;
      const createdMs = parseBackupCreatedAtMs(obj.key);
      if (createdMs !== null && createdMs < cutoffMs) {
        toDelete.push(obj.key);
        continue;
      }
      const invMs = parseInventoryCreatedAtMs(obj.key);
      if (invMs !== null && invMs < cutoffMs) toDelete.push(obj.key);
    }

    if (toDelete.length > 0) {
      await bucket.delete(toDelete);
      deleted += toDelete.length;
    }

    if (!page.truncated) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  return {
    skipped: false,
    key,
    bytes,
    sha256,
    deleted_old_backups: deleted,
  };
}

export async function runD1BackupInventory(
  env: OffloadEnv,
  options?: { force?: boolean }
): Promise<BackupInventorySummary> {
  const bucket = env.TAKOS_OFFLOAD;
  if (!bucket) {
    return { skipped: true, reason: 'TAKOS_OFFLOAD bucket not configured' };
  }

  const now = new Date();
  const stateKey = `${JOB_STATE_PREFIX}/d1-backup-inventory.json`;
  const state = await readJson<JobState>(bucket, stateKey);
  if (!options?.force && !isDailyDue(state, now)) {
    return { skipped: true, reason: 'already inventoried today (UTC)' };
  }

  let cursor: string | undefined;
  let objects = 0;
  let totalBytes = 0;
  let oldestKey: string | null = null;
  let newestKey: string | null = null;

  while (true) {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });

    for (const obj of page.objects) {
      const createdMs = parseBackupCreatedAtMs(obj.key);
      if (createdMs === null) continue;

      objects += 1;
      totalBytes += obj.size;
      if (!oldestKey || obj.key < oldestKey) oldestKey = obj.key;
      if (!newestKey || obj.key > newestKey) newestKey = obj.key;
    }

    if (!page.truncated) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  await writeJson(bucket, `${BACKUP_PREFIX}inventory/${getUtcDayKey(now)}.json`, {
    prefix: BACKUP_PREFIX,
    objects,
    total_bytes: totalBytes,
    oldest_key: oldestKey,
    newest_key: newestKey,
    created_at: stableIsoNoMillis(now),
  });

  await writeJson(bucket, stateKey, {
    last_success_at: stableIsoNoMillis(new Date()),
    meta: { objects, total_bytes: totalBytes, oldest_key: oldestKey, newest_key: newestKey },
  } satisfies JobState);

  return {
    skipped: false,
    prefix: BACKUP_PREFIX,
    objects,
    total_bytes: totalBytes,
    oldest_key: oldestKey,
    newest_key: newestKey,
  };
}

export async function runD1BackupIntegrityCheck(
  env: OffloadEnv,
  options?: { force?: boolean }
): Promise<BackupIntegrityCheckSummary> {
  const bucket = env.TAKOS_OFFLOAD;
  if (!bucket) {
    return { skipped: true, reason: 'TAKOS_OFFLOAD bucket not configured' };
  }

  const now = new Date();
  const stateKey = `${JOB_STATE_PREFIX}/d1-backup-integrity-weekly.json`;
  const state = await readJson<JobState>(bucket, stateKey);
  if (!options?.force && !isWeeklyDue(state, now)) {
    return { skipped: true, reason: 'integrity check not due yet' };
  }

  const latest = await readJson<{ key?: string }>(bucket, LATEST_MANIFEST_KEY);
  const key = latest?.key ? String(latest.key) : '';
  if (!key) {
    return { skipped: true, reason: 'no latest backup manifest found' };
  }

  const obj = await bucket.get(key);
  if (!obj) {
    return { skipped: true, reason: `backup object not found: ${key}` };
  }

  const body = await obj.arrayBuffer();
  const sha256 = await sha256Hex(body);
  const expected = obj.customMetadata?.sha256 || undefined;

  if (expected && expected !== sha256) {
    throw new Error(`D1 backup integrity check failed: sha256 mismatch for ${key}`);
  }

  await writeJson(bucket, stateKey, {
    last_success_at: stableIsoNoMillis(new Date()),
    meta: { key, sha256, bytes: body.byteLength, expected_sha256: expected ?? null },
  } satisfies JobState);

  return {
    skipped: false,
    key,
    bytes: body.byteLength,
    sha256,
    expected_sha256: expected,
  };
}
