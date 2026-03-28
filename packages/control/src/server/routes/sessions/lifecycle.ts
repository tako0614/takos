import { getDb } from '../../../infra/db';
import { sessions, repositories } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { scheduleActionsAutoTrigger, triggerPushWorkflows } from '../../../application/services/actions';
import * as gitStore from '../../../application/services/git-smart';
import {
  RuntimeSessionManager,
  type SessionInitResult,
} from '../../../application/services/sync';
import { requireSpaceAccess } from '../shared/route-auth';
import { checkSpaceAccess, generateId, now } from '../../../shared/utils';
import { toSessionSnakeCase } from './session-mappers';
import type { SessionContext } from './session-mappers';
import { logError, logWarn } from '../../../shared/utils/logger';
import { BadRequestError, AuthorizationError, NotFoundError, InternalError } from '@takoserver/common/errors';
import {
  getPlatformConfig,
  getPlatformGitObjects,
  getPlatformRuntimeHost,
  getPlatformSqlBinding,
  getPlatformTenantSource,
  getPlatformWorkflowQueue,
} from '../../../platform/accessors.ts';
import type { RuntimeSessionManagerEnv } from '../../../application/services/sync/runtime-session';

type StartSessionBody = {
  repo_id: string;
  branch?: string;
};

type StopSessionBody = {
  commit_message?: string;
};

function buildRuntimeSessionManagerEnv(c: SessionContext): RuntimeSessionManagerEnv | null {
  const dbBinding = getPlatformSqlBinding(c);
  const runtimeHost = getPlatformRuntimeHost(c);
  if (!dbBinding || !runtimeHost) {
    return null;
  }

  return {
    DB: dbBinding,
    RUNTIME_HOST: runtimeHost,
    GIT_OBJECTS: getPlatformGitObjects(c),
    TENANT_SOURCE: getPlatformTenantSource(c),
  };
}

export async function startSession(
  c: SessionContext,
  body: StartSessionBody,
): Promise<Response> {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId') || c.req.param('workspaceId');
  if (!spaceId) throw new BadRequestError('Missing spaceId');
  const access = await requireSpaceAccess(
    c,
    spaceId,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions',
  );

  const repoId = body.repo_id;
  const branch = body.branch;
  const dbBinding = getPlatformSqlBinding(c);
  const runtimeSessionEnv = buildRuntimeSessionManagerEnv(c);

  if (!repoId) {
    throw new BadRequestError('repo_id is required');
  }
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const db = getDb(dbBinding);
  const repoInfo = await db.select({
    id: repositories.id,
    name: repositories.name,
    defaultBranch: repositories.defaultBranch,
  }).from(repositories).where(
    and(eq(repositories.id, repoId), eq(repositories.accountId, access.space.id))
  ).get();

  if (!repoInfo) {
    throw new NotFoundError('Repository');
  }

  const sessionId = generateId();
  const timestamp = now();
  await db.insert(sessions).values({
    id: sessionId,
    accountId: access.space.id,
    userAccountId: user.id,
    baseSnapshotId: 'git-mode',
    status: 'initializing',
    repoId,
    branch: branch || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (!runtimeSessionEnv) {
    throw new InternalError('RUNTIME_HOST binding is required');
  }

  let runtimeInit: SessionInitResult | null = null;
  try {
    const runtimeManager = new RuntimeSessionManager(
      runtimeSessionEnv,
      dbBinding,
      runtimeSessionEnv.GIT_OBJECTS || runtimeSessionEnv.TENANT_SOURCE,
      access.space.id,
      sessionId,
    );
    runtimeManager.setRepositoryInfo(repoId, branch || repoInfo.defaultBranch);
    runtimeInit = await runtimeManager.initSession();
  } catch (err) {
    logError('Failed to init runtime session', err, { module: 'routes/sessions-lifecycle' });
    throw new InternalError('Failed to initialize runtime session');
  }

  return c.json({
    session_id: sessionId,
    status: 'running',
    runtime_init: runtimeInit,
    git_mode: true,
    repo_id: repoId,
    repo_name: repoInfo.name,
    branch: branch || repoInfo.defaultBranch,
  }, 201);
}

export async function stopSession(
  c: SessionContext,
  body: StopSessionBody,
): Promise<Response> {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  if (!sessionId) throw new BadRequestError('Missing sessionId');
  const dbBinding = getPlatformSqlBinding(c);
  const runtimeSessionEnv = buildRuntimeSessionManagerEnv(c);
  const gitObjects = getPlatformGitObjects(c);
  const tenantSource = getPlatformTenantSource(c);
  const workflowQueue = getPlatformWorkflowQueue(c);
  const config = getPlatformConfig(c);
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }
  const db = getDb(dbBinding);
  const sessionRow = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!sessionRow) {
    throw new NotFoundError('Session');
  }

  const session = toSessionSnakeCase(sessionRow);
  const access = await requireSpaceAccess(
    c,
    session.space_id,
    user.id,
    ['owner', 'admin'],
    'Permission denied - only workspace owners and admins can stop sessions',
    403,
  );

  if (session.status !== 'running') {
    throw new BadRequestError('Session is not running');
  }

  type GitSyncResult = Awaited<ReturnType<RuntimeSessionManager['syncToGit']>>;
  let gitResult: GitSyncResult | null = null;

  if (!session.repo_id) {
    throw new BadRequestError('Session is not Git-based');
  }
  const repoId = session.repo_id;

  const repo = await db.select({ defaultBranch: repositories.defaultBranch }).from(repositories).where(eq(repositories.id, repoId)).get();
  const syncBranch = session.branch || repo?.defaultBranch || 'main';

  let pushBeforeSha: string | null = null;
  try {
    const branch = await gitStore.getBranch(dbBinding, repoId, syncBranch);
    pushBeforeSha = branch?.commit_sha || null;
  } catch (err) {
    logWarn(`Failed to resolve branch state before sync for ${repoId}/${syncBranch}`, { module: 'routes/sessions-lifecycle', detail: err });
  }

  if (!runtimeSessionEnv) {
    throw new InternalError('RUNTIME_HOST binding is required for session sync');
  }

  try {
    const runtimeManager = new RuntimeSessionManager(
      runtimeSessionEnv,
      dbBinding,
      runtimeSessionEnv.GIT_OBJECTS || runtimeSessionEnv.TENANT_SOURCE,
      session.space_id,
      sessionId,
    );
    runtimeManager.setRepositoryInfo(repoId, syncBranch);

    const commitMessage = body.commit_message || `Session ${sessionId.slice(0, 8)} changes`;
    gitResult = await runtimeManager.syncToGit(commitMessage, {
      name: user.name || 'Takos Agent',
      email: user.email || 'agent@takos.io',
    });

    if (!gitResult.success && gitResult.error) {
      logError('Failed to sync to Git', gitResult.error, { module: 'routes/sessions-lifecycle' });
    }
  } catch (err) {
    logError('Failed to commit to Git', err, { module: 'routes/sessions-lifecycle' });
    throw new InternalError('Failed to commit changes to Git');
  }

  await db.update(sessions).set({ status: 'stopped', updatedAt: now() }).where(eq(sessions.id, sessionId));

  if (gitResult?.success && gitResult.pushed && gitResult.commitHash) {
    const afterSha = gitResult.commitHash;
    scheduleActionsAutoTrigger(
      c.executionCtx,
      () => triggerPushWorkflows(
        {
          db: dbBinding,
          bucket: gitObjects || tenantSource,
          queue: workflowQueue,
          encryptionKey: config.encryptionKey,
        },
        {
          repoId,
          branch: syncBranch,
          before: pushBeforeSha,
          after: afterSha,
          actorId: user.id,
          actorName: user.name,
          actorEmail: user.email,
        },
      ),
      `sessions.stop.sync-to-git repo=${repoId} branch=${syncBranch}`,
    );
  }

  return c.json({
    success: true,
    git_mode: true,
    repo_id: repoId,
    branch: syncBranch,
    git_result: gitResult,
  });
}

export async function resumeSession(c: SessionContext): Promise<Response> {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  if (!sessionId) throw new BadRequestError('Missing sessionId');
  const dbBinding = getPlatformSqlBinding(c);
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }
  const db = getDb(dbBinding);
  const sessionRow = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!sessionRow) {
    throw new NotFoundError('Session');
  }

  const access = await requireSpaceAccess(
    c,
    sessionRow.accountId,
    user.id,
    ['owner', 'admin'],
    'Permission denied - only workspace owners and admins can resume sessions',
    403,
  );

  if (sessionRow.status !== 'stopped') {
    throw new BadRequestError('Session is not stopped');
  }

  await db.update(sessions).set({ status: 'running', updatedAt: now() }).where(eq(sessions.id, sessionId));

  return c.json({
    success: true,
    session_id: sessionId,
    base_snapshot_id: sessionRow.baseSnapshotId,
    head_snapshot_id: sessionRow.headSnapshotId,
    status: 'running',
  });
}

export async function discardSession(c: SessionContext): Promise<Response> {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  if (!sessionId) throw new BadRequestError('Missing sessionId');
  const dbBinding = getPlatformSqlBinding(c);
  const runtimeSessionEnv = buildRuntimeSessionManagerEnv(c);
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }
  const db = getDb(dbBinding);
  const sessionRow = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!sessionRow) {
    throw new NotFoundError('Session');
  }

  const access = await checkSpaceAccess(dbBinding, sessionRow.accountId, user.id, ['owner', 'admin']);
  if (!access) {
    throw new AuthorizationError('Permission denied - only workspace owners and admins can discard sessions');
  }

  if (sessionRow.status === 'merged') {
    throw new BadRequestError('Cannot discard a merged session');
  }

  await db.update(sessions).set({ status: 'discarded', updatedAt: now() }).where(eq(sessions.id, sessionId));

  if (runtimeSessionEnv) {
    try {
      const runtimeManager = new RuntimeSessionManager(
        runtimeSessionEnv,
        dbBinding,
        runtimeSessionEnv.GIT_OBJECTS || runtimeSessionEnv.TENANT_SOURCE,
        sessionRow.accountId,
        sessionId,
      );
      await runtimeManager.destroySession();
    } catch (err) {
      logError('Failed to destroy runtime session', err, { module: 'routes/sessions-lifecycle' });
    }
  }

  return c.json({ success: true });
}
