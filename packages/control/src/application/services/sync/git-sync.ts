/**
 * Git Sync Operations
 *
 * Handles Git store-based file synchronization: reading files from Git store
 * for session initialization, and committing snapshots back to the Git store.
 */

import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import { getDb, repositories } from '../../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import * as gitStore from '../git-smart/index.ts';
import { isProbablyBinaryContent } from '../../../shared/utils/content-type.ts';
import { logWarn } from '../../../shared/utils/logger.ts';
import type { SessionFileEntry, SyncResult, SessionRepoMount, SessionSnapshot } from './git-sync-types.ts';

export type { SessionFileEntry, SyncResult } from './git-sync-types.ts';

/** Extract an error message from a failed HTTP response. */
export async function extractResponseError(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body?.error === 'string') return body.error;
    return JSON.stringify(body);
  } catch {
    return `HTTP ${response.status} ${response.statusText}: ${fallbackMessage}`;
  }
}

export function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

export function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/** Build the list of file entries from a Git repository for session initialization. */
export async function buildRepoFiles(
  db: D1Database,
  bucket: R2Bucket,
  repo: SessionRepoMount
): Promise<SessionFileEntry[]> {
  const drizzle = getDb(db);

  const repoInfo = await drizzle.select({
    id: repositories.id,
    name: repositories.name,
    defaultBranch: repositories.defaultBranch,
  })
    .from(repositories)
    .where(eq(repositories.id, repo.repoId))
    .get();

  if (!repoInfo) {
    throw new Error(`Repository not found: ${repo.repoId}`);
  }

  const branchToUse = repo.branch || repoInfo.defaultBranch;
  const mountPath = (repo.mountPath || '').replace(/\/+$/, '');

  const files: SessionFileEntry[] = [];

  const commitSha = await gitStore.resolveRef(db, repo.repoId, branchToUse);
  if (!commitSha) return files;

  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) return files;

  const treeFiles = await gitStore.flattenTree(bucket, commit.tree);

  for (const file of treeFiles) {
    try {
      const blob = await gitStore.getBlob(bucket, file.sha);
      if (!blob) continue;
      const isBinary = isProbablyBinaryContent(blob);
      const encoded = isBinary
        ? toBase64(blob)
        : new TextDecoder().decode(blob);
      const filePath = mountPath ? `${mountPath}/${file.path}` : file.path;
      files.push({
        path: filePath,
        content: encoded,
        encoding: isBinary ? 'base64' : 'utf-8',
        is_binary: isBinary,
      });
    } catch (err) {
      logWarn(`Failed to fetch file ${file.path}: ${err}`, { module: 'services/sync/runtime-session' });
    }
  }

  return files;
}

/** Commit a snapshot to the Git store for a specific repository. */
export async function syncSnapshotToRepo(
  db: D1Database,
  bucket: R2Bucket,
  snapshot: SessionSnapshot,
  options: {
    repoId: string;
    repoName?: string;
    branch?: string;
    pathPrefix?: string;
    message: string;
    author?: { name: string; email: string };
  }
): Promise<SyncResult> {
  if (!options.repoId) {
    return {
      success: false,
      committed: false,
      pushed: false,
      error: 'Repository ID not set',
    };
  }

  const prefix = options.pathPrefix ? options.pathPrefix.replace(/^\/+|\/+$/g, '') : '';
  const prefixWithSlash = prefix ? `${prefix}/` : '';

  const filteredFiles = snapshot.files
    .filter((file) => {
      if (file.path === '.takos-session') return false;
      if (!prefix) return true;
      return file.path === prefix || file.path.startsWith(prefixWithSlash);
    })
    .map((file) => {
      const relativePath = prefix ? file.path.replace(prefixWithSlash, '') : file.path;
      return { ...file, path: relativePath };
    })
    .filter((file) => Boolean(file.path));

  if (filteredFiles.length === 0) {
    return {
      success: true,
      committed: false,
      pushed: false,
    };
  }

  const branchName = options.branch || 'main';
  const currentCommitSha = await gitStore.resolveRef(db, options.repoId, branchName);

  const fileEntries: Array<{ path: string; sha: string; mode?: string }> = [];

  for (const file of filteredFiles) {
    const contentBytes = file.encoding === 'base64'
      ? fromBase64(file.content)
      : new TextEncoder().encode(file.content);

    const blobSha = await gitStore.putBlob(bucket, contentBytes);

    fileEntries.push({
      path: file.path,
      sha: blobSha,
    });
  }

  const treeOid = await gitStore.buildTreeFromPaths(bucket, fileEntries);

  if (currentCommitSha) {
    const currentCommit = await gitStore.getCommitData(bucket, currentCommitSha);
    if (currentCommit && currentCommit.tree === treeOid) {
      return {
        success: true,
        committed: false,
        pushed: false,
      };
    }
  }

  const authorInfo = options.author || { name: 'Takos Agent', email: 'agent@takos.io' };
  const unixTimestamp = Math.floor(Date.now() / 1000);

  const commit = await gitStore.createCommit(db, bucket, options.repoId, {
    tree: treeOid,
    parents: currentCommitSha ? [currentCommitSha] : [],
    author: {
      name: authorInfo.name,
      email: authorInfo.email,
      timestamp: unixTimestamp,
      tzOffset: '+0000',
    },
    committer: {
      name: authorInfo.name,
      email: authorInfo.email,
      timestamp: unixTimestamp,
      tzOffset: '+0000',
    },
    message: options.message,
  });

  const commitOid = commit.sha;

  const updateResult = await gitStore.updateBranch(
    db,
    options.repoId,
    branchName,
    currentCommitSha,
    commitOid
  );

  if (!updateResult.success) {
    return {
      success: false,
      committed: true,
      commitHash: commitOid,
      pushed: false,
      error: 'Failed to update branch ref (concurrent modification)',
    };
  }

  return {
    success: true,
    committed: true,
    commitHash: commitOid,
    pushed: true,
  };
}
