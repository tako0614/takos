import type { Context } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import type { RepoAccess } from '../../../application/services/source/repos.ts';
import {
  triggerPullRequestWorkflows,
  type PullRequestWorkflowEvent,
} from '../../../application/services/actions/index.ts';
import { logError } from '../../../shared/utils/logger.ts';

// ---------------------------------------------------------------------------
// Shared helpers for triggering PR workflow events
// ---------------------------------------------------------------------------

function triggerPullRequestEventInBackground(
  c: Context<AuthenticatedRouteEnv>,
  options: {
    repoId: string;
    repoName: string;
    defaultBranch: string;
    actorId: string;
    event: PullRequestWorkflowEvent;
  }
): void {
  const task = triggerPullRequestWorkflows({
    db: c.env.DB,
    bucket: c.env.GIT_OBJECTS,
    queue: c.env.WORKFLOW_QUEUE,
    encryptionKey: c.env.ENCRYPTION_KEY,
    repoId: options.repoId,
    repoName: options.repoName,
    defaultBranch: options.defaultBranch,
    actorId: options.actorId,
    event: options.event,
  }).catch((err: unknown) => {
    logError('Failed to trigger pull_request workflows', err, { module: 'routes/pull-requests/base' });
  });

  const executionCtx = c.executionCtx;
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(task);
    return;
  }

  void task;
}

/** Trigger the PR workflow event using common repo-access fields. */
export function triggerPrEvent(
  c: Context<AuthenticatedRouteEnv>,
  repoAccess: RepoAccess,
  actorId: string,
  event: PullRequestWorkflowEvent,
): void {
  triggerPullRequestEventInBackground(c, {
    repoId: repoAccess.repo.id,
    repoName: repoAccess.repo.name,
    defaultBranch: repoAccess.repo.default_branch || 'main',
    actorId,
    event,
  });
}
