import { and, count, desc, eq, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { D1Database } from "../../../shared/types/bindings.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accounts,
  branches,
  repoPushActivities,
  repositories,
  storeInventoryItems,
} from "../../../infra/db/schema.ts";
import { findStoreBySlug } from "./stores.ts";
import {
  countActiveItems,
  hasExplicitInventory,
  listInventoryActivities,
} from "./store-inventory.ts";
import { DELETE_REF } from "./push-activities.ts";
import { resolvePackageIconsForRepos } from "./package-icons.ts";

export interface PublicStoreDocument {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  repository_count: number;
  inventory_url: string;
  search_url: string;
  feed_url: string;
  created_at: string;
  updated_at: string;
}

export interface RepositoryReference {
  id: string;
  owner: string | null;
  name: string;
  summary: string | null;
  repository_url: string;
  clone_url: string | null;
  browse_url: string | null;
  default_branch: string | null;
  default_branch_hash: string | null;
  package_icon: string | null;
  source: "local" | "remote";
  created_at: string;
  updated_at: string;
}

export interface StoreFeedItem {
  id: string;
  type:
    | "inventory.add"
    | "inventory.remove"
    | "repo.push"
    | "repo.tag"
    | "repo.delete";
  published: string;
  repository: RepositoryReference;
  ref?: string;
  before_hash?: string | null;
  after_hash?: string | null;
  commit_count?: number;
  commits?: Array<{
    hash: string;
    message: string;
    author_name: string;
    author_email: string;
    committed: string;
  }>;
}

interface StoreRecord {
  accountId: string;
  slug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RepoRow {
  id: string;
  ownerId: string;
  ownerSlug: string;
  ownerName: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  defaultBranchHash: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExplicitInventoryRow {
  itemId: string;
  repositoryUrl: string;
  repoCloneUrl: string | null;
  repoBrowseUrl: string | null;
  repoDefaultBranch: string | null;
  repoDefaultBranchHash: string | null;
  cachedName: string | null;
  cachedSummary: string | null;
  cachedOwnerSlug: string | null;
  localRepoId: string | null;
  itemCreatedAt: string;
  repoId: string | null;
  ownerId: string | null;
  ownerSlug: string | null;
  ownerName: string | null;
  repoName: string | null;
  repoDescription: string | null;
  defaultBranch: string | null;
  defaultBranchHash: string | null;
  repoCreatedAt: string | null;
  repoUpdatedAt: string | null;
}

interface PushFeedRow {
  id: string;
  repoId: string;
  accountId: string;
  ref: string;
  beforeSha: string | null;
  afterSha: string;
  pusherActorUrl: string | null;
  pusherName: string | null;
  commitCount: number;
  commitsJson: string | null;
  createdAt: string;
  snapshotOwnerSlug: string | null;
  snapshotName: string | null;
  snapshotSummary: string | null;
  snapshotVisibility: string | null;
  snapshotDefaultBranch: string | null;
  snapshotDefaultBranchHash: string | null;
  snapshotCreatedAt: string | null;
  snapshotUpdatedAt: string | null;
  currentRepoId: string | null;
  currentOwnerSlug: string | null;
  currentName: string | null;
  currentDescription: string | null;
  currentDefaultBranch: string | null;
  currentDefaultBranchHash: string | null;
  currentCreatedAt: string | null;
  currentUpdatedAt: string | null;
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function localRepositoryUrl(origin: string, owner: string, repoName: string) {
  return `${origin}/@${enc(owner)}/${enc(repoName)}`;
}

function localCloneUrl(origin: string, owner: string, repoName: string) {
  return `${origin}/git/${enc(owner)}/${enc(repoName)}.git`;
}

function deriveNameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const part = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return decodeURIComponent(part).replace(/\.git$/, "");
  } catch {
    return rawUrl;
  }
}

function parseCommits(json: string | null): StoreFeedItem["commits"] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as Array<{
      hash: string;
      message: string;
      authorName: string;
      authorEmail: string;
      committed: string;
    }>;
    return raw.map((commit) => ({
      hash: commit.hash,
      message: commit.message,
      author_name: commit.authorName,
      author_email: commit.authorEmail,
      committed: commit.committed,
    }));
  } catch {
    return [];
  }
}

async function findStore(
  dbBinding: D1Database,
  storeSlug: string,
): Promise<StoreRecord | null> {
  const store = await findStoreBySlug(dbBinding, storeSlug);
  if (!store) return null;
  return {
    accountId: store.accountId,
    slug: store.slug,
    name: store.name,
    summary: store.summary,
    iconUrl: store.iconUrl,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

function toLocalReference(
  origin: string,
  repo: RepoRow,
  packageIcon: string | null = null,
): RepositoryReference {
  return {
    id: repo.id,
    owner: repo.ownerSlug,
    name: repo.name,
    summary: repo.description,
    repository_url: localRepositoryUrl(origin, repo.ownerSlug, repo.name),
    clone_url: localCloneUrl(origin, repo.ownerSlug, repo.name),
    browse_url: localRepositoryUrl(origin, repo.ownerSlug, repo.name),
    default_branch: repo.defaultBranch,
    default_branch_hash: repo.defaultBranchHash,
    package_icon: packageIcon,
    source: "local",
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
  };
}

function toExplicitReference(
  origin: string,
  row: ExplicitInventoryRow,
  packageIcon: string | null = null,
): RepositoryReference {
  if (row.repoId) {
    return {
      id: row.itemId,
      owner: row.ownerSlug,
      name: row.repoName || row.cachedName || "",
      summary: row.repoDescription ?? row.cachedSummary,
      repository_url: row.repositoryUrl ||
        localRepositoryUrl(origin, row.ownerSlug || "", row.repoName || ""),
      clone_url: localCloneUrl(origin, row.ownerSlug || "", row.repoName || ""),
      browse_url: localRepositoryUrl(
        origin,
        row.ownerSlug || "",
        row.repoName || "",
      ),
      default_branch: row.defaultBranch,
      default_branch_hash: row.defaultBranchHash,
      package_icon: packageIcon,
      source: "local",
      created_at: row.repoCreatedAt || row.itemCreatedAt,
      updated_at: row.repoUpdatedAt || row.itemCreatedAt,
    };
  }

  return {
    id: row.itemId,
    owner: row.cachedOwnerSlug,
    name: row.cachedName || deriveNameFromUrl(row.repositoryUrl),
    summary: row.cachedSummary,
    repository_url: row.repositoryUrl,
    clone_url: row.repoCloneUrl,
    browse_url: row.repoBrowseUrl || row.repositoryUrl,
    default_branch: row.repoDefaultBranch,
    default_branch_hash: row.repoDefaultBranchHash,
    package_icon: packageIcon,
    source: "remote",
    created_at: row.itemCreatedAt,
    updated_at: row.itemCreatedAt,
  };
}

function inventoryEntryToReference(
  entry: {
    id: string;
    repositoryUrl?: string;
    repoActorUrl: string;
    repoName: string | null;
    repoSummary: string | null;
    repoOwnerSlug: string | null;
    repoCloneUrl?: string | null;
    repoBrowseUrl?: string | null;
    repoDefaultBranch?: string | null;
    repoDefaultBranchHash?: string | null;
    packageIcon?: string | null;
    localRepoId: string | null;
    createdAt: string;
  },
): RepositoryReference {
  const repositoryUrl = entry.repositoryUrl || entry.repoActorUrl;
  return {
    id: entry.id,
    owner: entry.repoOwnerSlug,
    name: entry.repoName || deriveNameFromUrl(repositoryUrl),
    summary: entry.repoSummary,
    repository_url: repositoryUrl,
    clone_url: entry.repoCloneUrl ?? null,
    browse_url: entry.repoBrowseUrl ?? repositoryUrl,
    default_branch: entry.repoDefaultBranch ?? null,
    default_branch_hash: entry.repoDefaultBranchHash ?? null,
    package_icon: entry.packageIcon ?? null,
    source: entry.localRepoId ? "local" : "remote",
    created_at: entry.createdAt,
    updated_at: entry.createdAt,
  };
}

async function packageIconsForRepoIds(
  dbBinding: D1Database,
  repoIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  return await resolvePackageIconsForRepos(
    dbBinding,
    repoIds.filter((id): id is string => !!id),
  );
}

function explicitRepoId(row: ExplicitInventoryRow): string | null {
  return row.repoId ?? row.localRepoId;
}

async function countPublicReposForStore(
  dbBinding: D1Database,
  store: StoreRecord,
): Promise<number> {
  const explicit = await hasExplicitInventory(
    dbBinding,
    store.accountId,
    store.slug,
  );
  if (explicit) {
    return countActiveItems(dbBinding, store.accountId, store.slug);
  }
  const db = getDb(dbBinding);
  const result = await db.select({ count: count() }).from(repositories)
    .where(and(
      eq(repositories.accountId, store.accountId),
      eq(repositories.visibility, "public"),
    ))
    .get();
  return result?.count ?? 0;
}

export async function getPublicStoreDocument(
  dbBinding: D1Database,
  origin: string,
  storeSlug: string,
): Promise<PublicStoreDocument | null> {
  const store = await findStore(dbBinding, storeSlug);
  if (!store) return null;
  const baseUrl = `${origin}/api/public/stores/${enc(store.slug)}`;
  return {
    id: baseUrl,
    slug: store.slug,
    name: store.name,
    summary: store.summary,
    icon_url: store.iconUrl,
    repository_count: await countPublicReposForStore(dbBinding, store),
    inventory_url: `${baseUrl}/inventory`,
    search_url: `${baseUrl}/search/repositories`,
    feed_url: `${baseUrl}/feed`,
    created_at: store.createdAt,
    updated_at: store.updatedAt,
  };
}

async function selectAutoInventory(
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
  dbBinding: D1Database,
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
