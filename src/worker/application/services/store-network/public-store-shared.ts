import { and, count, eq } from "drizzle-orm";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { getDb } from "../../../infra/db/index.ts";
import { repositories } from "../../../infra/db/schema.ts";
import { findStoreBySlug } from "./stores.ts";
import { countActiveItems, hasExplicitInventory } from "./store-inventory.ts";
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

export interface StoreRecord {
  accountId: string;
  slug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoRow {
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

export interface ExplicitInventoryRow {
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

export interface PushFeedRow {
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

export function enc(value: string): string {
  return encodeURIComponent(value);
}

export function localRepositoryUrl(
  origin: string,
  owner: string,
  repoName: string,
) {
  return `${origin}/@${enc(owner)}/${enc(repoName)}`;
}

export function localCloneUrl(origin: string, owner: string, repoName: string) {
  return `${origin}/git/${enc(owner)}/${enc(repoName)}.git`;
}

export function deriveNameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const part = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return decodeURIComponent(part).replace(/\.git$/, "");
  } catch {
    return rawUrl;
  }
}

export function parseCommits(json: string | null): StoreFeedItem["commits"] {
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

export async function findStore(
  dbBinding: SqlDatabaseBinding,
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

export function toLocalReference(
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

export function toExplicitReference(
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

export function inventoryEntryToReference(
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

export async function packageIconsForRepoIds(
  dbBinding: SqlDatabaseBinding,
  repoIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  return await resolvePackageIconsForRepos(
    dbBinding,
    repoIds.filter((id): id is string => !!id),
  );
}

export function explicitRepoId(row: ExplicitInventoryRow): string | null {
  return row.repoId ?? row.localRepoId;
}

async function countPublicReposForStore(
  dbBinding: SqlDatabaseBinding,
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
  dbBinding: SqlDatabaseBinding,
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
