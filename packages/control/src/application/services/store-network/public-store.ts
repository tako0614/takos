import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
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
  listInventoryItems,
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

function toLocalReference(origin: string, repo: RepoRow): RepositoryReference {
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
    source: "local",
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
  };
}

function toExplicitReference(
  origin: string,
  row: ExplicitInventoryRow,
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
    source: entry.localRepoId ? "local" : "remote",
    created_at: entry.createdAt,
    updated_at: entry.createdAt,
  };
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
  extraWhere?: ReturnType<typeof sql>,
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
    return {
      store: doc,
      total: result.total,
      items: result.items.map((row) => toExplicitReference(origin, row)),
    };
  }

  const result = await selectAutoInventory(dbBinding, store, options);
  return {
    store: doc,
    total: result.total,
    items: result.items.map((row) => toLocalReference(origin, row)),
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
    return result.items[0]
      ? toExplicitReference(origin, result.items[0])
      : null;
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

  return row
    ? toLocalReference(origin, {
      ...row,
      defaultBranchHash: row.defaultBranchHash ?? null,
    })
    : null;
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
    return {
      store: doc,
      total: result.total,
      items: result.items.map((row) => toExplicitReference(origin, row)),
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

  return {
    store: doc,
    total: total?.count ?? 0,
    items: rows.map((row) =>
      toLocalReference(origin, {
        ...row,
        defaultBranchHash: row.defaultBranchHash ?? null,
      })
    ),
  };
}

async function repoReferencesByIds(
  dbBinding: D1Database,
  origin: string,
  repoIds: string[],
): Promise<Map<string, RepositoryReference>> {
  if (repoIds.length === 0) return new Map();
  const db = getDb(dbBinding);
  const rows = await db.select({
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
    .where(inArray(repositories.id, repoIds))
    .all();

  return new Map(rows.map((row) => [
    row.id,
    toLocalReference(origin, {
      ...row,
      defaultBranchHash: row.defaultBranchHash ?? null,
    }),
  ]));
}

async function localRepoIdsForFeed(
  dbBinding: D1Database,
  store: StoreRecord,
): Promise<string[]> {
  const explicit = await hasExplicitInventory(
    dbBinding,
    store.accountId,
    store.slug,
  );
  if (explicit) {
    const active = await listInventoryItems(
      dbBinding,
      store.accountId,
      store.slug,
      {
        limit: 500,
        offset: 0,
      },
    );
    return active.items
      .map((item) => item.localRepoId)
      .filter((id): id is string => !!id);
  }

  const db = getDb(dbBinding);
  const rows = await db.select({ id: repositories.id }).from(repositories)
    .where(and(
      eq(repositories.accountId, store.accountId),
      eq(repositories.visibility, "public"),
    ))
    .limit(500)
    .all();
  return rows.map((row) => row.id);
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

  const localRepoIds = await localRepoIdsForFeed(dbBinding, store);
  const db = getDb(dbBinding);
  const pushWhere = localRepoIds.length > 0
    ? inArray(repoPushActivities.repoId, localRepoIds)
    : undefined;
  const [pushRows, pushTotal] = pushWhere
    ? await Promise.all([
      db.select().from(repoPushActivities)
        .where(pushWhere)
        .orderBy(desc(repoPushActivities.createdAt))
        .limit(mergeLimit)
        .offset(0)
        .all(),
      db.select({ count: count() }).from(repoPushActivities).where(pushWhere)
        .get(),
    ])
    : [[], { count: 0 }];

  const refsByRepoId = await repoReferencesByIds(
    dbBinding,
    origin,
    pushRows.map((row) => row.repoId),
  );

  const inventoryFeed: StoreFeedItem[] = inventoryActivities.items.map((
    item,
  ) => ({
    id: item.id,
    type: item.activityType === "Remove" ? "inventory.remove" : "inventory.add",
    published: item.createdAt,
    repository: inventoryEntryToReference(item),
  }));

  const pushFeed: StoreFeedItem[] = pushRows.flatMap((row) => {
    const reference = refsByRepoId.get(row.repoId);
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
    total: inventoryActivities.total + (pushTotal?.count ?? 0),
    items,
  };
}
