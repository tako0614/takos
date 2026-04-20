/**
 * Remote Install Service — installs repositories from remote ActivityPub stores
 * into the local workspace by creating a local repo and cloning via git smart HTTP.
 */

import type { D1Database } from "../../../shared/types/bindings.ts";
import { generateId, sanitizeRepoName } from "../../../shared/utils/index.ts";
import { getDb, repositories } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import {
  fetchRemoteRepositories,
  fetchRemoteRepositoryActor,
  type RemoteRepository,
} from "./remote-store-client.ts";
import { getRegistryEntry } from "./store-registry.ts";

export interface RemoteStoreRepositoryImportInput {
  /** Store registry entry ID */
  registryEntryId: string;
  /** Canonical Repository actor URL from the remote inventory/search result */
  canonicalRepoUrl: string;
  /** Local name override */
  localName?: string;
}

export interface RemoteStoreRepositoryImportResult {
  repositoryId: string;
  name: string;
  cloneUrl: string;
  remoteStoreActorUrl: string;
  remoteBrowseUrl: string | null;
}

/**
 * Install a repository from a remote store.
 *
 * Creates a local repository record pointing to the remote clone URL.
 * The actual git data is fetched lazily on first access via the remote's
 * git smart HTTP endpoint (cloneUri).
 */
export async function importRepositoryFromRemoteStore(
  dbBinding: D1Database,
  accountId: string,
  input: RemoteStoreRepositoryImportInput,
): Promise<RemoteStoreRepositoryImportResult> {
  // 1. Look up registry entry
  const entry = await getRegistryEntry(
    dbBinding,
    accountId,
    input.registryEntryId,
  );
  if (!entry) {
    throw new Error("Remote store not found in registry");
  }

  if (!entry.repositoriesUrl) {
    throw new Error("Remote store does not expose an inventory endpoint");
  }

  const belongsToInventory = await repositoryIsInRemoteInventory(
    entry.repositoriesUrl,
    input.canonicalRepoUrl,
  );
  if (!belongsToInventory) {
    throw new Error(
      "Remote repository is not present in the selected store inventory",
    );
  }

  // 2. Fetch the canonical repo actor to get clone metadata. The registry
  // entry scopes which remote Store this import belongs to; the repo itself is
  // identified by its canonical actor URL, not a Store-local owner/name path.
  const remoteRepo = await fetchRemoteRepositoryActor(input.canonicalRepoUrl);

  if (!remoteRepo.cloneUrl) {
    throw new Error("Remote repository does not expose a clone URL");
  }

  // 3. Determine local repo name
  const localName = sanitizeRepoName(
    input.localName || remoteRepo.name ||
      deriveRepoName(input.canonicalRepoUrl),
  );
  if (!localName) {
    throw new Error("Remote repository name could not be derived");
  }

  // 4. Check for name collision
  const db = getDb(dbBinding);
  const existing = await db.select({ id: repositories.id })
    .from(repositories)
    .where(and(
      eq(repositories.accountId, accountId),
      eq(repositories.name, localName),
    ))
    .limit(1)
    .get();

  if (existing) {
    throw new Error(
      `A repository named "${localName}" already exists in this workspace`,
    );
  }

  // 5. Create local repository record
  const repoId = generateId();
  const timestamp = new Date().toISOString();

  await db.insert(repositories).values({
    id: repoId,
    accountId,
    name: localName,
    description: remoteRepo.summary || null,
    visibility: "private",
    defaultBranch: deriveDefaultBranch(remoteRepo),
    stars: 0,
    forks: 0,
    gitEnabled: true,
    remoteCloneUrl: remoteRepo.cloneUrl,
    remoteStoreActorUrl: entry.actorUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    repositoryId: repoId,
    name: localName,
    cloneUrl: remoteRepo.cloneUrl,
    remoteStoreActorUrl: entry.actorUrl,
    remoteBrowseUrl: remoteRepo.browseUrl || remoteRepo.url ||
      input.canonicalRepoUrl,
  };
}

export const installFromRemoteStore = importRepositoryFromRemoteStore;

export async function repositoryIsInRemoteInventory(
  repositoriesUrl: string,
  canonicalRepoUrl: string,
): Promise<boolean> {
  const limit = 100;
  const maxPages = 50;
  let seenItems = 0;

  for (let page = 1; page <= maxPages; page++) {
    const collection = await fetchRemoteRepositories(repositoriesUrl, {
      page,
      limit,
      expand: false,
    });
    const items = collection.orderedItems ?? [];

    if (
      items.some((item) =>
        item.id === canonicalRepoUrl || item.url === canonicalRepoUrl
      )
    ) {
      return true;
    }

    seenItems += items.length;
    if (items.length === 0 || seenItems >= collection.totalItems) {
      return false;
    }
  }

  throw new Error("Remote store inventory is too large to verify membership");
}

function deriveDefaultBranch(repo: RemoteRepository): string {
  if (repo.defaultBranchRef?.startsWith("refs/heads/")) {
    return repo.defaultBranchRef.slice("refs/heads/".length);
  }
  return repo.defaultBranch || "main";
}

function deriveRepoName(canonicalRepoUrl: string): string {
  try {
    const url = new URL(canonicalRepoUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch {
    return "";
  }
}
