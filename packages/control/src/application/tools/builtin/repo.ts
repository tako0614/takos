import type { ToolDefinition, ToolHandler } from '../tool-definitions.ts';
import { getDb, sessionRepos, sessions, repositories } from '../../../infra/db/index.ts';
import { eq, and, asc } from 'drizzle-orm';
import { requireContainerSession } from './container/availability.ts';

export const REPO_LIST: ToolDefinition = {
  name: 'repo_list',
  description: 'List repositories mounted in the current container session.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const REPO_STATUS: ToolDefinition = {
  name: 'repo_status',
  description: 'Show the active repository for the current container session.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const REPO_SWITCH: ToolDefinition = {
  name: 'repo_switch',
  description: 'Switch the active repository in the current container session.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {
      repo_id: {
        type: 'string',
        description: 'Repository ID to make active.',
      },
    },
    required: ['repo_id'],
  },
};

export const repoListHandler: ToolHandler = async (_args, context) => {
  const sessionId = requireContainerSession(context, 'listing mounted repositories');
  const db = getDb(context.db);

  const repos = await db.select({
    repoId: sessionRepos.repoId,
    branch: sessionRepos.branch,
    mountPath: sessionRepos.mountPath,
    isPrimary: sessionRepos.isPrimary,
    repoName: repositories.name,
  }).from(sessionRepos)
    .innerJoin(repositories, eq(sessionRepos.repoId, repositories.id))
    .where(eq(sessionRepos.sessionId, sessionId))
    .orderBy(asc(sessionRepos.createdAt))
    .all();

  if (repos.length === 0) {
    return 'No repositories are mounted in this session.';
  }

  const lines = repos.map((repo) =>
    `- ${repo.repoName} (${repo.repoId}) @ ${repo.branch || 'default'} -> ${repo.mountPath || '/'}${repo.isPrimary ? ' [primary]' : ''}`
  );

  return lines.join('\n');
};

export const repoStatusHandler: ToolHandler = async (_args, context) => {
  const sessionId = requireContainerSession(context, 'checking mounted repositories');
  const db = getDb(context.db);

  const primary = await db.select({
    repoId: sessionRepos.repoId,
    branch: sessionRepos.branch,
    mountPath: sessionRepos.mountPath,
    repoName: repositories.name,
  }).from(sessionRepos)
    .innerJoin(repositories, eq(sessionRepos.repoId, repositories.id))
    .where(and(eq(sessionRepos.sessionId, sessionId), eq(sessionRepos.isPrimary, true)))
    .get();

  if (!primary) {
    return 'No active repository set for this session.';
  }

  return `Active repository:\n${primary.repoName} (${primary.repoId}) @ ${primary.branch || 'default'} -> ${primary.mountPath || '/'}`;
};

export const repoSwitchHandler: ToolHandler = async (args, context) => {
  const sessionId = requireContainerSession(context, 'switching the active repository');
  const repoId = args.repo_id as string;

  if (!repoId || typeof repoId !== 'string') {
    throw new Error('repo_id is required');
  }

  const db = getDb(context.db);
  const target = await db.select({
    id: sessionRepos.id,
    repoId: sessionRepos.repoId,
    branch: sessionRepos.branch,
    mountPath: sessionRepos.mountPath,
    repoName: repositories.name,
  }).from(sessionRepos)
    .innerJoin(repositories, eq(sessionRepos.repoId, repositories.id))
    .where(and(eq(sessionRepos.sessionId, sessionId), eq(sessionRepos.repoId, repoId)))
    .get();

  if (!target) {
    throw new Error('Repository is not mounted in this session. Use repo_list to see mounts.');
  }

  const timestamp = new Date().toISOString();

  await db.update(sessionRepos).set({ isPrimary: false }).where(and(eq(sessionRepos.sessionId, sessionId), eq(sessionRepos.isPrimary, true)));
  await db.update(sessionRepos).set({ isPrimary: true }).where(eq(sessionRepos.id, target.id));
  await db.update(sessions).set({ repoId: target.repoId, branch: target.branch, updatedAt: timestamp }).where(eq(sessions.id, sessionId));

  return `Active repository switched to ${target.repoName} (${target.repoId}) @ ${target.branch || 'default'} -> ${target.mountPath || '/'}`;
};

export const REPO_TOOLS: ToolDefinition[] = [
  REPO_LIST,
  REPO_STATUS,
  REPO_SWITCH,
];

export const REPO_HANDLERS: Record<string, ToolHandler> = {
  repo_list: repoListHandler,
  repo_status: repoStatusHandler,
  repo_switch: repoSwitchHandler,
};
