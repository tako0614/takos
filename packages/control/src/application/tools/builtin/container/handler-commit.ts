import type { ToolHandler } from '../../tool-definitions';
import { RuntimeSessionManager } from '../../../services/sync';
import { getDb, sessions, sessionRepos, repositories, accounts } from '../../../../infra/db';
import { eq, and, asc } from 'drizzle-orm';
import {
  callSessionApi,
  checkSessionHealth,
  validateStringInput,
} from './session';
import { appendContainerStartFailureContext } from './availability';
import { logError } from '../../../../shared/utils/logger';

export const containerCommitHandler: ToolHandler = async (args, context) => {
  const rawMessage = validateStringInput(args.message, 'message');
  const targetRepoId = validateStringInput(args.repo_id, 'repo_id');
  const message = rawMessage || 'Container changes applied';

  if (!context.sessionId) {
    throw new Error(
      appendContainerStartFailureContext(
        context,
        'No container is running. Nothing to commit.',
        'Resolve that error and call container_start again if you still need a new container.'
      )
    );
  }

  if (!context.env.RUNTIME_HOST) {
    throw new Error('RUNTIME_HOST binding is required.');
  }

  const health = await checkSessionHealth(context.db, context.sessionId);

  if (!health.session) {
    throw new Error('Container session not found in database.');
  }

  if (!health.isHealthy) {
    if (health.reason === 'session_dead' || health.reason === 'heartbeat_timeout') {
      throw new Error(`Container is DEAD (runtime session lost). Last heartbeat: ${health.session.last_heartbeat || 'never'}. Cannot commit changes.`);
    }
    throw new Error(`Container is not running (status: ${health.session.status}).`);
  }

  const db = getDb(context.db);
  const sessionData = await db.select({ status: sessions.status, repoId: sessions.repoId, branch: sessions.branch })
    .from(sessions).where(eq(sessions.id, context.sessionId)).get();

  if (!sessionData) {
    throw new Error('Container session not found in database.');
  }

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
    .where(eq(sessionRepos.sessionId, context.sessionId))
    .orderBy(asc(sessionRepos.createdAt))
    .all();

  let reposToCommit = mountedRepos.map((repo) => ({
    repoId: repo.repoId,
    repoName: repo.repoName,
    branch: repo.branch || undefined,
    mountPath: repo.mountPath,
    isPrimary: repo.isPrimary,
  }));

  if (reposToCommit.length === 0 && sessionData.repoId) {
    const repo = await db.select({ name: repositories.name, defaultBranch: repositories.defaultBranch })
      .from(repositories).where(eq(repositories.id, sessionData.repoId)).get();
    if (repo) {
      reposToCommit = [{
        repoId: sessionData.repoId,
        repoName: repo.name,
        branch: sessionData.branch || repo.defaultBranch,
        mountPath: '',
        isPrimary: true,
      }];
    }
  }

  if (reposToCommit.length === 0) {
    throw new Error('No repositories are mounted in this session.');
  }

  if (targetRepoId) {
    reposToCommit = reposToCommit.filter((repo) => repo.repoId === targetRepoId);
    if (reposToCommit.length === 0) {
      throw new Error('Requested repository is not mounted in this session.');
    }
  }

  const runtimeManager = new RuntimeSessionManager(
    context.env,
    context.db,
    context.storage,
    context.spaceId,
    context.sessionId
  );

  let author: { name: string; email: string } | undefined;
  if (context.userId) {
    const user = await db.select({ name: accounts.name, email: accounts.email })
      .from(accounts).where(eq(accounts.id, context.userId)).get();
    if (user) {
      author = {
        name: user.name || 'Takos Agent',
        email: user.email ?? 'noreply@takos.local',
      };
    }
  }

  const results: Array<{ repoId: string; repoName: string; branch: string; commitHash?: string; committed: boolean; error?: string }> = [];

  for (const repo of reposToCommit) {
    const snapshot = await runtimeManager.getSnapshot({
      path: repo.mountPath || undefined,
      includeBinary: true,
    });

    const gitResult = await runtimeManager.syncSnapshotToRepo(snapshot, {
      repoId: repo.repoId,
      repoName: repo.repoName,
      branch: repo.branch,
      pathPrefix: repo.mountPath,
      message,
      author,
    });

    results.push({
      repoId: repo.repoId,
      repoName: repo.repoName,
      branch: repo.branch || 'default',
      commitHash: gitResult.commitHash,
      committed: gitResult.committed,
      error: gitResult.error,
    });
  }

  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    const details = failures.map((f) => `${f.repoName}: ${f.error}`).join('\n');
    const committedLines = results
      .filter((result) => result.committed && !result.error)
      .map((result) => `- ${result.repoName} (${result.repoId}) @ ${result.branch}: ${result.commitHash}`)
      .join('\n') || 'None';
    throw new Error(
      `Failed to commit some repositories (session remains running):\n${details}\n\nCommitted:\n${committedLines}\n\nRetry with container_commit(repo_id: "...")`
    );
  }

  const timestamp = new Date().toISOString();

  await db.update(sessions).set({ status: 'stopped', updatedAt: timestamp })
    .where(eq(sessions.id, context.sessionId));

  try {
    await callSessionApi(context, '/session/destroy');
  } catch (e) {
    logError('Failed to destroy runtime session', e, { module: 'tools/builtin/container/handler-commit' });
  }

  context.setSessionId(undefined);

  const committed = results.filter((result) => result.committed);
  if (committed.length === 0) {
    return `Container stopped.\n\nNo changes to commit - repositories are up to date.`;
  }

  const lines = committed
    .map((result) => `- ${result.repoName} (${result.repoId}) @ ${result.branch}: ${result.commitHash}`)
    .join('\n');

  return `Container changes pushed to git!\n\n${lines}\n\nMessage: ${message}\n\nChanges have been pushed to the repository.`;
};
