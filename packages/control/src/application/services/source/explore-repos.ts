import type { Env } from '../../../shared/types';
import { repositories } from '../../../infra/db';
import { desc, asc } from 'drizzle-orm';
import type { ExploreReposResult } from './explore-types';
import {
  ALLOWED_ORDER_BY_COLUMNS,
  resolveOrderByColumn,
  resolveOrderDirection,
  buildBaseConditions,
  queryReposWithAccount,
  countRepos,
  buildExploreResult,
} from './source-exploration';

export async function listExploreRepos(
  dbBinding: Env['DB'],
  options: {
    sort: string;
    order: string;
    limit: number;
    offset: number;
    searchQuery: string;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const sortKey = resolveOrderByColumn(options.sort);
  const orderDirection = resolveOrderDirection(options.order);

  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'updatedAt',
    searchQuery: options.searchQuery || undefined,
  });

  const orderByMap = {
    'updatedAt': repositories.updatedAt,
    'createdAt': repositories.createdAt,
    'forks': repositories.forks,
    'stars': repositories.stars,
  } as const;
  const col = orderByMap[ALLOWED_ORDER_BY_COLUMNS[sortKey as keyof typeof ALLOWED_ORDER_BY_COLUMNS] as keyof typeof orderByMap] ?? repositories.stars;
  const orderByClause = orderDirection === 'asc' ? asc(col) : desc(col);

  const [repos, total] = await Promise.all([
    queryReposWithAccount(dbBinding, {
      conditions,
      orderBy: [orderByClause],
      limit: options.limit,
      offset: options.offset,
    }),
    countRepos(dbBinding, conditions),
  ]);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listTrendingRepos(
  dbBinding: Env['DB'],
  options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString();
  const updatedSince = options.since && options.since > sevenDaysAgoStr ? options.since : sevenDaysAgoStr;

  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: updatedSince,
    sinceField: 'updatedAt',
  });

  const repos = await queryReposWithAccount(dbBinding, {
    conditions,
    orderBy: [desc(repositories.stars), desc(repositories.updatedAt)],
    limit: options.limit,
    offset: options.offset,
  });

  const total = await countRepos(dbBinding, conditions);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listNewRepos(
  dbBinding: Env['DB'],
  options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'createdAt',
  });

  const [repos, total] = await Promise.all([
    queryReposWithAccount(dbBinding, {
      conditions,
      orderBy: [desc(repositories.createdAt)],
      limit: options.limit,
      offset: options.offset,
    }),
    countRepos(dbBinding, conditions),
  ]);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}

export async function listRecentRepos(
  dbBinding: Env['DB'],
  options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
  }
): Promise<ExploreReposResult> {
  const conditions = buildBaseConditions({
    category: options.category,
    language: options.language,
    license: options.license,
    since: options.since,
    sinceField: 'updatedAt',
  });

  const [repos, total] = await Promise.all([
    queryReposWithAccount(dbBinding, {
      conditions,
      orderBy: [desc(repositories.updatedAt)],
      limit: options.limit,
      offset: options.offset,
    }),
    countRepos(dbBinding, conditions),
  ]);

  return buildExploreResult(
    dbBinding,
    repos,
    total,
    options.offset,
    options.userId
  );
}
