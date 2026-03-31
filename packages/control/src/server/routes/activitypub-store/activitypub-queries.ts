import { and, count, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../infra/db';
import { accounts, branches, repositories, storeInventoryItems } from '../../../infra/db/schema';
import type { Env } from '../../../shared/types';
import { findActivityPubStoreBySlug } from '../../../application/services/activitypub/stores';
import { hasExplicitInventory, countActiveItems } from '../../../application/services/activitypub/store-inventory';

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
  defaultBranchHash: string | null;
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

  const explicit = await hasExplicitInventory(env.DB, store.accountId, store.slug);

  let publicRepoCount: number;
  if (explicit) {
    publicRepoCount = await countActiveItems(env.DB, store.accountId, store.slug);
  } else {
    const db = getDb(env.DB);
    const repoCount = await db.select({ count: count() }).from(repositories)
      .where(and(
        eq(repositories.accountId, store.accountId),
        eq(repositories.visibility, 'public'),
      ))
      .get();
    publicRepoCount = repoCount?.count ?? 0;
  }

  return {
    accountId: store.accountId,
    accountSlug: store.accountSlug,
    slug: store.slug,
    name: store.name,
    description: store.summary,
    picture: store.iconUrl,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    publicRepoCount,
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

  const explicit = await hasExplicitInventory(env.DB, store.accountId, store.slug);
  if (explicit) {
    return listExplicitInventory(env, store, options);
  }

  return listAutoInventory(env, store, options);
}

async function listAutoInventory(
  env: Pick<Env, 'DB'>,
  store: StoreRecord,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: StoreRepositoryRecord[] }> {
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
    defaultBranchHash: branches.commitSha,
    stars: repositories.stars,
    forks: repositories.forks,
    gitEnabled: repositories.gitEnabled,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .leftJoin(branches, and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)))
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
      defaultBranchHash: row.defaultBranchHash ?? null,
      gitEnabled: !!row.gitEnabled,
    })),
  };
}

async function listExplicitInventory(
  env: Pick<Env, 'DB'>,
  store: StoreRecord,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: StoreRepositoryRecord[] }> {
  const db = getDb(env.DB);

  // Join inventory items with local repos where possible
  const rows = await db.select({
    itemId: storeInventoryItems.id,
    repoActorUrl: storeInventoryItems.repoActorUrl,
    cachedName: storeInventoryItems.repoName,
    cachedSummary: storeInventoryItems.repoSummary,
    cachedOwnerSlug: storeInventoryItems.repoOwnerSlug,
    localRepoId: storeInventoryItems.localRepoId,
    itemCreatedAt: storeInventoryItems.createdAt,
    // Local repo fields (NULL if remote)
    repoId: repositories.id,
    ownerId: accounts.id,
    ownerSlug: accounts.slug,
    ownerName: accounts.name,
    repoName: repositories.name,
    repoDescription: repositories.description,
    visibility: repositories.visibility,
    defaultBranch: repositories.defaultBranch,
    defaultBranchHash: branches.commitSha,
    stars: repositories.stars,
    forks: repositories.forks,
    gitEnabled: repositories.gitEnabled,
    repoCreatedAt: repositories.createdAt,
    repoUpdatedAt: repositories.updatedAt,
  }).from(storeInventoryItems)
    .leftJoin(repositories, eq(storeInventoryItems.localRepoId, repositories.id))
    .leftJoin(accounts, eq(repositories.accountId, accounts.id))
    .leftJoin(branches, and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)))
    .where(and(
      eq(storeInventoryItems.accountId, store.accountId),
      eq(storeInventoryItems.storeSlug, store.slug),
      eq(storeInventoryItems.isActive, true),
    ))
    .orderBy(desc(storeInventoryItems.createdAt))
    .limit(options.limit)
    .offset(options.offset)
    .all();

  const items: StoreRepositoryRecord[] = rows.map((row) => {
    if (row.repoId) {
      // Local repo — use full data
      return {
        id: row.repoId,
        ownerId: row.ownerId!,
        ownerSlug: row.ownerSlug!,
        ownerName: row.ownerName!,
        name: row.repoName!,
        description: row.repoDescription,
        visibility: row.visibility!,
        defaultBranch: row.defaultBranch!,
        defaultBranchHash: row.defaultBranchHash ?? null,
        stars: row.stars!,
        forks: row.forks!,
        gitEnabled: !!row.gitEnabled,
        createdAt: row.repoCreatedAt!,
        updatedAt: row.repoUpdatedAt!,
      };
    }
    // Remote repo — use cached metadata
    return {
      id: row.itemId,
      ownerId: '',
      ownerSlug: row.cachedOwnerSlug || '',
      ownerName: row.cachedOwnerSlug || '',
      name: row.cachedName || '',
      description: row.cachedSummary,
      visibility: 'public',
      defaultBranch: 'main',
      defaultBranchHash: null,
      stars: 0,
      forks: 0,
      gitEnabled: false,
      createdAt: row.itemCreatedAt,
      updatedAt: row.itemCreatedAt,
    };
  });

  return { total: store.publicRepoCount, items };
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
      defaultBranchHash: branches.commitSha,
      stars: repositories.stars,
      forks: repositories.forks,
      gitEnabled: repositories.gitEnabled,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
    }).from(repositories)
      .innerJoin(accounts, eq(repositories.accountId, accounts.id))
      .leftJoin(branches, and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)))
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
      defaultBranchHash: row.defaultBranchHash ?? null,
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
    defaultBranchHash: branches.commitSha,
    stars: repositories.stars,
    forks: repositories.forks,
    gitEnabled: repositories.gitEnabled,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .leftJoin(branches, and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)))
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
    defaultBranchHash: row.defaultBranchHash ?? null,
    gitEnabled: !!row.gitEnabled,
  };
}

export async function findCanonicalRepo(
  env: Pick<Env, 'DB'>,
  ownerSlug: string,
  repoName: string,
): Promise<StoreRepositoryRecord | null> {
  const normalizedOwner = normalizeSlug(ownerSlug);
  const normalizedRepo = normalizeRepoName(repoName);
  if (!normalizedOwner || !normalizedRepo) {
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
    defaultBranchHash: branches.commitSha,
    stars: repositories.stars,
    forks: repositories.forks,
    gitEnabled: repositories.gitEnabled,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .leftJoin(branches, and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)))
    .where(and(
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
    defaultBranchHash: row.defaultBranchHash ?? null,
    gitEnabled: !!row.gitEnabled,
  };
}

export async function listStoresForRepo(
  env: Pick<Env, 'DB'>,
  accountId: string,
): Promise<StoreRecord[]> {
  const db = getDb(env.DB);
  const account = await db.select({ slug: accounts.slug })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
    .get();
  if (!account) return [];
  const store = await findStoreBySlug(env, account.slug);
  return store ? [store] : [];
}
