import { generateId } from '../../../shared/utils';
import type { Env, SpaceRole, RunQueueMessage } from '../../../shared/types';
import { RUN_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import { checkThreadAccess } from '../threads/thread-service';
import { buildRunFailedPayload } from '../run-notifier';
import { persistAndEmitEvent } from './run-events';
import {
  checkRunRateLimits,
  createPendingRun,
  getRunResponse,
  getRunHierarchyNode,
  updateRunStatus,
} from '../runs/create-thread-run-store';
import { resolveRunModel, validateParentRunId } from '../runs/create-thread-run-validation';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { logError } from '../../../shared/utils/logger';

type CreateThreadRunInput = {
  userId: string;
  threadId: string;
  agentType?: string;
  input?: Record<string, unknown>;
  parentRunId?: string;
  model?: string;
};

type CreateThreadRunError = {
  ok: false;
  status: 400 | 404 | 429 | 500;
  error: string;
};

type CreateThreadRunSuccess = {
  ok: true;
  status: 201;
  run: Awaited<ReturnType<typeof getRunResponse>>;
};

export type CreateThreadRunResult = CreateThreadRunError | CreateThreadRunSuccess;

export async function createThreadRun(env: Env, input: CreateThreadRunInput): Promise<CreateThreadRunResult> {
  const access = await checkThreadAccess(
    env.DB,
    input.threadId,
    input.userId,
    ['owner', 'admin', 'editor'] satisfies SpaceRole[],
  );
  if (!access) {
    return { ok: false, status: 404, error: 'Thread not found or insufficient permissions' };
  }

  const spaceId = access.thread.space_id;
  const rateLimitCheck = await checkRunRateLimits(env.DB, input.userId, spaceId, {
    isChildRun: !!input.parentRunId,
  });
  if (!rateLimitCheck.allowed) {
    return { ok: false, status: 429, error: rateLimitCheck.reason || 'Rate limit exceeded' };
  }

  let parentRun = null;
  if (input.parentRunId) {
    if (!isValidOpaqueId(input.parentRunId)) {
      return { ok: false, status: 400, error: 'Invalid parent_run_id' };
    }
    const parentValidationError = await validateParentRunId(env.DB, spaceId, input.parentRunId);
    if (parentValidationError) {
      return { ok: false, status: 400, error: parentValidationError };
    }
    parentRun = await getRunHierarchyNode(env.DB, input.parentRunId);
    if (!parentRun) {
      return { ok: false, status: 400, error: 'Invalid parent_run_id: run not found' };
    }
  }

  const runId = generateId();
  const validatedModel = await resolveRunModel(env.DB, spaceId, input.model);
  const runInput = JSON.stringify(input.input || {});
  const agentType = input.agentType || 'default';
  const createdAt = new Date().toISOString();
  const rootThreadId = parentRun?.rootThreadId ?? parentRun?.threadId ?? input.threadId;
  const rootRunId = parentRun?.rootRunId ?? parentRun?.id ?? runId;
  const childThreadId = parentRun && parentRun.threadId !== input.threadId
    ? input.threadId
    : null;

  await createPendingRun(env.DB, {
    runId,
    threadId: input.threadId,
    spaceId,
    requesterAccountId: input.userId,
    parentRunId: input.parentRunId || null,
    childThreadId,
    rootThreadId,
    rootRunId,
    agentType,
    input: runInput,
    createdAt,
  });

  try {
    const message: RunQueueMessage = {
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId,
      timestamp: Date.now(),
      model: validatedModel,
    };
    await env.RUN_QUEUE.send(message);

    await updateRunStatus(env.DB, {
      runId,
      status: 'queued',
      error: null,
    });
  } catch (err) {
    logError('Failed to enqueue run', err, { module: 'services/execution/run-creation' });
    await updateRunStatus(env.DB, {
      runId,
      status: 'failed',
      error: 'Failed to enqueue run for execution',
    });

    const failedPayload = buildRunFailedPayload(runId, 'Failed to enqueue run for execution');
    await persistAndEmitEvent(env, runId, 'run.failed', failedPayload);

    return { ok: false, status: 500, error: 'Failed to queue run' };
  }

  const run = await getRunResponse(env.DB, runId);
  if (!run) {
    return { ok: false, status: 500, error: 'Failed to create run' };
  }

  return {
    ok: true,
    status: 201,
    run,
  };
}
