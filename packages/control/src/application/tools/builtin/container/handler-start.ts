import type { ToolHandler } from '../../tool-definitions.ts';
import { RuntimeSessionManager } from '../../../services/sync/index.ts';
import { generateId } from '../../../../shared/utils/index.ts';
import { getDb, sessions, sessionRepos, repositories, runs } from '../../../../infra/db/index.ts';
import { eq, and, asc, inArray } from 'drizzle-orm';
import {
  normalizeMountPath,
  validateStringInput,
} from './session.ts';
import { logInfo } from '../../../../shared/utils/logger.ts';

export const containerStartHandler: ToolHandler = async (args, context) => {
  context.setLastContainerStartFailure(undefined);

  let repoId = validateStringInput(args.repo_id, 'repo_id');
  const branch = validateStringInput(args.branch, 'branch');
  const repoIdsInput = Array.isArray(args.repo_ids)
    ? args.repo_ids
        .map((value) => validateStringInput(value, 'repo_id'))
        .filter((value): value is string => Boolean(value))
    : [];
  const mountsInput = Array.isArray(args.mounts) ? (args.mounts as Array<Record<string, unknown>>) : [];

  const db = getDb(context.db);
  if (context.sessionId) {
    const session = await db.select({ status: sessions.status, repoId: sessions.repoId, branch: sessions.branch })
      .from(sessions).where(eq(sessions.id, context.sessionId)).get();

    if (session?.status === 'running') {
      return `Container is already running.\n\nSession ID: ${context.sessionId}\nGit Mode: Yes (branch: ${session.branch || 'default'})\n\nYou can now use file_read, file_write, and runtime_exec.`;
    }
  }

  let newSessionId: string | undefined;

  try {
    if (!context.env.RUNTIME_HOST) {
      throw new Error('RUNTIME_HOST binding is required. Cannot start container.');
    }

    type MountRequest = {
      repoId: string;
      branch?: string;
      mountPath?: string;
      isPrimary?: boolean;
    };

    const mountRequests: MountRequest[] = [];

    if (mountsInput.length > 0) {
      for (const mount of mountsInput) {
        const mountRepoId = validateStringInput(mount.repo_id, 'repo_id');
        if (!mountRepoId) {
          throw new Error('mounts.repo_id is required');
        }
        const mountBranch = validateStringInput(mount.branch, 'branch');
        const mountPath = normalizeMountPath(mount.mount_path);
        const isPrimary = Boolean(mount.is_primary);
        mountRequests.push({
          repoId: mountRepoId,
          branch: mountBranch || undefined,
          mountPath: mountPath || undefined,
          isPrimary,
        });
      }
    } else if (repoIdsInput.length > 0) {
      repoIdsInput.forEach((id, index) => {
        mountRequests.push({
          repoId: id,
          isPrimary: index === 0,
        });
      });
    } else if (!repoId) {
      let repo = await db.select({ id: repositories.id, name: repositories.name, defaultBranch: repositories.defaultBranch })
        .from(repositories).where(and(eq(repositories.accountId, context.spaceId), eq(repositories.name, 'main'))).get() ?? undefined;

      if (!repo) {
        repo = await db.select({ id: repositories.id, name: repositories.name, defaultBranch: repositories.defaultBranch })
          .from(repositories).where(eq(repositories.accountId, context.spaceId))
          .orderBy(asc(repositories.createdAt)).limit(1).get() ?? undefined;
      }

      if (!repo) {
        throw new Error('No repository found in this workspace. Use create_repository to create one first.');
      }

      repoId = repo.id;
      mountRequests.push({
        repoId: repo.id,
        branch: branch || repo.defaultBranch,
        mountPath: '',
        isPrimary: true,
      });
    } else {
      mountRequests.push({
        repoId,
        branch: branch || undefined,
        mountPath: '',
        isPrimary: true,
      });
    }

    if (mountRequests.length === 0) {
      throw new Error('No repositories specified for container_start');
    }

    const primaryCount = mountRequests.filter((m) => m.isPrimary).length;
    if (primaryCount === 0) {
      mountRequests[0].isPrimary = true;
    } else if (primaryCount > 1) {
      throw new Error('Only one primary repository can be specified');
    }

    const repoIds = [...new Set(mountRequests.map((m) => m.repoId))];
    const repos = await db.select({ id: repositories.id, name: repositories.name, defaultBranch: repositories.defaultBranch })
      .from(repositories).where(and(eq(repositories.accountId, context.spaceId), inArray(repositories.id, repoIds))).all();
    if (repos.length !== repoIds.length) {
      throw new Error('One or more repositories were not found or do not belong to this workspace.');
    }
    const repoMap = new Map(repos.map((repo) => [repo.id, repo]));

    const usedMountPaths = new Set<string>();
    const sessionReposList: Array<{
      repoId: string;
      repoName: string;
      branch: string;
      mountPath: string;
      isPrimary: boolean;
    }> = [];

    for (const request of mountRequests) {
      const repo = repoMap.get(request.repoId);
      if (!repo) {
        throw new Error('Repository not found or does not belong to this workspace.');
      }

      let mountPath = request.mountPath ? normalizeMountPath(request.mountPath) : '';
      if (!mountPath) {
        mountPath = request.isPrimary ? '' : `repos/${repo.name}`;
      }

      let candidate = mountPath;
      let counter = 2;
      while (usedMountPaths.has(candidate)) {
        const base = mountPath || repo.name;
        candidate = `${base}-${counter}`;
        counter += 1;
      }
      mountPath = candidate;
      usedMountPaths.add(mountPath);

      sessionReposList.push({
        repoId: repo.id,
        repoName: repo.name,
        branch: request.branch || repo.defaultBranch,
        mountPath,
        isPrimary: Boolean(request.isPrimary),
      });
    }

    const primaryRepo = sessionReposList.find((repo) => repo.isPrimary) || sessionReposList[0];
    repoId = primaryRepo.repoId;

    newSessionId = generateId();
    const timestamp = new Date().toISOString();

    logInfo(`Starting container ${newSessionId} for run ${context.runId} (git mode)`, { module: 'tools/builtin/container/handler-start' });

    await db.insert(sessions).values({
      id: newSessionId,
      accountId: context.spaceId,
      userAccountId: context.userId,
      baseSnapshotId: 'git-mode',
      status: 'initializing',
      repoId: repoId,
      branch: primaryRepo.branch || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const repo of sessionReposList) {
      await db.insert(sessionRepos).values({
        id: generateId(),
        sessionId: newSessionId,
        repoId: repo.repoId,
        branch: repo.branch,
        mountPath: repo.mountPath,
        isPrimary: repo.isPrimary,
        createdAt: timestamp,
      });
    }

    await db.update(runs).set({ sessionId: newSessionId })
      .where(eq(runs.id, context.runId));

    const runtimeManager = new RuntimeSessionManager(
      context.env,
      context.db,
      context.storage,
      context.spaceId,
      newSessionId
    );

    runtimeManager.setRepositories(
      sessionReposList.map((repo) => ({
        repoId: repo.repoId,
        repoName: repo.repoName,
        branch: repo.branch,
        mountPath: repo.mountPath,
      })),
      primaryRepo.repoId
    );

    const initResult = await runtimeManager.initSession();

    context.setSessionId(newSessionId);
    context.setLastContainerStartFailure(undefined);

    logInfo(`Container ${newSessionId} started for run ${context.runId} (git: ${initResult.branch})`, { module: 'tools/builtin/container/handler-start' });

    const repoLines = sessionReposList
      .map((repo) =>
        `- ${repo.repoName} (${repo.repoId}) @ ${repo.branch} -> ${repo.mountPath || '/'}${repo.isPrimary ? ' [primary]' : ''}`
      )
      .join('\n');

    return `Container started in Git mode!\n\nSession ID: ${newSessionId}\nRepositories:\n${repoLines}\nFiles: ${initResult.file_count}\n\nYou can now use:\n- file_read / file_write / file_list (use repo_id or mount_path for multi-repo)\n- runtime_exec (npm, git, etc.)\n- repo_list / repo_switch to change the active repo\n\nWhen done, use container_commit to save and push changes!`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.setLastContainerStartFailure({
      message,
      sessionId: newSessionId,
    });
    throw error;
  }
};
