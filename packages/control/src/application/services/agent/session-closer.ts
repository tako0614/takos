/**
 * Agent Runner のセッション自動クローズ処理。
 *
 * 成功時にはセッション変更（スナップショット作成 + ファイル同期）をコミットし、
 * 失敗時には変更を破棄する。チャンク処理でメモリ使用量を抑え、段階を意識した
 * ロールバックでエラー時の復旧を行う。
 */

import type { Env } from '../../../shared/types/index.ts';
import type { AgentContext, AgentEvent } from './agent-models.ts';
import { SnapshotManager } from '../sync/snapshot.ts';
import { generateId } from '../../../shared/utils/index.ts';
import { getDb, sessions, accounts, accountMetadata, files, runs } from '../../../infra/db/index.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { callRuntimeRequest } from '../execution/runtime-request-handler.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';
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

/** `autoCloseSession` と `commitSession` で共有する変更フェーズ追跡用トラッカー。 */
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
 * セッション変更をコミットする。スナップショット作成とワークスペースへの
 * ファイル同期を行う。
 * ファイルはチャンク処理してメモリ使用量を抑える。
 * 共有 `tracker` を更新し、エラー時に呼び出し元が正しいフェーズを通知できるようにする。
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

  // セッション情報を取得する
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
    // 停止状態を記録したまま処理を進める
    await db.update(sessions).set({ status: 'stopped', updatedAt: timestamp })
      .where(eq(sessions.id, sessionId));
    return;
  }

  const snapshot = await snapshotResponse.json() as {
    files: Array<{ path: string; content: string; size: number }>;
  };

  tracker.current = 'BLOB_WRITE';

  // ツリーを作成し、SnapshotManager で blob を保存する
  // 大規模ワークスペースでのメモリ枯渇を避けるためチャンク処理する
  const snapshotManager = new SnapshotManager(deps.env, deps.context.spaceId);
  const tree: Record<string, { hash: string; size: number; mode: number; type: 'file' | 'symlink' }> = {};

  // ファイルをチャンク処理してメモリ使用を制限する。
  // 各チャンク内では writeBlob を並列実行してレイテンシを下げる。
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
      // GC 負荷を下げるため、処理済みの content 参照をクリアする
      (file as { content: string | null }).content = null;
    }));
  }

  // 元の files 配列を解放してメモリを解放する
  snapshot.files.length = 0;

  // 新規スナップショットを作成する
  const newSnapshot = await snapshotManager.createSnapshot(
    tree,
    [session.baseSnapshotId],
    'Auto-committed by agent',
    'ai'
  );
  tracker.snapshotCreated = true;

  tracker.current = 'FILE_SYNC';

  // 再起動時に一部失敗を検知するため、同期中フラグを保存する
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

  // files テーブルを snapshot と同期する（container_commit と同様）
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

  // ツリーエントリをチャンクで処理する
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
        // 新規ファイルなので insert
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
        // 更新ファイルなので update
        updateOps.push({ path, sha256: entry.hash, size: entry.size });
        chunkOps.push({ type: 'update', path, oldHash: existingHash });
      }
      // 削除検知用に対象を map から除外する
      currentFileMap.delete(path);
    }

    // このチャンクの処理を実行する
    try {
      // 新規ファイルを作成する
      if (createOps.length > 0) {
        await db.insert(files).values(createOps);
      }

      // ファイル更新は D1 がトランザクション未対応のため逐次実行
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

  // 削除対象をチャンク処理する
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

  // イベント送信に使う件数をカウントする
  const fileCount = Object.keys(tree).length;

  // D1 がトランザクション未対応のため、ワークスペースとセッションは順次更新する
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
 * 実行完了後にセッションを自動クローズする。
 * 成功時は変更（スナップショット作成 + ファイル同期）をコミットする。
 * 失敗時は破損防止のため変更を破棄する。
 * チャンク処理とフェーズ付きロールバックを使用する。
 */
export async function autoCloseSession(
  deps: SessionCloserDeps,
  status: 'completed' | 'failed',
): Promise<void> {
  // DB から最新の session_id を取得する（container_start で設定されている場合がある）
  const sessionId = await deps.getCurrentSessionId();
  if (!sessionId) {
    return; // No session to close
  }

  if (!deps.env.RUNTIME_HOST) {
    logWarn('RUNTIME_HOST binding is missing, cannot auto-close session', { module: 'services/agent/runner' });
    return;
  }

  const timestamp = new Date().toISOString();

  // 共有フェーズトラッカー: commitSession がエラー時に正確なフェーズを返却できるようにする
  const tracker: PhaseTracker = {
    current: 'INIT',
    snapshotCreated: false,
    filesModified: 0,
  };

  try {
    const db = getDb(deps.db);

    if (status === 'completed') {
      // 成功時: スナップショットを取得してワークスペースへコミット
      await commitSession(deps, sessionId, db, timestamp, tracker);
    } else {
      // 失敗時: 廃棄としてマークする
      await db.update(sessions).set({ status: 'discarded', updatedAt: timestamp })
        .where(eq(sessions.id, sessionId));

      await deps.emitEvent('progress', {
        message: 'Session discarded due to error',
        session_action: 'discarded',
      });
    }

    tracker.current = 'CLEANUP';

    // 実行時セッションを破棄する
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

    // 監視・アラート用に構造化してエラーログを出す
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

    // 呼び出し元に失敗を通知するイベントを emit する
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

    // 自動クローズの失敗フェーズを run のエラーフィールドに記録する（診断用）
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

    // フェーズを意識したロールバック／リカバリ
    try {
      const dbRecover = getDb(deps.db);
      if (tracker.current === 'FILE_SYNC' && tracker.filesModified > 0) {
        // ファイル同期が部分的な場合は、再利用防止のためセッションをエラー状態にする
        logWarn(`Partial file sync detected (${tracker.filesModified} ops). Marking session as error state.`, { module: 'services/agent/runner' });
        await dbRecover.update(sessions).set({ status: 'failed', updatedAt: timestamp })
          .where(eq(sessions.id, sessionId));
      } else {
        // 正常に停止状態へ遷移してよい
        await dbRecover.update(sessions).set({ status: 'stopped', updatedAt: timestamp })
          .where(eq(sessions.id, sessionId));
      }
    } catch (dbError) {
      logError('Failed to update session status after auto-close error', dbError, { module: 'services/agent/runner' });
    }
  }
}
