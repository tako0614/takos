import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import { generateId } from "../../../shared/utils/index.ts";
import type { Env, RunQueueMessage } from "../../../shared/types/index.ts";
import { RUN_QUEUE_MESSAGE_VERSION } from "../../../shared/types/index.ts";
import { checkThreadAccess } from "../threads/thread-service.ts";
import {
  buildRunFailedPayload,
  transitionRunTerminalAtomically,
} from "../run-notifier/index.ts";
import { emitCommittedRunEvent } from "./run-events.ts";
import {
  checkRunRateLimits,
  createPendingRun,
  getRunCreationIdentity,
  getRunHierarchyNode,
  getRunResponse,
  updateRunStatus,
} from "../runs/create-thread-run-store.ts";
import {
  createThreadRunValidationDeps,
  resolveSelectableRunModel,
  validateParentRunId,
} from "../runs/create-thread-run-validation.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { dispatchRunNotificationOutbox } from "../notifications/run-outbox.ts";
import { clientOperationRowId } from "../../../shared/utils/client-operation-id.ts";
import {
  DEFAULT_AGENT_TYPE,
  isAgentType,
} from "../../../shared/types/agent-tasks.ts";
import { stringifyBoundedRunInput } from "../../../shared/utils/run-input.ts";
import { resolveExecutionModel } from "../agent/index.ts";
import {
  AuthorizationError,
  ConflictError,
} from "@takos/worker-platform-utils/errors";
import {
  compileBaseRunAuthority,
  ParentRunGrantUnavailableError,
  RunContextUnavailableError,
} from "../runs/run-authority.ts";
import {
  getMcpConfirmationRunGrantClaim,
  prepareMcpConfirmationRunGrant,
  releaseUnconsumedMcpConfirmationRunGrant,
} from "../platform/mcp/tool-confirmation.ts";

type CreateThreadRunInput = {
  userId: string;
  threadId: string;
  agentType?: string;
  input?: Record<string, unknown>;
  parentRunId?: string;
  model?: string;
  idempotencyKey?: string;
  confirmationGrantId?: string;
};

type CreateThreadRunError = {
  ok: false;
  status: 400 | 404 | 409 | 429 | 500;
  error: string;
};

type CreateThreadRunSuccess = {
  ok: true;
  status: 200 | 201;
  run: Awaited<ReturnType<typeof getRunResponse>>;
  reused: boolean;
};

export type CreateThreadRunResult =
  | CreateThreadRunError
  | CreateThreadRunSuccess;

export async function createThreadRun(
  env: Env,
  input: CreateThreadRunInput,
  clock: Clock = systemClock,
): Promise<CreateThreadRunResult> {
  const access = await checkThreadAccess(env.DB, input.threadId, input.userId);
  if (!access) {
    return {
      ok: false,
      status: 404,
      error: "Thread not found",
    };
  }
  const spaceId = access.thread.space_id;
  const agentType = input.agentType || DEFAULT_AGENT_TYPE;
  if (!isAgentType(agentType)) {
    return { ok: false, status: 400, error: "Agent type is not available" };
  }
  const runInput = stringifyBoundedRunInput(input.input);
  if (runInput === null) {
    return {
      ok: false,
      status: 400,
      error: "Run input is too large or invalid",
    };
  }
  const parentRunId = input.parentRunId || null;
  if (parentRunId && !isValidOpaqueId(parentRunId)) {
    return { ok: false, status: 400, error: "Invalid parent_run_id" };
  }
  const confirmationGrantId = input.confirmationGrantId || null;
  if (
    confirmationGrantId && !isValidOpaqueId(confirmationGrantId)
  ) {
    return { ok: false, status: 400, error: "Invalid confirmation_grant_id" };
  }
  let requestedExecutionModel: string | null = null;
  if (input.model !== undefined) {
    const normalized = createThreadRunValidationDeps.normalizeModelId(
      input.model,
    );
    if (!normalized || normalized === "local-smoke") {
      return { ok: false, status: 400, error: "Model is not available" };
    }
    requestedExecutionModel = resolveExecutionModel(env, normalized);
  }
  const runId = input.idempotencyKey
    ? clientOperationRowId("run", input.idempotencyKey)
    : generateId();
  const readExistingIdempotentRun = async () => {
    if (!input.idempotencyKey) return null;
    const identity = await getRunCreationIdentity(env.DB, runId);
    if (!identity) return null;
    if (
      identity.threadId !== input.threadId ||
      identity.spaceId !== spaceId ||
      identity.requesterAccountId !== input.userId ||
      identity.parentRunId !== parentRunId ||
      identity.agentType !== agentType ||
      identity.input !== runInput ||
      identity.confirmationGrantId !== confirmationGrantId ||
      (requestedExecutionModel !== null &&
        identity.model !== requestedExecutionModel)
    ) {
      return {
        ok: false as const,
        status: 409 as const,
        error: "Idempotency key already used by another request",
      } satisfies CreateThreadRunError;
    }
    const run = await getRunResponse(env.DB, runId);
    if (!run) {
      return {
        ok: false as const,
        status: 500 as const,
        error: "Failed to read idempotent Run",
      } satisfies CreateThreadRunError;
    }
    return {
      ok: true as const,
      status: 200 as const,
      run,
      reused: true,
    } satisfies CreateThreadRunSuccess;
  };
  const existing = await readExistingIdempotentRun();
  if (existing) {
    return existing;
  }
  if (access.thread.status !== "active") {
    return {
      ok: false,
      status: 409,
      error: "Archived Thread must be unarchived before starting a Run",
    };
  }

  const rateLimitCheck = await checkRunRateLimits(
    env.DB,
    input.userId,
    spaceId,
    {
      isChildRun: !!input.parentRunId,
    },
  );
  if (!rateLimitCheck.allowed) {
    return {
      ok: false,
      status: 429,
      error: rateLimitCheck.reason || "Rate limit exceeded",
    };
  }

  let parentRun = null;
  if (parentRunId) {
    const parentValidationError = await validateParentRunId(
      env.DB,
      spaceId,
      parentRunId,
    );
    if (parentValidationError) {
      return { ok: false, status: 400, error: parentValidationError };
    }
    parentRun = await getRunHierarchyNode(env.DB, parentRunId);
    if (!parentRun) {
      return {
        ok: false,
        status: 400,
        error: "Invalid parent_run_id: run not found",
      };
    }
  }

  const validatedModel = await resolveSelectableRunModel(
    env.DB,
    spaceId,
    input.model,
    env,
  );
  if (!validatedModel) {
    return { ok: false, status: 400, error: "Model is not available" };
  }
  const createdAt = new Date(clock.now()).toISOString();
  const rootThreadId = parentRun?.rootThreadId ?? parentRun?.threadId ??
    input.threadId;
  const rootRunId = parentRun?.rootRunId ?? parentRun?.id ?? runId;
  const childThreadId = parentRun && parentRun.threadId !== input.threadId
    ? input.threadId
    : null;

  let confirmationGrant = null;
  if (confirmationGrantId) {
    try {
      confirmationGrant = await prepareMcpConfirmationRunGrant(env.DB, env, {
        confirmationId: confirmationGrantId,
        accountId: spaceId,
        userId: input.userId,
        threadId: input.threadId,
        runId,
        now: createdAt,
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        return { ok: false, status: 409, error: error.message };
      }
      throw error;
    }
  }

  let authority;
  try {
    authority = await compileBaseRunAuthority({
      db: env.DB,
      env,
      runId,
      threadId: input.threadId,
      workspaceId: spaceId,
      requesterAccountId: input.userId,
      parentRunId,
      agentType,
      model: validatedModel,
      runInputJson: runInput,
      createdAt,
      confirmationGrantIds: confirmationGrant
        ? [confirmationGrant.confirmationId]
        : [],
    });
  } catch (error) {
    if (error instanceof ParentRunGrantUnavailableError) {
      return {
        ok: false,
        status: 409,
        error: "Parent Run cannot delegate without a valid RunGrant",
      };
    }
    if (error instanceof RunContextUnavailableError) {
      return { ok: false, status: 409, error: error.message };
    }
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        status: 409,
        error:
          "Run authority changed before creation; retry from current Workspace state",
      };
    }
    throw error;
  }

  try {
    await createPendingRun(env.DB, {
      runId,
      threadId: input.threadId,
      spaceId,
      requesterAccountId: input.userId,
      parentRunId,
      childThreadId,
      rootThreadId,
      rootRunId,
      agentType,
      model: validatedModel,
      input: runInput,
      createdAt,
      authority,
      confirmationGrant,
    });
  } catch (error) {
    if (input.idempotencyKey) {
      const winner = await readExistingIdempotentRun();
      if (winner) return winner;
    }
    if (confirmationGrantId) {
      const claimedRunId = await getMcpConfirmationRunGrantClaim(
        env.DB,
        confirmationGrantId,
      );
      if (claimedRunId && claimedRunId !== runId) {
        return {
          ok: false,
          status: 409,
          error: "MCP confirmation grant was already claimed by another Run",
        };
      }
    }
    throw error;
  }

  try {
    const message: RunQueueMessage = {
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId,
      timestamp: clock.now(),
      model: validatedModel,
    };
    await updateRunStatus(env.DB, {
      runId,
      status: "queued",
      error: null,
    });
    await env.RUN_QUEUE.send(message);
  } catch (err) {
    logError("Failed to enqueue run", err, {
      module: "services/execution/run-creation",
    });
    const completedAt = new Date().toISOString();
    const failedPayload = buildRunFailedPayload(
      runId,
      "Failed to enqueue run for execution",
    );
    const transition = await transitionRunTerminalAtomically(
      env.DB,
      {
        runId,
        status: "failed",
        expectedStatuses: ["pending", "queued"],
        completedAt,
        error: "Failed to enqueue run for execution",
        eventType: "run.failed",
        terminalEvent: failedPayload,
      },
      { offloadBucket: env.TAKOS_OFFLOAD },
    );
    if (transition.committed) {
      await releaseUnconsumedMcpConfirmationRunGrant(env.DB, runId).catch(
        (releaseError) => {
          logError(
            "Failed to release unconsumed MCP confirmation Run grant",
            releaseError,
            { module: "services/execution/run-creation", runId },
          );
        },
      );
      await dispatchRunNotificationOutbox(env, {
        completionKey: transition.completionKey,
      }).catch((notificationError) => {
        logError(
          "Failed to create enqueue-failure notification",
          notificationError,
          { module: "services/execution/run-creation", runId },
        );
      });
      await emitCommittedRunEvent(
        env,
        runId,
        "run.failed",
        failedPayload,
        transition.eventId,
      );
    }

    return { ok: false, status: 500, error: "Failed to queue run" };
  }

  const run = await getRunResponse(env.DB, runId);
  if (!run) {
    return { ok: false, status: 500, error: "Failed to create run" };
  }

  return {
    ok: true,
    status: 201,
    run,
    reused: false,
  };
}
