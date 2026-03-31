import type { D1Database, R2Bucket, Queue } from '../../../shared/types/bindings.ts';
import type { RepoAccess } from '../source/repos.ts';
import { logError } from '../../../shared/utils/logger.ts';
import {
  triggerPullRequestWorkflows,
  type PullRequestWorkflowEvent,
} from '../actions/index.ts';

// ---------------------------------------------------------------------------
// PR workflow event triggers
// ---------------------------------------------------------------------------

export interface PullRequestEventDeps {
  db: D1Database;
  bucket: R2Bucket | undefined;
  queue?: Queue;
  encryptionKey?: string;
}

/**
 * Create a background task that triggers pull request workflows.
 * The caller should use `executionCtx.waitUntil()` on the returned promise.
 */
export async function createPullRequestEventTask(
  deps: PullRequestEventDeps,
  options: {
    repoId: string;
    repoName: string;
    defaultBranch: string;
    actorId: string;
    event: PullRequestWorkflowEvent;
  },
): Promise<void> {
  try {
    await triggerPullRequestWorkflows({
      db: deps.db,
      bucket: deps.bucket,
      queue: deps.queue,
      encryptionKey: deps.encryptionKey,
      repoId: options.repoId,
      repoName: options.repoName,
      defaultBranch: options.defaultBranch,
      actorId: options.actorId,
      event: options.event,
    });
  } catch (err) {
    logError('Failed to trigger pull_request workflows', err, { module: 'services/pull-requests' });
  }
}

/**
 * Convenience wrapper that derives PR event options from RepoAccess.
 */
export function createPullRequestEventTaskFromAccess(
  deps: PullRequestEventDeps,
  repoAccess: RepoAccess,
  actorId: string,
  event: PullRequestWorkflowEvent,
): Promise<void> {
  return createPullRequestEventTask(deps, {
    repoId: repoAccess.repo.id,
    repoName: repoAccess.repo.name,
    defaultBranch: repoAccess.repo.default_branch || 'main',
    actorId,
    event,
  });
}
