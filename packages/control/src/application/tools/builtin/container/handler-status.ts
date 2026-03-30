import type { ToolHandler } from '../../tool-definitions';
import { getDb, sessions, sessionRepos, repositories } from '../../../../infra/db';
import { eq, asc } from 'drizzle-orm';
import { callSessionApi, checkSessionHealth } from './session';
import { buildContainerStatusUnavailableMessage } from './availability';

export const containerStatusHandler: ToolHandler = async (_args, context) => {
  if (!context.sessionId) {
    return buildContainerStatusUnavailableMessage(context);
  }

  const health = await checkSessionHealth(context.db, context.sessionId);

  if (!health.session) {
    return 'Container session not found in database. Call container_start to create a new container.';
  }

  if (!health.isHealthy) {
    if (health.reason === 'session_dead' || health.reason === 'heartbeat_timeout') {
      return `Container is DEAD (runtime session lost or timed out).\n\nSession ID: ${health.session.id}\nLast heartbeat: ${health.session.last_heartbeat || 'never'}\n\nCall container_start to start a new container.`;
    }
    return `Container is not running (status: ${health.session.status}).\n\nCall container_start to start a new container.`;
  }

  const db = getDb(context.db);
  const sessionData = await db.select({
    id: sessions.id,
    accountId: sessions.accountId,
    baseSnapshotId: sessions.baseSnapshotId,
    status: sessions.status,
    lastHeartbeat: sessions.lastHeartbeat,
    createdAt: sessions.createdAt,
  }).from(sessions).where(eq(sessions.id, context.sessionId)).get();

  if (!sessionData) {
    return 'Container session not found in database. Call container_start to create a new container.';
  }

  const session = {
    id: sessionData.id,
    space_id: sessionData.accountId,
    base_snapshot_id: sessionData.baseSnapshotId,
    status: sessionData.status,
    last_heartbeat: sessionData.lastHeartbeat,
    created_at: sessionData.createdAt,
  };

  const mountedRepos = await db.select({
    id: sessionRepos.id,
    repoId: sessionRepos.repoId,
    branch: sessionRepos.branch,
    mountPath: sessionRepos.mountPath,
    isPrimary: sessionRepos.isPrimary,
    createdAt: sessionRepos.createdAt,
    repoName: repositories.name,
  }).from(sessionRepos)
    .innerJoin(repositories, eq(sessionRepos.repoId, repositories.id))
    .where(eq(sessionRepos.sessionId, session.id))
    .orderBy(asc(sessionRepos.createdAt))
    .all();

  if (!context.env.RUNTIME_HOST) {
    return `Container session exists but RUNTIME_HOST binding is missing.\n\nSession ID: ${session.id}\nStatus: ${session.status}`;
  }

  const response = await callSessionApi(context, '/session/snapshot');
  if (!response.ok) {
    const error = await response.json() as { error: string };
    return `Container is running but failed to get file list: ${error.error}`;
  }

  const snapshot = await response.json() as {
    files: Array<{ path: string; size: number }>;
    file_count: number;
  };

  const lines = [
    'Container is RUNNING',
    '',
    `Session ID: ${session.id}`,
    `Started: ${session.created_at}`,
    `Last heartbeat: ${session.last_heartbeat || 'pending'}`,
    '',
  ];

  if (mountedRepos.length > 0) {
    lines.push('Mounted repositories:');
    for (const repo of mountedRepos) {
      lines.push(`  - ${repo.repoName} (${repo.repoId}) @ ${repo.branch || 'default'} -> ${repo.mountPath || '/'}${repo.isPrimary ? ' [primary]' : ''}`);
    }
    lines.push('');
  }

  lines.push(`Files in container (${snapshot.file_count}):`);

  for (const file of snapshot.files.slice(0, 50)) {
    lines.push(`  - ${file.path} (${file.size} bytes)`);
  }

  if (snapshot.file_count > 50) {
    lines.push(`  ... and ${snapshot.file_count - 50} more files`);
  }

  lines.push('');
  lines.push('Use container_commit to save changes, or container_stop to discard.');

  return lines.join('\n');
};
