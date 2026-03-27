import type { Env } from '../../../shared/types';
import { getDb, repositories, accounts, repoStars } from '../../../infra/db';
import { eq, and, desc, asc, gte, like, inArray, count } from 'drizzle-orm';
import type {
  ExploreRepoResponse,
  ExploreReposResult,
  RepositoryWithAccount,
  ParsedCatalogTags,
} from './explore-types';

// Whitelist of allowed ORDER BY columns to prevent SQL injection
export const ALLOWED_ORDER_BY_COLUMNS = {
  'updated': 'updatedAt',
  'created': 'createdAt',
  'forks': 'forks',
  'stars': 'stars',
} as const;

export function resolveOrderByColumn(sort: string): keyof typeof ALLOWED_ORDER_BY_COLUMNS | 'stars' {
  return (sort in ALLOWED_ORDER_BY_COLUMNS ? sort : 'stars') as keyof typeof ALLOWED_ORDER_BY_COLUMNS;
}

export function resolveOrderDirection(order: string): 'asc' | 'desc' {
  const direction = order.toLowerCase();
  return direction === 'asc' ? 'asc' : 'desc';
}

export function resolveAccountOwner(account: RepositoryWithAccount['account']) {
  return {
    id: account.id,
    name: account.name,
    username: account.slug,
    avatar_url: account.picture || null,
  };
}

export function parseCatalogTags(raw: string | undefined): ParsedCatalogTags {
  if (!raw) return { tags: [], invalid: false };
  const tags = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  for (const tag of tags) {
    if (tag.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      return { tags: [], invalid: true };
    }
  }
  return { tags, invalid: false };
}

export function computeTrendingScore(options: {
  stars: number;
  downloads: number;
  updatedAtMs: number;
}): number {
  const nowMs = Date.now();
  const ageDays = Math.max(0, (nowMs - options.updatedAtMs) / (1000 * 60 * 60 * 24));
  return (Math.log10(options.downloads + 1) + Math.log10(options.stars + 1)) / (ageDays + 2);
}

export async function getStarredRepoIds(
  dbBinding: Env['DB'],
  userId: string | undefined,
  repoIds: string[]
) {
  if (!userId || repoIds.length === 0) {
    return new Set<string>();
  }

  const db = getDb(dbBinding);

  const stars = await db.select({ repoId: repoStars.repoId }).from(repoStars)
    .where(and(
      eq(repoStars.accountId, userId),
      inArray(repoStars.repoId, repoIds),
    ))
    .all();

  return new Set(stars.map(s => s.repoId));
}

export function mapExploreRepos(
  repos: RepositoryWithAccount[],
  starredIds: Set<string>
): ExploreRepoResponse[] {
  return repos.map((repo) => {
    const owner = resolveAccountOwner(repo.account);
    return ({
    id: repo.id,
    name: repo.name,
    description: repo.description,
    visibility: 'public',
    default_branch: repo.defaultBranch,
    stars: repo.stars,
    forks: repo.forks,
    workspace: {
      id: repo.account.id,
      name: repo.account.name,
    },
    owner,
    is_starred: starredIds.has(repo.id),
    created_at: repo.createdAt || '',
    updated_at: repo.updatedAt || '',
  })});
}

export async function buildExploreResult(
  dbBinding: Env['DB'],
  repos: RepositoryWithAccount[],
  total: number,
  offset: number,
  userId?: string
): Promise<ExploreReposResult> {
  const starredIds = await getStarredRepoIds(
    dbBinding,
    userId,
    repos.map(repo => repo.id)
  );
  const mappedRepos = mapExploreRepos(repos, starredIds);

  return {
    repos: mappedRepos,
    total,
    has_more: offset + mappedRepos.length < total,
  };
}

// Helper to query repos with joined account info
export async function queryReposWithAccount(
  dbBinding: Env['DB'],
  options: {
    conditions: any[];
    orderBy: any[];
    limit?: number;
    offset?: number;
  }
): Promise<RepositoryWithAccount[]> {
  const db = getDb(dbBinding);
  const rows = await db.select({
    id: repositories.id,
    name: repositories.name,
    description: repositories.description,
    defaultBranch: repositories.defaultBranch,
    stars: repositories.stars,
    forks: repositories.forks,
    officialCategory: repositories.officialCategory,
    primaryLanguage: repositories.primaryLanguage,
    license: repositories.license,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
    accountId: accounts.id,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountPicture: accounts.picture,
  })
    .from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...options.conditions))
    .orderBy(...options.orderBy)
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0)
    .all();

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    defaultBranch: r.defaultBranch,
    stars: r.stars,
    forks: r.forks,
    officialCategory: r.officialCategory,
    primaryLanguage: r.primaryLanguage,
    license: r.license,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    account: {
      id: r.accountId,
      name: r.accountName,
      slug: r.accountSlug,
      picture: r.accountPicture,
    },
  }));
}

export async function countRepos(
  dbBinding: Env['DB'],
  conditions: any[]
): Promise<number> {
  const db = getDb(dbBinding);
  const result = await db.select({ count: count() })
    .from(repositories)
    .where(and(...conditions))
    .get();
  return result?.count ?? 0;
}

export function buildBaseConditions(options: {
  category?: string;
  language?: string;
  license?: string;
  since?: string;
  sinceField?: 'createdAt' | 'updatedAt';
  searchQuery?: string;
}): any[] {
  const conditions: any[] = [eq(repositories.visibility, 'public')];
  if (options.category) conditions.push(eq(repositories.officialCategory, options.category));
  if (options.language) conditions.push(eq(repositories.primaryLanguage, options.language));
  if (options.license) conditions.push(eq(repositories.license, options.license));
  if (options.since) {
    const field = options.sinceField === 'createdAt' ? repositories.createdAt : repositories.updatedAt;
    conditions.push(gte(field, options.since));
  }
  if (options.searchQuery) {
    // Note: Drizzle doesn't support OR easily at top level in conditions array,
    // so we use like on name as primary search
    conditions.push(like(repositories.name, `%${options.searchQuery}%`));
  }
  return conditions;
}
