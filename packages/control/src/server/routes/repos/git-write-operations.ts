import type { ExecutionContext } from '../../../shared/types/bindings.ts';
import * as gitStore from '../../../application/services/git-smart';
import { scheduleActionsAutoTrigger, triggerPushWorkflows } from '../../../application/services/actions';
import type { AuthenticatedRouteEnv } from '../shared/helpers';
import { toGitBucket, type RepoBucketBinding, type GitBucket } from './base';

type WorkflowTriggerBucket = NonNullable<
  NonNullable<Parameters<typeof triggerPushWorkflows>[0]['bucket']>
>;

export interface FileEntry {
  path: string;
  content: string;
}

interface BlobEntry {
  path: string;
  sha: string;
}

interface PushTriggerParams {
  repoId: string;
  branchName: string;
  before: string;
  after: string;
  user: { id: string; name: string; email: string };
}

interface BaseWriteOptions {
  db: AuthenticatedRouteEnv['Bindings']['DB'];
  bucket: RepoBucketBinding;
  repoId: string;
  files: FileEntry[];
  user: { id: string; name: string; email: string };
  executionCtx: ExecutionContext;
  workflowQueue: AuthenticatedRouteEnv['Bindings']['WORKFLOW_QUEUE'];
  encryptionKey: string | undefined;
}

interface CommitFilesOptions extends BaseWriteOptions {
  message: string;
}

interface ImportFilesOptions extends BaseWriteOptions {
  message: string;
  appendMode: boolean;
}

function toWorkflowTriggerBucket(
  bucket: AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS'],
): WorkflowTriggerBucket | undefined {
  return bucket as unknown as WorkflowTriggerBucket | undefined;
}

function buildCommitSignature(
  user: { name: string; email: string },
): gitStore.GitSignature {
  return {
    name: user.name || 'User',
    email: user.email || 'user@takos.dev',
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: '+0000',
  };
}

async function uploadFilesToBlobs(
  bucket: GitBucket,
  files: FileEntry[],
): Promise<BlobEntry[]> {
  const entries: BlobEntry[] = [];
  for (const file of files) {
    const content = Uint8Array.from(atob(file.content), (ch) => ch.charCodeAt(0));
    const sha = await gitStore.putBlob(bucket, content);
    entries.push({ path: file.path, sha });
  }
  return entries;
}

function schedulePushTrigger(
  options: Pick<BaseWriteOptions, 'db' | 'bucket' | 'executionCtx' | 'workflowQueue' | 'encryptionKey'>,
  params: PushTriggerParams,
  label: string,
): void {
  scheduleActionsAutoTrigger(
    options.executionCtx,
    () => triggerPushWorkflows(
      {
        db: options.db,
        bucket: toWorkflowTriggerBucket(options.bucket),
        queue: options.workflowQueue,
        encryptionKey: options.encryptionKey,
      },
      {
        repoId: params.repoId,
        branch: params.branchName,
        before: params.before,
        after: params.after,
        actorId: params.user.id,
        actorName: params.user.name,
        actorEmail: params.user.email,
      },
    ),
    label,
  );
}

export async function importFilesToDefaultBranch(
  options: ImportFilesOptions,
): Promise<{ commitSha: string; fileCount: number }> {
  const bucket = toGitBucket(options.bucket);
  const branch = await gitStore.getDefaultBranch(options.db, options.repoId);
  if (!branch) {
    throw new Error('Repository not initialized');
  }

  const fileEntries = await uploadFilesToBlobs(bucket, options.files);

  let treeSha: string;
  if (options.appendMode) {
    const currentCommit = await gitStore.getCommit(options.db, bucket, options.repoId, branch.commit_sha);
    if (!currentCommit) {
      throw new Error('Current commit not found');
    }
    const changes = fileEntries.map((file) => ({
      path: file.path,
      operation: 'add' as const,
      sha: file.sha,
    }));
    treeSha = await gitStore.applyTreeChanges(bucket, currentCommit.tree, changes);
  } else {
    treeSha = await gitStore.buildTreeFromPaths(bucket, fileEntries);
  }

  const signature = buildCommitSignature(options.user);
  const commit = await gitStore.createCommit(options.db, bucket, options.repoId, {
    tree: treeSha,
    parents: [branch.commit_sha],
    message: options.message,
    author: signature,
    committer: signature,
  });

  const updateResult = await gitStore.updateBranch(
    options.db,
    options.repoId,
    branch.name,
    branch.commit_sha,
    commit.sha,
  );
  if (!updateResult.success) {
    throw new Error(updateResult.error || 'Failed to update branch');
  }

  schedulePushTrigger(
    options,
    {
      repoId: options.repoId,
      branchName: branch.name,
      before: branch.commit_sha,
      after: commit.sha,
      user: options.user,
    },
    `repos.gitStore.import repo=${options.repoId} branch=${branch.name}`,
  );

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
    throw new Error('Repository not initialized');
  }

  const fileEntries = await uploadFilesToBlobs(bucket, options.files);
  const treeSha = await gitStore.buildTreeFromPaths(bucket, fileEntries);

  const signature = buildCommitSignature(options.user);
  const commit = await gitStore.createCommit(options.db, bucket, options.repoId, {
    tree: treeSha,
    parents: [branch.commit_sha],
    message: options.message,
    author: signature,
    committer: signature,
  });

  const updateResult = await gitStore.updateBranch(
    options.db,
    options.repoId,
    branch.name,
    branch.commit_sha,
    commit.sha,
  );
  if (!updateResult.success) {
    throw new Error(updateResult.error || 'Failed to update branch');
  }

  schedulePushTrigger(
    options,
    {
      repoId: options.repoId,
      branchName: branch.name,
      before: branch.commit_sha,
      after: commit.sha,
      user: options.user,
    },
    `repos.gitStore.commit repo=${options.repoId} branch=${branch.name}`,
  );

  return { commitSha: commit.sha };
}
