/**
 * Session management for the agent workflow system.
 *
 * Handles starting runtime sessions, snapshotting workspace state,
 * and committing session results back to the account.
 */

import type { SnapshotTree } from '../sync/models';
import type { WorkflowContext, RuntimeSnapshotResponse } from './workflow-types';
import { SnapshotManager } from '../sync/snapshot';
import { generateId } from '../../../shared/utils';
import { getDb, sessions, accounts, runs } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { callRuntimeRequest } from '../execution/runtime-request-handler';
import { logError } from '../../../shared/utils/logger';

// ── Session start ───────────────────────────────────────────────────────

export async function startWorkflowSession(
  context: WorkflowContext,
  needsRuntime: boolean
): Promise<{ sessionId: string; snapshotId: string }> {
  const { env, spaceId, runId } = context;
  const db = getDb(env.DB);
  const timestamp = new Date().toISOString();

  const workspace = await db.select({
    headSnapshotId: accounts.headSnapshotId,
  }).from(accounts).where(eq(accounts.id, spaceId)).get();

  const baseSnapshotId = workspace?.headSnapshotId || '';
  const sessionId = generateId();

  await db.insert(sessions).values({
    id: sessionId,
    accountId: spaceId,
    baseSnapshotId,
    status: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.update(runs).set({ sessionId }).where(eq(runs.id, runId));

  if (needsRuntime) {
    if (!env.RUNTIME_HOST) {
      throw new Error('RUNTIME_HOST binding is required when needsRuntime is true');
    }

    const snapshotManager = new SnapshotManager(env, spaceId);
    const tree = baseSnapshotId
      ? await snapshotManager.getTree(baseSnapshotId)
      : await snapshotManager.createTreeFromWorkspace();

    const files: Array<{ path: string; content: string }> = [];
    const blobFetcher = snapshotManager.createBlobFetcher();

    for (const [path, entry] of Object.entries(tree)) {
      const content = await blobFetcher(entry.hash);
      if (content) {
        files.push({ path, content });
      }
    }

    await callRuntimeRequest(env, '/session/init', {
      method: 'POST',
      body: {
        session_id: sessionId,
        space_id: spaceId,
        files,
      },
    });
  }

  return { sessionId, snapshotId: baseSnapshotId };
}

// ── Session commit ──────────────────────────────────────────────────────

export async function commitWorkflowSession(
  context: WorkflowContext,
  message: string
): Promise<{ snapshotId: string; hash?: string }> {
  const { env, spaceId, sessionId } = context;
  const db = getDb(env.DB);

  if (!sessionId) {
    throw new Error('No session to commit');
  }

  const timestamp = new Date().toISOString();
  const snapshotManager = new SnapshotManager(env, spaceId);

  const session = await db.select({
    baseSnapshotId: sessions.baseSnapshotId,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const tree: SnapshotTree = {};

  if (env.RUNTIME_HOST) {
    const BLOB_CHUNK_SIZE = 50;

    try {
      const response = await callRuntimeRequest(env, '/session/snapshot', {
        method: 'POST',
        body: {
          session_id: sessionId,
          space_id: spaceId,
        },
      });

      if (response.ok) {
        const snapshot = await response.json() as RuntimeSnapshotResponse;

        for (let i = 0; i < snapshot.files.length; i += BLOB_CHUNK_SIZE) {
          const chunk = snapshot.files.slice(i, i + BLOB_CHUNK_SIZE);

          for (const file of chunk) {
            const { hash, size } = await snapshotManager.writeBlob(file.content);
            tree[file.path] = {
              hash,
              size,
              mode: 0o644,
              type: 'file',
            };
            (file as { content: string | null }).content = null;
          }
        }

        snapshot.files.length = 0;
      }
    } catch (error) {
      logError('Failed to get runtime snapshot', error, { module: 'services/agent/workflow-session' });
    }
  }

  const newSnapshot = await snapshotManager.createSnapshot(
    tree,
    session.baseSnapshotId ? [session.baseSnapshotId] : [],
    message,
    'ai'
  );

  await db.update(sessions).set({ status: 'stopped', headSnapshotId: newSnapshot.id, updatedAt: timestamp })
    .where(eq(sessions.id, sessionId));
  await db.update(accounts).set({ headSnapshotId: newSnapshot.id, updatedAt: timestamp })
    .where(eq(accounts.id, spaceId));

  await snapshotManager.completeSnapshot(newSnapshot.id);

  return { snapshotId: newSnapshot.id };
}
