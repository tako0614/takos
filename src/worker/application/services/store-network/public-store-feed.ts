import { and, count, desc, eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accounts,
  branches,
  repoPushActivities,
  repositories,
  storeInventoryItems,
} from "../../../infra/db/schema.ts";
import { listInventoryActivities } from "./store-inventory.ts";
import { DELETE_REF } from "./push-activities.ts";
import { hasExplicitInventory } from "./store-inventory.ts";
import {
  findStore,
  getPublicStoreDocument,
  inventoryEntryToReference,
  localCloneUrl,
  localRepositoryUrl,
  packageIconsForRepoIds,
  parseCommits,
  type PublicStoreDocument,
  type PushFeedRow,
  type RepositoryReference,
  type StoreFeedItem,
  type StoreRecord,
  toLocalReference,
} from "./public-store-shared.ts";

const pushFeedSelection = {
  id: repoPushActivities.id,
  repoId: repoPushActivities.repoId,
  accountId: repoPushActivities.accountId,
  ref: repoPushActivities.ref,
  beforeSha: repoPushActivities.beforeSha,
  afterSha: repoPushActivities.afterSha,
  pusherActorUrl: repoPushActivities.pusherActorUrl,
  pusherName: repoPushActivities.pusherName,
  commitCount: repoPushActivities.commitCount,
  commitsJson: repoPushActivities.commitsJson,
  createdAt: repoPushActivities.createdAt,
  snapshotOwnerSlug: repoPushActivities.repoOwnerSlug,
  snapshotName: repoPushActivities.repoName,
  snapshotSummary: repoPushActivities.repoSummary,
  snapshotVisibility: repoPushActivities.repoVisibility,
  snapshotDefaultBranch: repoPushActivities.repoDefaultBranch,
  snapshotDefaultBranchHash: repoPushActivities.repoDefaultBranchHash,
  snapshotCreatedAt: repoPushActivities.repoCreatedAt,
  snapshotUpdatedAt: repoPushActivities.repoUpdatedAt,
  currentRepoId: repositories.id,
  currentOwnerSlug: accounts.slug,
  currentName: repositories.name,
  currentDescription: repositories.description,
  currentDefaultBranch: repositories.defaultBranch,
  currentDefaultBranchHash: branches.commitSha,
  currentCreatedAt: repositories.createdAt,
  currentUpdatedAt: repositories.updatedAt,
};

function currentRepositoryExists(): SQL {
  return sql`${repositories.id} is not null`;
}

function deleteSnapshotExists(): SQL {
  return sql`${repoPushActivities.repoName} is not null`;
}

async function selectAutoPushActivitiesForFeed(
  dbBinding: SqlDatabaseBinding,
  store: StoreRecord,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: PushFeedRow[] }> {
  const db = getDb(dbBinding);
  const repoJoin = and(
    eq(repositories.id, repoPushActivities.repoId),
    eq(repositories.accountId, store.accountId),
  );
  const where = and(
    eq(repoPushActivities.accountId, store.accountId),
    or(
      and(currentRepositoryExists(), eq(repositories.visibility, "public")),
      and(
        eq(repoPushActivities.ref, DELETE_REF),
        eq(repoPushActivities.repoVisibility, "public"),
        deleteSnapshotExists(),
      ),
    ),
  );

  const [rows, total] = await Promise.all([
    db.select(pushFeedSelection).from(repoPushActivities)
      .leftJoin(repositories, repoJoin)
      .leftJoin(accounts, eq(repositories.accountId, accounts.id))
      .leftJoin(
        branches,
        and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)),
      )
      .where(where)
      .orderBy(desc(repoPushActivities.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() }).from(repoPushActivities)
      .leftJoin(repositories, repoJoin)
      .where(where)
      .get(),
  ]);

  return {
    total: total?.count ?? 0,
    items: rows.map(normalizePushFeedRow),
  };
}

async function selectExplicitPushActivitiesForFeed(
  dbBinding: SqlDatabaseBinding,
  store: StoreRecord,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: PushFeedRow[] }> {
  const db = getDb(dbBinding);
  const inventoryJoin = and(
    eq(storeInventoryItems.localRepoId, repoPushActivities.repoId),
    eq(storeInventoryItems.accountId, store.accountId),
    eq(storeInventoryItems.storeSlug, store.slug),
    eq(storeInventoryItems.isActive, true),
  );
  const repoJoin = and(
    eq(repositories.id, repoPushActivities.repoId),
    eq(repositories.accountId, store.accountId),
  );
  const where = and(
    eq(repoPushActivities.accountId, store.accountId),
    or(
      currentRepositoryExists(),
      and(
        eq(repoPushActivities.ref, DELETE_REF),
        deleteSnapshotExists(),
      ),
    ),
  );

  const [rows, total] = await Promise.all([
    db.select(pushFeedSelection).from(repoPushActivities)
      .innerJoin(storeInventoryItems, inventoryJoin)
      .leftJoin(repositories, repoJoin)
      .leftJoin(accounts, eq(repositories.accountId, accounts.id))
      .leftJoin(
        branches,
        and(eq(branches.repoId, repositories.id), eq(branches.isDefault, true)),
      )
      .where(where)
      .orderBy(desc(repoPushActivities.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() }).from(repoPushActivities)
      .innerJoin(storeInventoryItems, inventoryJoin)
      .leftJoin(repositories, repoJoin)
      .where(where)
      .get(),
  ]);

  return {
    total: total?.count ?? 0,
    items: rows.map(normalizePushFeedRow),
  };
}

function normalizePushFeedRow(row: PushFeedRow): PushFeedRow {
  return {
    ...row,
    beforeSha: row.beforeSha ?? null,
    pusherActorUrl: row.pusherActorUrl ?? null,
    pusherName: row.pusherName ?? null,
    commitsJson: row.commitsJson ?? null,
    snapshotOwnerSlug: row.snapshotOwnerSlug ?? null,
    snapshotName: row.snapshotName ?? null,
    snapshotSummary: row.snapshotSummary ?? null,
    snapshotVisibility: row.snapshotVisibility ?? null,
    snapshotDefaultBranch: row.snapshotDefaultBranch ?? null,
    snapshotDefaultBranchHash: row.snapshotDefaultBranchHash ?? null,
    snapshotCreatedAt: row.snapshotCreatedAt ?? null,
    snapshotUpdatedAt: row.snapshotUpdatedAt ?? null,
    currentRepoId: row.currentRepoId ?? null,
    currentOwnerSlug: row.currentOwnerSlug ?? null,
    currentName: row.currentName ?? null,
    currentDescription: row.currentDescription ?? null,
    currentDefaultBranch: row.currentDefaultBranch ?? null,
    currentDefaultBranchHash: row.currentDefaultBranchHash ?? null,
    currentCreatedAt: row.currentCreatedAt ?? null,
    currentUpdatedAt: row.currentUpdatedAt ?? null,
  };
}

function pushRowToReference(
  origin: string,
  row: PushFeedRow,
  packageIcon: string | null,
): RepositoryReference | null {
  if (row.currentRepoId) {
    const ownerSlug = row.currentOwnerSlug ?? row.snapshotOwnerSlug;
    const name = row.currentName ?? row.snapshotName;
    if (!ownerSlug || !name) return null;
    return toLocalReference(origin, {
      id: row.currentRepoId,
      ownerId: row.accountId,
      ownerSlug,
      ownerName: ownerSlug,
      name,
      description: row.currentDescription ?? row.snapshotSummary,
      defaultBranch: row.currentDefaultBranch ??
        row.snapshotDefaultBranch ??
        "main",
      defaultBranchHash: row.currentDefaultBranchHash ??
        row.snapshotDefaultBranchHash,
      createdAt: row.currentCreatedAt ?? row.snapshotCreatedAt ?? row.createdAt,
      updatedAt: row.currentUpdatedAt ?? row.snapshotUpdatedAt ?? row.createdAt,
    }, packageIcon);
  }

  if (row.ref !== DELETE_REF || !row.snapshotOwnerSlug || !row.snapshotName) {
    return null;
  }

  return {
    id: row.repoId,
    owner: row.snapshotOwnerSlug,
    name: row.snapshotName,
    summary: row.snapshotSummary,
    repository_url: localRepositoryUrl(
      origin,
      row.snapshotOwnerSlug,
      row.snapshotName,
    ),
    clone_url: localCloneUrl(origin, row.snapshotOwnerSlug, row.snapshotName),
    browse_url: localRepositoryUrl(
      origin,
      row.snapshotOwnerSlug,
      row.snapshotName,
    ),
    default_branch: row.snapshotDefaultBranch,
    default_branch_hash: row.snapshotDefaultBranchHash,
    package_icon: null,
    source: "local",
    created_at: row.snapshotCreatedAt ?? row.createdAt,
    updated_at: row.snapshotUpdatedAt ?? row.createdAt,
  };
}

export async function listPublicStoreFeed(
  dbBinding: SqlDatabaseBinding,
  origin: string,
  storeSlug: string,
  options: { limit: number; offset: number },
): Promise<
  { store: PublicStoreDocument; total: number; items: StoreFeedItem[] } | null
> {
  const [store, doc] = await Promise.all([
    findStore(dbBinding, storeSlug),
    getPublicStoreDocument(dbBinding, origin, storeSlug),
  ]);
  if (!store || !doc) return null;

  const mergeLimit = options.limit + options.offset;
  const explicit = await hasExplicitInventory(
    dbBinding,
    store.accountId,
    store.slug,
  );

  const inventoryActivities = explicit
    ? await listInventoryActivities(dbBinding, store.accountId, store.slug, {
      limit: mergeLimit,
      offset: 0,
    })
    : { total: 0, items: [] };

  const pushActivities = explicit
    ? await selectExplicitPushActivitiesForFeed(dbBinding, store, {
      limit: mergeLimit,
      offset: 0,
    })
    : await selectAutoPushActivitiesForFeed(dbBinding, store, {
      limit: mergeLimit,
      offset: 0,
    });
  const packageIcons = await packageIconsForRepoIds(
    dbBinding,
    pushActivities.items.map((row) => row.currentRepoId),
  );

  const inventoryFeed: StoreFeedItem[] = inventoryActivities.items.map((
    item,
  ) => ({
    id: item.id,
    type: item.activityType === "Remove" ? "inventory.remove" : "inventory.add",
    published: item.createdAt,
    repository: inventoryEntryToReference(item),
  }));

  const pushFeed: StoreFeedItem[] = pushActivities.items.flatMap((row) => {
    const reference = pushRowToReference(
      origin,
      row,
      row.currentRepoId ? packageIcons.get(row.currentRepoId) ?? null : null,
    );
    if (!reference) return [];
    const type = row.ref === DELETE_REF
      ? "repo.delete"
      : row.ref.startsWith("refs/tags/")
      ? "repo.tag"
      : "repo.push";
    return [{
      id: row.id,
      type,
      published: row.createdAt,
      repository: reference,
      ref: row.ref === DELETE_REF ? undefined : row.ref,
      before_hash: row.beforeSha,
      after_hash: row.afterSha || null,
      commit_count: row.commitCount,
      commits: parseCommits(row.commitsJson),
    }];
  });

  const items = [...inventoryFeed, ...pushFeed]
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(options.offset, options.offset + options.limit);

  return {
    store: doc,
    total: inventoryActivities.total + pushActivities.total,
    items,
  };
}
