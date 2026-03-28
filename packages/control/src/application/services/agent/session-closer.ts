/**
 * Auto-close session logic for the Agent Runner.
 *
 * Handles committing session changes (snapshot + file sync) on success,
 * or discarding changes on failure. Uses chunked processing to limit
 * memory usage and phase-aware rollback for error recovery.
 */

import type { Env } from '../../../shared/types';
import type { AgentContext, AgentEvent } from './agent-models';
import { SnapshotManager } from '../sync/snapshot';
import { generateId } from '../../../shared/utils';
import { getDb, sessions, accounts, accountMetadata, files, runs } from '../../../infra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { callRuntimeRequest } from '../execution/runtime-request-handler';
import { logError, logWarn } from '../../../shared/utils/logger';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';

const AUTO_CLOSE_SNAPSHOT_TIMEOUT_MS = 10000;

export interface SessionCloserDeps {
  env: Env;
  db: SqlDatabaseBinding;
  context: AgentContext;
  checkCancellation: (force?: boolean) => Promise<boolean>;
  emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
  getCurrentSessionId: () => Promise<string | null>;
}

type Phase = 'INIT' | 'SNAPSHOT' | 'BLOB_WRITE' | 'FILE_SYNC' | 'FINALIZE' | 'CLEANUP';

/** Mutable phase tracker shared between autoCloseSession and commitSession. */
interface PhaseTracker {
  current: Phase;
  snapshotCreated: boolean;
  filesModified: number;
}

async function fetchAutoCloseSnapshot(
  deps: SessionCloserDeps,
  sessionId: string,
): Promise<Response> {
  if (await deps.checkCancellation(true)) {
    throw new Error('Run cancelled while fetching auto-close snapshot');
  }

  const response = await callRuntimeRequest(deps.env, '/session/snapshot', {
    method: 'POST',
    body: {
      session_id: sessionId,
      space_id: deps.context.spaceId,
    },
    timeoutMs: AUTO_CLOSE_SNAPSHOT_TIMEOUT_MS,
  });

  return response;
}

/**
 * Commit session changes: create snapshot and sync files to workspace.
 * Processes files in chunks to limit memory usage.
 * Updates the shared `tracker` so the caller can report accurate phase on error.
 */
async function commitSession(
  deps: SessionCloserDeps,
  sessionId: string,
  db: ReturnType<typeof getDb>,
  timestamp: string,
  tracker: PhaseTracker,
): Promise<void> {
  const BLOB_CHUNK_SIZE = 50;
  const DB_BATCH_SIZE = 100;

  // Get session info
  const session = await db.select({
    baseSnapshotId: sessions.baseSnapshotId,
    status: sessions.status,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session || session.status !== 'running') {
    logWarn('Session not running, skipping auto-close', { module: 'services/agent/runner' });
    return;
  }

  tracker.current = 'SNAPSHOT';
  const snapshotResponse = await fetchAutoCloseSnapshot(deps, sessionId);

  if (!snapshotResponse.ok) {
    logWarn('Failed to get snapshot from runtime', { module: 'services/agent/runner', detail: await snapshotResponse.text() });
    // Still mark session as stopped
    await db.update(sessions).set({ status: 'stopped', updatedAt: timestamp })
      .where(eq(sessions.id, sessionId));
    return;
  }

  const snapshot = await snapshotResponse.json() as {
    files: Array<{ path: string; content: string; size: number }>;
  };

  tracker.current = 'BLOB_WRITE';

  // Build tree and store blobs using SnapshotManager
  // Process in chunks to avoid memory exhaustion for large workspaces
  const snapshotManager = new SnapshotManager(deps.env, deps.context.spaceId);
  const tree: Record<string, { hash: string; size: number; mode: number; type: 'file' | 'symlink' }> = {};

  // Process files in chunks to limit memory usage.
  // Within each chunk, writeBlob calls run in parallel to reduce latency.
  for (let i = 0; i < snapshot.files.length; i += BLOB_CHUNK_SIZE) {
    const chunk = snapshot.files.slice(i, i + BLOB_CHUNK_SIZE);

    await Promise.all(chunk.map(async (file) => {
      const { hash, size } = await snapshotManager.writeBlob(file.content);
      tree[file.path] = {
        hash,
        size,
        mode: 0o644,
        type: 'file' as const,
      };
      // Clear content reference after processing to help GC
      (file as { content: string | null }).content = null;
    }));
  }

  // Clear the original files array to free memory
  snapshot.files.length = 0;

  // Create new snapshot
  const newSnapshot = await snapshotManager.createSnapshot(
    tree,
    [session.baseSnapshotId],
    'Auto-committed by agent',
    'ai'
  );
  tracker.snapshotCreated = true;

  tracker.current = 'FILE_SYNC';

  // Mark sync as in-progress to detect partial failures on restart
  const syncMarker = `file_sync_${sessionId}_${Date.now()}`;
  await db.insert(accountMetadata).values({
    accountId: deps.context.spaceId,
    key: 'pending_sync',
    value: syncMarker,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: [accountMetadata.accountId, accountMetadata.key],
    set: {
      value: syncMarker,
      updatedAt: timestamp,
    },
  });

  // Sync files table with snapshot (like container_commit does)
  const currentFiles = await db.select({
    path: files.path,
    sha256: files.sha256,
  }).from(files).where(eq(files.accountId, deps.context.spaceId)).all();

  const currentFileMap = new Map<string, string>();
  for (const f of currentFiles) {
    currentFileMap.set(f.path, f.sha256 || '');
  }

  type FileOp = { type: 'insert' | 'update' | 'delete'; path: string; oldHash?: string };
  const appliedOps: FileOp[] = [];

  const treeEntries = Object.entries(tree);

  // Process tree entries in chunks
  for (let i = 0; i < treeEntries.length; i += DB_BATCH_SIZE) {
    const chunk = treeEntries.slice(i, i + DB_BATCH_SIZE);
    const chunkOps: FileOp[] = [];
    const createOps: Array<{
      id: string;
      accountId: string;
      path: string;
      sha256: string;
      size: number;
      origin: string;
      kind: string;
      visibility: string;
      createdAt: string;
      updatedAt: string;
    }> = [];
    const updateOps: Array<{ path: string; sha256: string; size: number }> = [];

    for (const [path, entry] of chunk) {
      const existingHash = currentFileMap.get(path);

      if (!existingHash) {
        // New file - insert
        const newId = generateId();
        createOps.push({
          id: newId,
          accountId: deps.context.spaceId,
          path,
          sha256: entry.hash,
          size: entry.size,
          origin: 'ai',
          kind: 'source',
          visibility: 'private',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        chunkOps.push({ type: 'insert', path });
      } else if (existingHash !== entry.hash) {
        // Modified file - update
        updateOps.push({ path, sha256: entry.hash, size: entry.size });
        chunkOps.push({ type: 'update', path, oldHash: existingHash });
      }
      // Remove from map to track deletions
      currentFileMap.delete(path);
    }

    // Execute this chunk's operations
    try {
      // Create new files
      if (createOps.length > 0) {
        await db.insert(files).values(createOps);
      }

      // Update files sequentially (D1 does not support transactions)
      for (const op of updateOps) {
        await db.update(files).set({
          sha256: op.sha256,
          size: op.size,
          updatedAt: timestamp,
        }).where(
          and(
            eq(files.accountId, deps.context.spaceId),
            eq(files.path, op.path),
          )
        );
      }

      appliedOps.push(...chunkOps);
      tracker.filesModified += createOps.length + updateOps.length;
    } catch (batchError) {
      const batchNum = Math.floor(i / DB_BATCH_SIZE) + 1;
      logError(`File sync batch ${batchNum} failed after ${appliedOps.length} successful ops`, batchError, { module: 'services/agent/runner' });

      logError(`Partial sync state: ${JSON.stringify({
        syncMarker,
        appliedOps: appliedOps.length,
        failedBatch: batchNum,
        spaceId: deps.context.spaceId.slice(0, 8),
      })}`, undefined, { module: 'services/agent/runner' });

      throw new Error(`File sync failed at batch ${batchNum}: ${batchError instanceof Error ? batchError.message : String(batchError)}`);
    }
  }

  // Process deletions in chunks
  const deletePaths = Array.from(currentFileMap.keys());
  for (let i = 0; i < deletePaths.length; i += DB_BATCH_SIZE) {
    const chunk = deletePaths.slice(i, i + DB_BATCH_SIZE);
    const deleteOps: FileOp[] = chunk.map(path => ({
      type: 'delete' as const,
      path,
      oldHash: currentFileMap.get(path),
    }));

    try {
      await db.delete(files).where(
        and(
          eq(files.accountId, deps.context.spaceId),
          inArray(files.path, chunk),
        )
      );
      appliedOps.push(...deleteOps);
      tracker.filesModified += chunk.length;
    } catch (batchError) {
      const batchNum = Math.floor((treeEntries.length + i) / DB_BATCH_SIZE) + 1;
      logError(`File delete batch failed after ${appliedOps.length} successful ops`, batchError, { module: 'services/agent/runner' });

      logError(`Partial sync state: ${JSON.stringify({
        syncMarker,
        appliedOps: appliedOps.length,
        failedBatch: batchNum,
        spaceId: deps.context.spaceId.slice(0, 8),
      })}`, undefined, { module: 'services/agent/runner' });

      throw new Error(`File delete failed at batch ${batchNum}: ${batchError instanceof Error ? batchError.message : String(batchError)}`);
    }
  }

  tracker.current = 'FINALIZE';

  // Count for event emission
  const fileCount = Object.keys(tree).length;

  // Update workspace and session sequentially (D1 does not support transactions)
  await db.update(accounts).set({ headSnapshotId: newSnapshot.id, updatedAt: timestamp })
    .where(eq(accounts.id, deps.context.spaceId));
  await db.update(sessions).set({ status: 'stopped', headSnapshotId: newSnapshot.id, updatedAt: timestamp })
    .where(eq(sessions.id, sessionId));

  await db.delete(accountMetadata).where(
    and(
      eq(accountMetadata.accountId, deps.context.spaceId),
      eq(accountMetadata.key, 'pending_sync'),
      eq(accountMetadata.value, syncMarker),
    )
  );

  await deps.emitEvent('progress', {
    message: 'Session changes saved',
    session_action: 'stopped',
    files_count: fileCount,
  });
}

/**
 * Auto-close session after run completion.
 * On success: commit changes (snapshot + file sync).
 * On failure: discard changes to prevent corruption.
 * Uses chunked processing and phase-aware rollback.
 */
export async function autoCloseSession(
  deps: SessionCloserDeps,
  status: 'completed' | 'failed',
): Promise<void> {
  // Get the latest session_id from DB (may have been set by container_start)
  const sessionId = await deps.getCurrentSessionId();
  if (!sessionId) {
    return; // No session to close
  }

  if (!deps.env.RUNTIME_HOST) {
    logWarn('RUNTIME_HOST binding is missing, cannot auto-close session', { module: 'services/agent/runner' });
    return;
  }

  const timestamp = new Date().toISOString();

  // Shared phase tracker so commitSession can report accurate phase on error
  const tracker: PhaseTracker = {
    current: 'INIT',
    snapshotCreated: false,
    filesModified: 0,
  };

  try {
    const db = getDb(deps.db);

    if (status === 'completed') {
      // On success: get snapshot and commit to workspace
      await commitSession(deps, sessionId, db, timestamp, tracker);
    } else {
      // On failure: just mark as discarded
      await db.update(sessions).set({ status: 'discarded', updatedAt: timestamp })
        .where(eq(sessions.id, sessionId));

      await deps.emitEvent('progress', {
        message: 'Session discarded due to error',
        session_action: 'discarded',
      });
    }

    tracker.current = 'CLEANUP';

    // Destroy runtime session
    try {
      await callRuntimeRequest(deps.env, '/session/destroy', {
        method: 'POST',
        body: {
          session_id: sessionId,
          space_id: deps.context.spaceId,
        },
      });
    } catch (e) {
      logWarn('Failed to destroy runtime session', { module: 'services/agent/runner', detail: e });
    }

  } catch (error) {
    const errorDetails = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };

    // Structured error log for monitoring/alerting
    logError('Failed to auto-close session', JSON.stringify({
      level: 'ERROR',
      event: 'SESSION_AUTO_CLOSE_FAILED',
      sessionId: sessionId.slice(0, 8),
      status,
      phase: tracker.current,
      snapshotCreated: tracker.snapshotCreated,
      filesModified: tracker.filesModified,
      error: errorDetails.message,
      spaceId: deps.context.spaceId,
      timestamp,
    }), { module: 'services/agent/runner' });

    // Emit error event so callers are aware of the failure
    try {
      await deps.emitEvent('progress', {
        message: `Session auto-close failed at phase ${tracker.current}: ${errorDetails.message}`,
        session_action: 'error',
        error: errorDetails.message,
        phase: tracker.current,
      });
    } catch (emitError) {
      logError('Failed to emit auto-close error event', emitError, { module: 'services/agent/runner' });
    }

    // Record the auto-close failure phase in the run's error field for diagnostics
    try {
      const dbErr = getDb(deps.db);
      const existingRun = await dbErr.select({ error: runs.error }).from(runs)
        .where(eq(runs.id, deps.context.runId)).get();
      const prevError = existingRun?.error || '';
      const autoCloseNote = `[auto-close failed at ${tracker.current}: ${errorDetails.message}]`;
      const combinedError = prevError ? `${prevError} ${autoCloseNote}` : autoCloseNote;
      await dbErr.update(runs).set({ error: combinedError }).where(eq(runs.id, deps.context.runId));
    } catch (runUpdateErr) {
      logError('Failed to record auto-close error on run', runUpdateErr, { module: 'services/agent/runner' });
    }

    // Phase-aware rollback/recovery
    try {
      const dbRecover = getDb(deps.db);
      if (tracker.current === 'FILE_SYNC' && tracker.filesModified > 0) {
        // Partial file sync - mark session as error state to prevent usage
        logWarn(`Partial file sync detected (${tracker.filesModified} ops). Marking session as error state.`, { module: 'services/agent/runner' });
        await dbRecover.update(sessions).set({ status: 'failed', updatedAt: timestamp })
          .where(eq(sessions.id, sessionId));
      } else {
        // Safe to mark as stopped
        await dbRecover.update(sessions).set({ status: 'stopped', updatedAt: timestamp })
          .where(eq(sessions.id, sessionId));
      }
    } catch (dbError) {
      logError('Failed to update session status after auto-close error', dbError, { module: 'services/agent/runner' });
    }
  }
}
