#!/usr/bin/env npx tsx
/**
 * Hot-table offload backfill (D1 -> R2).
 *
 * Phase 1:
 * - run_events -> TAKOS_OFFLOAD (R2) JSONL segments:
 *   runs/{runId}/events/000001.jsonl.gz
 *
 * Phase 2:
 * - messages (large payloads) -> TAKOS_OFFLOAD (R2) JSON objects:
 *   threads/{threadId}/messages/{messageId}.json
 *
 * Usage:
 *   npx tsx scripts/offload-backfill.ts run-events [--remote --env staging|production] [--run-id <runId>] [--limit-runs <n>] [--dry-run] [--force]
 *   npx tsx scripts/offload-backfill.ts messages   [--remote --env staging|production] [--thread-id <threadId>] [--limit-messages <n>] [--dry-run] [--force]
 *
 * Notes:
 * - `--remote` targets remote D1 + remote R2 and requires `--env staging|production`. Default is local.
 * - Backfill is idempotent per-run unless `--force` is provided (existing R2 prefix -> skip).
 * - Event IDs are re-numbered per-run starting at 1 (dense, monotonic).
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Buffer } from "node:buffer";

type RemoteEnvironment = 'staging' | 'production';

const D1_TARGET = 'DB';
const LOCAL_OFFLOAD_BUCKET = 'takos-offload';
const REMOTE_OFFLOAD_BUCKETS: Record<RemoteEnvironment, string> = {
  staging: 'takos-offload-staging',
  production: 'takos-offload',
};
const RUN_EVENT_SEGMENT_SIZE = 100;

const args = process.argv.slice(2);
const command = args[0];
const isRemote = args.includes('--remote');
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force');
const remoteEnvironment = getArgValue('--env');

const remoteFlag = isRemote ? '--remote' : '--local';
// Wrangler R2: remote is default, local uses --local.
const r2Flag = isRemote ? '' : '--local';

if (isRemote && remoteEnvironment !== 'staging' && remoteEnvironment !== 'production') {
  die('--remote requires --env staging|production');
}

if (!isRemote && remoteEnvironment) {
  die('--env is only valid together with --remote');
}

function die(message: string): never {
  console.error(`Error: ${message}`);
  Deno.exit(1);
}

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function getOffloadBucket(): string {
  if (!isRemote) {
    return LOCAL_OFFLOAD_BUCKET;
  }
  return REMOTE_OFFLOAD_BUCKETS[remoteEnvironment as RemoteEnvironment];
}

function withRemoteEnv(args: string[]): string[] {
  if (!isRemote) {
    return args;
  }
  return [...args, '--env', remoteEnvironment as RemoteEnvironment];
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function runWranglerWithPipes(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`Failed to run wrangler: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runWranglerInherit(args: string[]): void {
  const result = spawnSync('npx', ['wrangler', ...args], {
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Failed to run wrangler: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Wrangler command failed with exit code ${result.status}`);
  }
}

function d1Query<T = any>(sql: string): T[] {
  const d1Args = withRemoteEnv(['d1', 'execute', D1_TARGET, remoteFlag, '--command', sql, '--json']);
  const result = runWranglerWithPipes(d1Args);
  if (result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout);
      return (parsed?.[0]?.results || []) as T[];
    } catch {
      // fall through to status/error handling
    }
  }
  throw new Error(`D1 query failed: ${result.stderr || `exit code ${result.status ?? -1}`}`);
}

function d1Execute(sql: string): void {
  runWranglerInherit(withRemoteEnv(['d1', 'execute', D1_TARGET, remoteFlag, '--command', sql]));
}

function r2ListPrefix(prefix: string): unknown[] {
  // `wrangler r2 object list` supports `--prefix` and `--json`.
  const args = ['r2', 'object', 'list', getOffloadBucket(), '--prefix', prefix, '--json'];
  if (r2Flag) args.splice(4, 0, r2Flag);
  try {
    const result = runWranglerWithPipes(args);
    if (result.status !== 0) {
      return [];
    }
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // If the command fails (older wrangler, empty), fall back to non-json listing.
    return [];
  }
}

function r2PutObject(key: string, filePath: string): void {
  const args = ['r2', 'object', 'put', `${getOffloadBucket()}/${key}`, '--file', filePath];
  if (r2Flag) args.push(r2Flag);
  runWranglerInherit(args);
}

function segmentKey(runId: string, segmentIndex: number): string {
  return `runs/${runId}/events/${String(segmentIndex).padStart(6, '0')}.jsonl.gz`;
}

type D1RunEventRow = {
  id: number;
  type: string;
  data: string;
  created_at: string;
};

type D1MessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string;
  sequence: number;
  created_at: string;
  r2_key?: string | null;
};

async function backfillRunEvents(): Promise<void> {
  const runIdArg = getArgValue('--run-id');
  const limitRuns = Math.max(1, Math.min(parseInt(getArgValue('--limit-runs') || '200', 10) || 200, 10_000));

  const runIds: string[] = runIdArg
    ? [runIdArg]
    : d1Query<{ run_id: string }>(
        `SELECT DISTINCT run_id FROM run_events ORDER BY run_id LIMIT ${limitRuns}`
      ).map((r) => r.run_id);

  if (runIds.length === 0) {
    console.log('No runs found in D1 run_events.');
    return;
  }

  console.log(
    `Backfilling run_events -> R2 (${isRemote ? `remote:${remoteEnvironment}` : 'local'})` +
      ` runs=${runIds.length} dryRun=${isDryRun} force=${isForce}`
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'takos-offload-backfill-'));

  try {
    for (const runId of runIds) {
      const prefix = `runs/${runId}/events/`;
      if (!isForce) {
        const existing = r2ListPrefix(prefix);
        if (existing.length > 0) {
          console.log(`- ${runId}: skip (R2 prefix exists: ${existing.length} objects)`);
          continue;
        }
      }

      const rows = d1Query<D1RunEventRow>(
        `SELECT id, type, data, created_at FROM run_events WHERE run_id = '${escapeSqlLiteral(runId)}' ORDER BY id ASC`
      );

      if (rows.length === 0) {
        console.log(`- ${runId}: no events`);
        continue;
      }

      let segmentIndex = 1;
      let eventId = 0;
      let segmentLines: string[] = [];

      const flush = () => {
        if (segmentLines.length === 0) return;
        const jsonl = segmentLines.join('\n') + '\n';
        const gz = gzipSync(Buffer.from(jsonl, 'utf-8'));
        const key = segmentKey(runId, segmentIndex);
        const tmpFile = path.join(tempDir, `${runId}-events-${String(segmentIndex).padStart(6, '0')}.jsonl.gz`);
        fs.writeFileSync(tmpFile, gz);

        if (isDryRun) {
          console.log(`  - ${runId}: would put ${key} (${segmentLines.length} events, ${gz.length} bytes)`);
        } else {
          console.log(`  - ${runId}: put ${key} (${segmentLines.length} events, ${gz.length} bytes)`);
          r2PutObject(key, tmpFile);
        }

        fs.unlinkSync(tmpFile);
        segmentLines = [];
        segmentIndex += 1;
      };

      for (const row of rows) {
        eventId += 1;
        segmentLines.push(
          JSON.stringify({
            event_id: eventId,
            type: row.type,
            data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data),
            created_at: row.created_at,
          })
        );

        if (segmentLines.length >= RUN_EVENT_SEGMENT_SIZE) {
          flush();
        }
      }

      flush();
      console.log(`- ${runId}: done (events=${rows.length})`);
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function backfillMessages(): Promise<void> {
  const threadIdArg = getArgValue('--thread-id');
  const limitMessages = Math.max(1, Math.min(parseInt(getArgValue('--limit-messages') || '500', 10) || 500, 50_000));

  const whereParts: string[] = [];
  if (!isForce) {
    whereParts.push('r2_key IS NULL');
  }
  if (threadIdArg) {
    whereParts.push(`thread_id = '${escapeSqlLiteral(threadIdArg)}'`);
  }
  // Offload candidates (must match runtime policy): tool messages or large payloads.
  whereParts.push(`(role = 'tool' OR length(content) > 4000)`);

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const rows = d1Query<D1MessageRow>(`
    SELECT id, thread_id, role, content, tool_calls, tool_call_id, metadata, sequence, created_at, r2_key
    FROM messages
    ${where}
    ORDER BY created_at ASC
    LIMIT ${limitMessages}
  `);

  if (rows.length === 0) {
    console.log('No message rows eligible for offload backfill.');
    return;
  }

  console.log(
    `Backfilling messages -> R2 (${isRemote ? `remote:${remoteEnvironment}` : 'local'})` +
      ` rows=${rows.length} dryRun=${isDryRun} force=${isForce}`
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'takos-offload-msg-backfill-'));
  try {
    for (const row of rows) {
      const key = `threads/${row.thread_id}/messages/${row.id}.json`;
      const payload = {
        id: row.id,
        thread_id: row.thread_id,
        role: row.role,
        content: row.content,
        tool_calls: row.tool_calls ?? null,
        tool_call_id: row.tool_call_id ?? null,
        metadata: row.metadata || '{}',
        sequence: row.sequence,
        created_at: row.created_at,
      };

      const tmpFile = path.join(tempDir, `msg-${row.id}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8');

      if (isDryRun) {
        console.log(`- ${row.id}: would put ${key}`);
      } else {
        console.log(`- ${row.id}: put ${key}`);
        r2PutObject(key, tmpFile);

        // Shrink D1 payload to metadata + preview and store pointer.
        d1Execute(`
          UPDATE messages
          SET
            r2_key = '${escapeSqlLiteral(key)}',
            content = CASE
              WHEN length(content) > 800 THEN substr(content, 1, 800) || '...'
              ELSE content
            END,
            tool_calls = NULL,
            metadata = '{}'
          WHERE id = '${escapeSqlLiteral(row.id)}'
        `);
      }

      fs.unlinkSync(tmpFile);
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function showHelp(): void {
  console.log(`
Hot-table offload backfill (D1 -> R2)

Usage:
  npx tsx scripts/offload-backfill.ts run-events [options]
  npx tsx scripts/offload-backfill.ts messages [options]

Options:
  --remote        Target remote D1 + remote R2 (default: local)
  --env <name>    Remote environment: staging | production
  --run-id <id>   Backfill a single run
  --limit-runs N  Limit distinct runs scanned (default: 200)
  --thread-id <id> Backfill messages in a single thread
  --limit-messages N Limit eligible messages scanned (default: 500)
  --dry-run       Do not upload to R2
  --force         Backfill even if R2 prefix exists (overwrites segments)
`);
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help') {
    showHelp();
    return;
  }

  if (command === 'run-events') {
    await backfillRunEvents();
    return;
  }

  if (command === 'messages') {
    await backfillMessages();
    return;
  }

  die(`Unknown command: ${command}`);
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
