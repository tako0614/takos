/**
 * Remote Install Service — installs repositories from remote Store Network stores
 * into the local workspace by creating a local repo and cloning via git smart HTTP.
 */

import type { D1Database } from "../../../shared/types/bindings.ts";
import { generateId, sanitizeRepoName } from "../../../shared/utils/index.ts";
import { getDb, repositories } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import {
  fetchRemoteRepositories,
  type RemoteRepository,
} from "./remote-store-client.ts";
import { getRegistryEntry } from "./store-registry.ts";

export interface RemoteStoreRepositoryImportInput {
  /** Store registry entry ID */
  registryEntryId: string;
  /** Repository URL or inventory item ID from the remote inventory/search result */
  repositoryRefUrl?: string;
  /** Local name override */
  localName?: string;
}

export interface RemoteStoreRepositoryImportResult {
  repositoryId: string;
  name: string;
  cloneUrl: string;
  remoteStoreUrl: string;
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

  const requestedRef = input.repositoryRefUrl;
  if (!requestedRef) {
    throw new Error("repository_ref_url is required");
  }

  const remoteRepo = await findRepositoryInRemoteInventory(
    entry.repositoriesUrl,
    requestedRef,
  );
  if (!remoteRepo) {
    throw new Error(
      "Remote repository is not present in the selected store inventory",
    );
  }

  if (!remoteRepo.cloneUrl) {
    throw new Error("Remote repository does not expose a clone URL");
  }

  // 3. Determine local repo name
  const localName = sanitizeRepoName(
    input.localName || remoteRepo.name ||
      deriveRepoName(remoteRepo.repositoryUrl || requestedRef),
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
    remoteStoreUrl: entry.actorUrl,
    remoteBrowseUrl: remoteRepo.browseUrl || remoteRepo.url ||
      remoteRepo.repositoryUrl || requestedRef,
  };
}

export const installFromRemoteStore = importRepositoryFromRemoteStore;

export async function repositoryIsInRemoteInventory(
  repositoriesUrl: string,
  repositoryRefUrl: string,
): Promise<boolean> {
  return !!(await findRepositoryInRemoteInventory(
    repositoriesUrl,
    repositoryRefUrl,
  ));
}

export async function findRepositoryInRemoteInventory(
  repositoriesUrl: string,
  repositoryRefUrl: string,
): Promise<RemoteRepository | null> {
  const limit = 100;
  const maxPages = 50;
  let seenItems = 0;

  for (let page = 1; page <= maxPages; page++) {
    const collection = await fetchRemoteRepositories(repositoriesUrl, {
      page,
      limit,
    });
    const items = collection.items ?? collection.orderedItems ?? [];

    const found = items.find((item) =>
      item.id === repositoryRefUrl ||
      item.repositoryUrl === repositoryRefUrl ||
      item.url === repositoryRefUrl
    );
    if (found) {
      return found;
    }

    seenItems += items.length;
    if (items.length === 0 || seenItems >= collection.totalItems) {
      return null;
    }
  }

  throw new Error("Remote store inventory is too large to verify membership");
}

function deriveDefaultBranch(repo: RemoteRepository): string {
  return repo.defaultBranch || "main";
}

function deriveRepoName(repositoryUrl: string): string {
  try {
    const url = new URL(repositoryUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch {
    return "";
  }
}
