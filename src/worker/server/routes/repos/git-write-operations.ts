import * as gitStore from "../../../application/services/takos-git/index.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import {
  type GitBucket,
  type RepoBucketBinding,
  toGitBucket,
} from "./routes.ts";

export interface FileEntry {
  path: string;
  content: string;
}

interface BlobEntry {
  path: string;
  sha: string;
}

interface BaseWriteOptions {
  db: AuthenticatedRouteEnv["Bindings"]["DB"];
  bucket: RepoBucketBinding;
  repoId: string;
  files: FileEntry[];
  user: { id: string; name: string; email: string };
}

interface CommitFilesOptions extends BaseWriteOptions {
  message: string;
}

interface ImportFilesOptions extends BaseWriteOptions {
  message: string;
  appendMode: boolean;
}

function buildCommitSignature(
  user: { name: string; email: string },
): gitStore.GitSignature {
  return {
    name: user.name || "User",
    email: user.email || "user@takos.jp",
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: "+0000",
  };
}

async function uploadFilesToBlobs(
  bucket: GitBucket,
  files: FileEntry[],
): Promise<BlobEntry[]> {
  const entries: BlobEntry[] = [];
  for (const file of files) {
    const content = Uint8Array.from(
      atob(file.content),
      (ch) => ch.charCodeAt(0),
    );
    const sha = await gitStore.putBlob(bucket, content);
    entries.push({ path: file.path, sha });
  }
  return entries;
}

export async function importFilesToDefaultBranch(
  options: ImportFilesOptions,
): Promise<{ commitSha: string; fileCount: number }> {
  const bucket = toGitBucket(options.bucket);
  const branch = await gitStore.getDefaultBranch(options.db, options.repoId);
  if (!branch) {
    throw new Error("Repository not initialized");
  }

  const fileEntries = await uploadFilesToBlobs(bucket, options.files);

  let treeSha: string;
  if (options.appendMode) {
    const currentCommit = await gitStore.getCommit(
      options.db,
      bucket,
      options.repoId,
      branch.commit_sha,
    );
    if (!currentCommit) {
      throw new Error("Current commit not found");
    }
    const changes = fileEntries.map((file) => ({
      path: file.path,
      operation: "add" as const,
      sha: file.sha,
    }));
    treeSha = await gitStore.applyTreeChanges(
      bucket,
      currentCommit.tree,
      changes,
    );
  } else {
    treeSha = await gitStore.buildTreeFromPaths(bucket, fileEntries);
  }

  const signature = buildCommitSignature(options.user);
  const commit = await gitStore.createCommit(
    options.db,
    bucket,
    options.repoId,
    {
      tree: treeSha,
      parents: [branch.commit_sha],
      message: options.message,
      author: signature,
      committer: signature,
    },
  );

  const updateResult = await gitStore.updateBranch(
    options.db,
    options.repoId,
    branch.name,
    branch.commit_sha,
    commit.sha,
  );
  if (!updateResult.success) {
    const reason = updateResult.error || "unknown reason";
    throw new Error(
      `Failed to update branch ${branch.name} of repo ${options.repoId} (expected=${branch.commit_sha}, target=${commit.sha}): ${reason}`,
    );
  }

  return {
    commitSha: commit.sha,
    fileCount: fileEntries.length,
  };
}

export async function commitFilesToDefaultBranch(
  options: CommitFilesOptions,
): Promise<{ commitSha: string }> {
  const bucket = toGitBucket(options.bucket);
  const branch = await gitStore.getDefaultBranch(options.db, options.repoId);
  if (!branch) {
    throw new Error("Repository not initialized");
  }

  const fileEntries = await uploadFilesToBlobs(bucket, options.files);
  const treeSha = await gitStore.buildTreeFromPaths(bucket, fileEntries);

  const signature = buildCommitSignature(options.user);
  const commit = await gitStore.createCommit(
    options.db,
    bucket,
    options.repoId,
    {
      tree: treeSha,
      parents: [branch.commit_sha],
      message: options.message,
      author: signature,
      committer: signature,
    },
  );

  const updateResult = await gitStore.updateBranch(
    options.db,
    options.repoId,
    branch.name,
    branch.commit_sha,
    commit.sha,
  );
  if (!updateResult.success) {
    const reason = updateResult.error || "unknown reason";
    throw new Error(
      `Failed to update branch ${branch.name} of repo ${options.repoId} (expected=${branch.commit_sha}, target=${commit.sha}): ${reason}`,
    );
  }

  return { commitSha: commit.sha };
}
