import { and, count, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../infra/db';
import { accounts, repositories } from '../../../infra/db/schema';
import type { Env } from '../../../shared/types';
import { findActivityPubStoreBySlug } from '../../../application/services/activitypub/stores';

export interface StoreRecord {
  accountId: string;
  accountSlug: string;
  slug: string;
  name: string;
  description: string | null;
  picture: string | null;
  createdAt: string;
  updatedAt: string;
  publicRepoCount: number;
  isDefault: boolean;
}

export interface StoreRepositoryRecord {
  id: string;
  ownerId: string;
  ownerSlug: string;
  ownerName: string;
  name: string;
  description: string | null;
  visibility: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  gitEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRepoName(value: string): string {
  return value.trim().toLowerCase();
}

export async function findStoreBySlug(
  env: Pick<Env, 'DB'>,
  storeSlug: string,
): Promise<StoreRecord | null> {
  const slug = normalizeSlug(storeSlug);
  if (!slug) {
    return null;
  }

  const store = await findActivityPubStoreBySlug(env.DB, slug);
  if (!store) {
    return null;
  }

  const db = getDb(env.DB);
  const repoCount = await db.select({ count: count() }).from(repositories)
    .where(and(
      eq(repositories.accountId, store.accountId),
      eq(repositories.visibility, 'public'),
    ))
    .get();

  return {
    accountId: store.accountId,
    accountSlug: store.accountSlug,
    slug: store.slug,
    name: store.name,
    description: store.summary,
    picture: store.iconUrl,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    publicRepoCount: repoCount?.count ?? 0,
    isDefault: store.isDefault,
  };
}

export async function listStoreRepositories(
  env: Pick<Env, 'DB'>,
  storeSlug: string,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: StoreRepositoryRecord[] }> {
  const store = await findStoreBySlug(env, storeSlug);
  if (!store) {
    return { total: 0, items: [] };
  }

  const db = getDb(env.DB);
  const rows = await db.select({
    id: repositories.id,
    ownerId: accounts.id,
    ownerSlug: accounts.slug,
    ownerName: accounts.name,
    name: repositories.name,
    description: repositories.description,
    visibility: repositories.visibility,
    defaultBranch: repositories.defaultBranch,
    stars: repositories.stars,
    forks: repositories.forks,
    gitEnabled: repositories.gitEnabled,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(
      eq(repositories.accountId, store.accountId),
      eq(repositories.visibility, 'public'),
    ))
    .orderBy(desc(repositories.updatedAt), desc(repositories.createdAt), repositories.name)
    .limit(options.limit)
    .offset(options.offset)
    .all();

  return {
    total: store.publicRepoCount,
    items: rows.map((row) => ({
      ...row,
      gitEnabled: !!row.gitEnabled,
    })),
  };
}

export async function searchStoreRepositories(
  env: Pick<Env, 'DB'>,
  storeSlug: string,
  query: string,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: StoreRepositoryRecord[] }> {
  const store = await findStoreBySlug(env, storeSlug);
  const normalizedQuery = query.trim().toLowerCase();
  if (!store || !normalizedQuery) {
    return { total: 0, items: [] };
  }

  const db = getDb(env.DB);
  const likePattern = `%${normalizedQuery}%`;
  const whereClause = and(
    eq(repositories.accountId, store.accountId),
    eq(repositories.visibility, 'public'),
    sql`(
      lower(${repositories.name}) like ${likePattern}
      or lower(coalesce(${repositories.description}, '')) like ${likePattern}
    )`,
  );

  const [rows, totalCount] = await Promise.all([
    db.select({
      id: repositories.id,
      ownerId: accounts.id,
      ownerSlug: accounts.slug,
      ownerName: accounts.name,
      name: repositories.name,
      description: repositories.description,
      visibility: repositories.visibility,
      defaultBranch: repositories.defaultBranch,
      stars: repositories.stars,
      forks: repositories.forks,
      gitEnabled: repositories.gitEnabled,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
    }).from(repositories)
      .innerJoin(accounts, eq(repositories.accountId, accounts.id))
      .where(whereClause)
      .orderBy(desc(repositories.updatedAt), desc(repositories.createdAt), repositories.name)
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() }).from(repositories).where(whereClause).get(),
  ]);

  return {
    total: totalCount?.count ?? 0,
    items: rows.map((row) => ({
      ...row,
      gitEnabled: !!row.gitEnabled,
    })),
  };
}

export async function findStoreRepository(
  env: Pick<Env, 'DB'>,
  storeSlug: string,
  ownerSlug: string,
  repoName: string,
): Promise<StoreRepositoryRecord | null> {
  const normalizedStore = normalizeSlug(storeSlug);
  const normalizedOwner = normalizeSlug(ownerSlug);
  const normalizedRepo = normalizeRepoName(repoName);
  if (!normalizedStore || !normalizedOwner || !normalizedRepo) {
    return null;
  }

  const store = await findStoreBySlug(env, normalizedStore);
  if (!store) {
    return null;
  }

  const db = getDb(env.DB);
  const row = await db.select({
    id: repositories.id,
    ownerId: accounts.id,
    ownerSlug: accounts.slug,
    ownerName: accounts.name,
    name: repositories.name,
    description: repositories.description,
    visibility: repositories.visibility,
    defaultBranch: repositories.defaultBranch,
    stars: repositories.stars,
    forks: repositories.forks,
    gitEnabled: repositories.gitEnabled,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(
      eq(repositories.accountId, store.accountId),
      eq(repositories.visibility, 'public'),
      sql`lower(${accounts.slug}) = ${normalizedOwner}`,
      sql`lower(${repositories.name}) = ${normalizedRepo}`,
    ))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  return {
    ...row,
    gitEnabled: !!row.gitEnabled,
  };
}
