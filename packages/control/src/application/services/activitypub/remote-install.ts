/**
 * Remote Install Service — installs repositories from remote ActivityPub stores
 * into the local workspace by creating a local repo and cloning via git smart HTTP.
 */

import type { D1Database } from '../../../shared/types/bindings.ts';
import { generateId, sanitizeRepoName } from '../../../shared/utils';
import { getDb, repositories } from '../../../infra/db';
import { eq, and } from 'drizzle-orm';
import {
  apFetch,
  searchRemoteRepositories,
  extractTkgField,
  RemoteStoreError,
  type RemoteRepository,
} from './remote-store-client';
import { getRegistryEntry, type StoreRegistryEntry } from './store-registry';

export interface RemoteInstallInput {
  /** Store registry entry ID */
  registryEntryId: string;
  /** Owner slug on the remote store */
  remoteOwner: string;
  /** Repository name on the remote store */
  remoteRepoName: string;
  /** Local name override */
  localName?: string;
}

export interface RemoteInstallResult {
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
 * git smart HTTP endpoint (tkg:cloneUrl).
 */
export async function installFromRemoteStore(
  dbBinding: D1Database,
  accountId: string,
  input: RemoteInstallInput,
): Promise<RemoteInstallResult> {
  // 1. Look up registry entry
  const entry = await getRegistryEntry(dbBinding, accountId, input.registryEntryId);
  if (!entry) {
    throw new Error('Remote store not found in registry');
  }

  if (!entry.repositoriesUrl) {
    throw new Error('Remote store does not expose a repositories endpoint');
  }

  // 2. Fetch the specific repo from the remote store to get its clone URL
  const remoteRepo = await findRemoteRepository(entry, input.remoteOwner, input.remoteRepoName);
  if (!remoteRepo) {
    throw new Error(
      `Repository "${input.remoteOwner}/${input.remoteRepoName}" not found on remote store "${entry.name}"`,
    );
  }

  if (!remoteRepo.cloneUrl) {
    throw new Error('Remote repository does not expose a clone URL');
  }

  // 3. Determine local repo name
  const localName = sanitizeRepoName(input.localName || remoteRepo.name);

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
    throw new Error(`A repository named "${localName}" already exists in this workspace`);
  }

  // 5. Create local repository record
  const repoId = generateId();
  const timestamp = new Date().toISOString();

  await db.insert(repositories).values({
    id: repoId,
    accountId,
    name: localName,
    description: remoteRepo.summary || null,
    visibility: 'private',
    defaultBranch: remoteRepo.defaultBranch || 'main',
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
    remoteBrowseUrl: remoteRepo.browseUrl || null,
  };
}

/**
 * Find a specific repository on a remote store by owner/name.
 */
async function findRemoteRepository(
  entry: StoreRegistryEntry,
  owner: string,
  repoName: string,
): Promise<RemoteRepository | null> {
  if (!entry.repositoriesUrl) return null;

  // Try the direct repository URL pattern first
  const directUrl = `${entry.actorUrl}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`;
  try {
    const response = await apFetch(directUrl);
    if (response.ok) {
      const body = await response.json() as Record<string, unknown>;
      return {
        id: String(body.id ?? ''),
        type: body.type as string | string[],
        name: String(body.name ?? ''),
        summary: String(body.summary ?? ''),
        url: String(body.url ?? ''),
        published: String(body.published ?? ''),
        updated: String(body.updated ?? ''),
        attributedTo: String(body.attributedTo ?? ''),
        owner: extractTkgField(body, 'owner'),
        visibility: extractTkgField(body, 'visibility'),
        defaultBranch: extractTkgField(body, 'defaultBranch'),
        cloneUrl: extractTkgField(body, 'cloneUrl'),
        browseUrl: extractTkgField(body, 'browseUrl'),
      };
    }
  } catch {
    // Fall through to search
  }

  // Fallback: search by name using the correct search function
  if (entry.searchUrl) {
    const collection = await searchRemoteRepositories(entry.searchUrl, repoName, {
      page: 1,
      limit: 10,
      expand: true,
    });
    if (collection.orderedItems) {
      return collection.orderedItems.find(
        (r) => r.name.toLowerCase() === repoName.toLowerCase(),
      ) ?? null;
    }
  }

  return null;
}
