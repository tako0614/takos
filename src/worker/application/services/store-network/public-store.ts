import { and, count, desc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accounts,
  branches,
  repositories,
  storeInventoryItems,
} from "../../../infra/db/schema.ts";
import { hasExplicitInventory } from "./store-inventory.ts";
import {
  type ExplicitInventoryRow,
  explicitRepoId,
  findStore,
  getPublicStoreDocument,
  packageIconsForRepoIds,
  type PublicStoreDocument,
  type RepoRow,
  type RepositoryReference,
  type StoreRecord,
  toExplicitReference,
  toLocalReference,
} from "./public-store-shared.ts";

export type {
  PublicStoreDocument,
  RepositoryReference,
  StoreFeedItem,
} from "./public-store-shared.ts";
export { getPublicStoreDocument } from "./public-store-shared.ts";
export { listPublicStoreFeed } from "./public-store-feed.ts";

async function selectAutoInventory(
  dbBinding: SqlDatabaseBinding,
  store: StoreRecord,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: RepoRow[] }> {
  const db = getDb(dbBinding);
  const where = and(
    eq(repositories.accountId, store.accountId),
    eq(repositories.visibility, "public"),
  );
  const [rows, total] = await Promise.all([
    db.select({
      id: repositories.id,
      ownerId: accounts.id,
      ownerSlug: accounts.slug,
      ownerName: accounts.name,
      name: repositories.name,
      description: repositories.description,
      defaultBranch: repositories.defaultBranch,
      defaultBranchHash: branches.commitSha,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
    }).from(repositories)
      .innerJoin(accounts, eq(repositories.accountId, accounts.id))
      .leftJoin(
        branches,
        and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)),
      )
      .where(where)
      .orderBy(desc(repositories.updatedAt), repositories.name)
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() }).from(repositories).where(where).get(),
  ]);
  return {
    total: total?.count ?? 0,
    items: rows.map((row) => ({
      ...row,
      defaultBranchHash: row.defaultBranchHash ?? null,
    })),
  };
}

async function selectExplicitInventory(
  dbBinding: SqlDatabaseBinding,
  store: StoreRecord,
  options: { limit: number; offset: number },
  extraWhere?: SQL,
): Promise<{ total: number; items: ExplicitInventoryRow[] }> {
  const db = getDb(dbBinding);
  const baseWhere = and(
    eq(storeInventoryItems.accountId, store.accountId),
    eq(storeInventoryItems.storeSlug, store.slug),
    eq(storeInventoryItems.isActive, true),
    extraWhere,
  );

  const [rows, total] = await Promise.all([
    db.select({
      itemId: storeInventoryItems.id,
      repositoryUrl: storeInventoryItems.repoActorUrl,
      repoCloneUrl: storeInventoryItems.repoCloneUrl,
      repoBrowseUrl: storeInventoryItems.repoBrowseUrl,
      repoDefaultBranch: storeInventoryItems.repoDefaultBranch,
      repoDefaultBranchHash: storeInventoryItems.repoDefaultBranchHash,
      cachedName: storeInventoryItems.repoName,
      cachedSummary: storeInventoryItems.repoSummary,
      cachedOwnerSlug: storeInventoryItems.repoOwnerSlug,
      localRepoId: storeInventoryItems.localRepoId,
      itemCreatedAt: storeInventoryItems.createdAt,
      repoId: repositories.id,
      ownerId: accounts.id,
      ownerSlug: accounts.slug,
      ownerName: accounts.name,
      repoName: repositories.name,
      repoDescription: repositories.description,
      defaultBranch: repositories.defaultBranch,
      defaultBranchHash: branches.commitSha,
      repoCreatedAt: repositories.createdAt,
      repoUpdatedAt: repositories.updatedAt,
    }).from(storeInventoryItems)
      .leftJoin(
        repositories,
        eq(storeInventoryItems.localRepoId, repositories.id),
      )
      .leftJoin(accounts, eq(repositories.accountId, accounts.id))
      .leftJoin(
        branches,
        and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)),
      )
      .where(baseWhere)
      .orderBy(desc(storeInventoryItems.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() }).from(storeInventoryItems)
      .leftJoin(
        repositories,
        eq(storeInventoryItems.localRepoId, repositories.id),
      )
      .where(baseWhere)
      .get(),
  ]);

  return {
    total: total?.count ?? 0,
    items: rows.map((row) => ({
      ...row,
      repoCloneUrl: row.repoCloneUrl ?? null,
      repoBrowseUrl: row.repoBrowseUrl ?? null,
      repoDefaultBranch: row.repoDefaultBranch ?? null,
      repoDefaultBranchHash: row.repoDefaultBranchHash ?? null,
      repoId: row.repoId ?? null,
      ownerId: row.ownerId ?? null,
      ownerSlug: row.ownerSlug ?? null,
      ownerName: row.ownerName ?? null,
      repoName: row.repoName ?? null,
      repoDescription: row.repoDescription ?? null,
      defaultBranch: row.defaultBranch ?? null,
      defaultBranchHash: row.defaultBranchHash ?? null,
      repoCreatedAt: row.repoCreatedAt ?? null,
      repoUpdatedAt: row.repoUpdatedAt ?? null,
    })),
  };
}

export async function listPublicStoreInventory(
  dbBinding: SqlDatabaseBinding,
  origin: string,
  storeSlug: string,
  options: { limit: number; offset: number },
): Promise<
  | { store: PublicStoreDocument; total: number; items: RepositoryReference[] }
  | null
> {
  const [store, doc] = await Promise.all([
    findStore(dbBinding, storeSlug),
    getPublicStoreDocument(dbBinding, origin, storeSlug),
  ]);
  if (!store || !doc) return null;

  const explicit = await hasExplicitInventory(
    dbBinding,
    store.accountId,
    store.slug,
  );
  if (explicit) {
    const result = await selectExplicitInventory(dbBinding, store, options);
    const packageIcons = await packageIconsForRepoIds(
      dbBinding,
      result.items.map(explicitRepoId),
    );
    return {
      store: doc,
      total: result.total,
      items: result.items.map((row) =>
        toExplicitReference(
          origin,
          row,
          packageIcons.get(explicitRepoId(row) ?? "") ?? null,
        )
      ),
    };
  }

  const result = await selectAutoInventory(dbBinding, store, options);
  const packageIcons = await packageIconsForRepoIds(
    dbBinding,
    result.items.map((row) => row.id),
  );
  return {
    store: doc,
    total: result.total,
    items: result.items.map((row) =>
      toLocalReference(origin, row, packageIcons.get(row.id) ?? null)
    ),
  };
}

export async function findPublicStoreInventoryItem(
  dbBinding: SqlDatabaseBinding,
  origin: string,
  storeSlug: string,
  referenceId: string,
): Promise<RepositoryReference | null> {
  const store = await findStore(dbBinding, storeSlug);
  if (!store || !referenceId) return null;
  const explicit = await hasExplicitInventory(
    dbBinding,
    store.accountId,
    store.slug,
  );
  const db = getDb(dbBinding);

  if (explicit) {
    const result = await selectExplicitInventory(dbBinding, store, {
      limit: 1,
      offset: 0,
    }, eq(storeInventoryItems.id, referenceId));
    const row = result.items[0];
    if (!row) return null;
    const repoId = explicitRepoId(row);
    const packageIcons = await packageIconsForRepoIds(dbBinding, [repoId]);
    return toExplicitReference(
      origin,
      row,
      packageIcons.get(repoId ?? "") ?? null,
    );
  }

  const row = await db.select({
    id: repositories.id,
    ownerId: accounts.id,
    ownerSlug: accounts.slug,
    ownerName: accounts.name,
    name: repositories.name,
    description: repositories.description,
    defaultBranch: repositories.defaultBranch,
    defaultBranchHash: branches.commitSha,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .leftJoin(
      branches,
      and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)),
    )
    .where(and(
      eq(repositories.id, referenceId),
      eq(repositories.accountId, store.accountId),
      eq(repositories.visibility, "public"),
    ))
    .limit(1)
    .get();

  if (!row) return null;
  const packageIcons = await packageIconsForRepoIds(dbBinding, [row.id]);
  return toLocalReference(origin, {
    ...row,
    defaultBranchHash: row.defaultBranchHash ?? null,
  }, packageIcons.get(row.id) ?? null);
}

export async function searchPublicStoreRepositories(
  dbBinding: SqlDatabaseBinding,
  origin: string,
  storeSlug: string,
  query: string,
  options: { limit: number; offset: number },
): Promise<
  | { store: PublicStoreDocument; total: number; items: RepositoryReference[] }
  | null
> {
  const normalized = query.trim().toLowerCase();
  const [store, doc] = await Promise.all([
    findStore(dbBinding, storeSlug),
    getPublicStoreDocument(dbBinding, origin, storeSlug),
  ]);
  if (!store || !doc || !normalized) return null;

  const likePattern = `%${normalized}%`;
  const explicit = await hasExplicitInventory(
    dbBinding,
    store.accountId,
    store.slug,
  );
  if (explicit) {
    const result = await selectExplicitInventory(
      dbBinding,
      store,
      options,
      sql`(
      lower(coalesce(${storeInventoryItems.repoName}, ${repositories.name}, '')) like ${likePattern}
      or lower(coalesce(${storeInventoryItems.repoSummary}, ${repositories.description}, '')) like ${likePattern}
      or lower(coalesce(${storeInventoryItems.repoOwnerSlug}, '')) like ${likePattern}
      or lower(${storeInventoryItems.repoActorUrl}) like ${likePattern}
    )`,
    );
    const packageIcons = await packageIconsForRepoIds(
      dbBinding,
      result.items.map(explicitRepoId),
    );
    return {
      store: doc,
      total: result.total,
      items: result.items.map((row) =>
        toExplicitReference(
          origin,
          row,
          packageIcons.get(explicitRepoId(row) ?? "") ?? null,
        )
      ),
    };
  }

  const db = getDb(dbBinding);
  const where = and(
    eq(repositories.accountId, store.accountId),
    eq(repositories.visibility, "public"),
    sql`(
      lower(${repositories.name}) like ${likePattern}
      or lower(coalesce(${repositories.description}, '')) like ${likePattern}
    )`,
  );
  const [rows, total] = await Promise.all([
    db.select({
      id: repositories.id,
      ownerId: accounts.id,
      ownerSlug: accounts.slug,
      ownerName: accounts.name,
      name: repositories.name,
      description: repositories.description,
      defaultBranch: repositories.defaultBranch,
      defaultBranchHash: branches.commitSha,
      createdAt: repositories.createdAt,
      updatedAt: repositories.updatedAt,
    }).from(repositories)
      .innerJoin(accounts, eq(repositories.accountId, accounts.id))
      .leftJoin(
        branches,
        and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)),
      )
      .where(where)
      .orderBy(desc(repositories.updatedAt), repositories.name)
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() }).from(repositories).where(where).get(),
  ]);

  const packageIcons = await packageIconsForRepoIds(
    dbBinding,
    rows.map((row) => row.id),
  );

  return {
    store: doc,
    total: total?.count ?? 0,
    items: rows.map((row) =>
      toLocalReference(origin, {
        ...row,
        defaultBranchHash: row.defaultBranchHash ?? null,
      }, packageIcons.get(row.id) ?? null)
    ),
  };
}
