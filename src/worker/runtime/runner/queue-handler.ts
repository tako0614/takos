// message queue handler: processes run queue messages and DLQ entries.
import type {
  MessageQueueBatch,
  MessageQueueMessage,
} from "../../shared/types/bindings.ts";
import type {
  RunnerEnv as Env,
  RunQueueMessage,
} from "../../shared/types/index.ts";
import { isValidRunQueueMessage } from "../../shared/types/index.ts";
import { dlqEntries, getDb, runs } from "../../infra/db/index.ts";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  buildRunFailedPayload,
  notifyRunFailedEvent,
  transitionRunTerminalAtomically,
} from "../../application/services/run-notifier/index.ts";

import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import { affectedRowCount } from "../../shared/utils/affected-row-count.ts";
import { envGuard, STALE_WORKER_THRESHOLD_MS } from "./runner-constants.ts";
import { classifyWorkerQueueName } from "../queues/queue-names.ts";
import {
  DLQ_TERMINALIZABLE_RUN_STATUSES,
  nextRunQueueBackpressureCount,
  runQueueBackpressureDelaySeconds,
  runQueueRetryDelaySeconds,
} from "./run-queue-policy.ts";
import { resolveRunModel } from "../../application/services/runs/create-thread-run-validation.ts";
import { assertRunExecutionAccess } from "../container-hosts/executor-run-state.ts";
import { AuthorizationError } from "@takos/worker-platform-utils/errors";
import { fencePendingOperationsForClaimedRun } from "../../application/tools/idempotency.ts";

function retryRunQueueMessage(message: MessageQueueMessage<unknown>): void {
  message.retry({
    delaySeconds: runQueueRetryDelaySeconds(message.attempts),
  });
}

function isExecutorCapacityResponse(status: number, body: string): boolean {
  return (
    status === 503 &&
    /(?:no executor capacity available|at capacity)/iu.test(body)
  );
}

async function requeueRunForExecutorCapacity(
  env: Env,
  message: MessageQueueMessage<unknown>,
  body: RunQueueMessage,
): Promise<void> {
  const backpressureCount = nextRunQueueBackpressureCount(
    body.backpressureCount,
  );
  const delaySeconds = runQueueBackpressureDelaySeconds(backpressureCount);
  try {
    await env.RUN_QUEUE.send({ ...body, backpressureCount }, { delaySeconds });
    logInfo(
      `Deferred run ${body.runId} for executor capacity (${delaySeconds}s, deferral ${backpressureCount})`,
      { module: "run_queue" },
    );
    message.ack();
  } catch (error) {
    // The replacement message was not durably accepted. Keep the original
    // delivery alive; this retry budget now represents a real Queue failure,
    // not executor saturation.
    logError(
      `Failed to requeue run ${body.runId} after executor saturation`,
      error,
      { module: "run_queue" },
    );
    retryRunQueueMessage(message);
  }
}

export async function handleQueue(
  batch: MessageQueueBatch<unknown>,
  env: Env,
): Promise<void> {
  // Validate environment on first invocation (cached).
  const envError = envGuard(env);
  if (envError) {
    // Retry all messages so they are not lost due to misconfiguration.
    for (const message of batch.messages) {
      retryRunQueueMessage(message);
    }
    return;
  }

  const rawQueueName = batch.queue;
  const queueKind = classifyWorkerQueueName(rawQueueName);

  if (queueKind !== "runs" && queueKind !== "runs_dlq") {
    logWarn(`Unknown queue: ${rawQueueName}`, { module: "runner_queue" });
    for (const message of batch.messages) {
      message.ack();
    }
    return;
  }

  const serviceId = crypto.randomUUID();

  // Fail fast if required bindings are missing — before claiming any run
  if (!env.EXECUTOR_HOST) {
    logError(
      "EXECUTOR_HOST binding is missing; cannot dispatch runs",
      undefined,
      { module: "run_queue" },
    );
    for (const message of batch.messages) {
      retryRunQueueMessage(message);
    }
    return;
  }

  if (queueKind === "runs_dlq") {
    for (const message of batch.messages) {
      const body = message.body as RunQueueMessage;
      const { runId } = body;

      const dbForDlq = getDb(env.DB);
      const run = await dbForDlq
        .select({
          sessionId: runs.sessionId,
          accountId: runs.accountId,
          threadId: runs.threadId,
          agentType: runs.agentType,
          error: runs.error,
        })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();

      const dlqEntry = {
        level: "CRITICAL",
        event: "RUN_DLQ_ENTRY",
        queue: rawQueueName,
        runId,
        spaceId: run?.accountId || "unknown",
        threadId: run?.threadId || "unknown",
        agentType: run?.agentType || "unknown",
        previousError: run?.error || "none",
        timestamp: new Date().toISOString(),
        retryCount: message.attempts,
      };
      logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, {
        module: "run_dlq",
      });

      try {
        await dbForDlq
          .insert(dlqEntries)
          .values({
            id: crypto.randomUUID(),
            queue: rawQueueName,
            messageBody: JSON.stringify(body),
            error: run?.error || "Max retries exceeded",
            retryCount: message.attempts,
          })
          .run();
      } catch (persistErr) {
        logError("Failed to persist DLQ entry", persistErr, {
          module: "run_dlq",
        });
      }

      const dlqNow = new Date().toISOString();
      const dlqError = `DLQ: Run failed permanently after max retries. Previous error: ${
        run?.error || "unknown"
      }`;
      const failedPayload = buildRunFailedPayload(
        runId,
        "Run failed permanently after multiple retries",
        { permanent: true, sessionId: run?.sessionId ?? null },
      );
      const failedTransition = await transitionRunTerminalAtomically(
        env.DB,
        {
          runId,
          status: "failed",
          // A DLQ delivery carries no serviceId/leaseVersion. It may therefore
          // be an old duplicate of a message whose sibling delivery already
          // claimed a fresh executor lease. Never let that unauthenticated
          // delivery overwrite a currently running owner; running-run recovery
          // is fenced by service heartbeat + leaseVersion instead.
          expectedStatuses: [...DLQ_TERMINALIZABLE_RUN_STATUSES],
          completedAt: dlqNow,
          error: dlqError,
          eventType: "run.failed",
          terminalEvent: failedPayload,
        },
        { offloadBucket: env.TAKOS_OFFLOAD },
      );

      if (failedTransition.committed) {
        try {
          await notifyRunFailedEvent(env, runId, {
            payload: failedPayload,
            eventId: failedTransition.eventId,
          });
        } catch (notifyErr) {
          logError(`Failed to notify WebSocket about DLQ entry`, notifyErr, {
            module: "run_dlq",
          });
        }
      }

      message.ack();
    }

    return;
  }

  for (const message of batch.messages) {
    const body = message.body;

    if (!isValidRunQueueMessage(body)) {
      logError(
        `Invalid message format, skipping`,
        JSON.stringify(body).slice(0, 200),
        { module: "run_queue" },
      );
      message.ack();
      continue;
    }

    const { runId, model } = body;

    try {
      const db = getDb(env.DB);

      // Recover stale run from previous dead worker
      const staleThreshold = new Date(
        Date.now() - STALE_WORKER_THRESHOLD_MS,
      ).toISOString();
      const staleRecovery = await db
        .update(runs)
        .set({
          status: "queued",
          serviceId: null,
          serviceHeartbeat: null,
          completionKey: null,
        })
        .where(
          and(
            eq(runs.id, runId),
            eq(runs.status, "running"),
            lt(runs.serviceHeartbeat, staleThreshold),
          ),
        );

      if (affectedRowCount(staleRecovery) > 0) {
        logWarn(`Recovered stale run ${runId} from dead worker`, {
          module: "run_queue",
        });
      }

      const now = new Date().toISOString();
      // Claim with service lease owner IS NULL guard + lease_version increment to prevent dual-claim race (#4)
      const claimResult = await db
        .update(runs)
        .set({
          status: "running",
          startedAt: now,
          serviceId,
          serviceHeartbeat: now,
          leaseVersion: sql`lease_version + 1`,
        })
        .where(
          and(
            eq(runs.id, runId),
            eq(runs.status, "queued"),
            isNull(runs.serviceId),
          ),
        );

      if (affectedRowCount(claimResult) === 0) {
        // Run already claimed by another worker or in a terminal state
        message.ack();
        continue;
      }

      // Read back the leaseVersion after claim — guard with serviceId to prevent TOCTOU
      const claimed = await db
        .select({
          leaseVersion: runs.leaseVersion,
          accountId: runs.accountId,
          model: runs.model,
        })
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId)))
        .get();
      if (!claimed) {
        // Run was taken over between claim and read-back
        logWarn(`Run ${runId} lost between claim and read-back`, {
          module: "run_queue",
        });
        message.ack();
        continue;
      }
      const leaseVersion = claimed.leaseVersion;
      // The new lease has not reached container dispatch yet. Therefore every
      // pending side-effect row belongs to an earlier executor with an unknown
      // outcome; fence it before recovery can replay execute_tools.
      await fencePendingOperationsForClaimedRun(env.DB, runId);
      try {
        await assertRunExecutionAccess(env, runId);
      } catch (accessError) {
        if (!(accessError instanceof AuthorizationError)) {
          throw accessError;
        }
        const completedAt = new Date().toISOString();
        const accessMessage =
          "Run requester no longer has access to this Workspace";
        const failedPayload = buildRunFailedPayload(runId, accessMessage, {
          permanent: true,
        });
        const failedTransition = await transitionRunTerminalAtomically(
          env.DB,
          {
            runId,
            status: "failed",
            expectedStatuses: ["running"],
            expectedServiceId: serviceId,
            expectedLeaseVersion: leaseVersion,
            completedAt,
            error: accessMessage,
            eventType: "run.failed",
            terminalEvent: failedPayload,
          },
          { offloadBucket: env.TAKOS_OFFLOAD },
        );
        if (failedTransition.committed) {
          await notifyRunFailedEvent(env, runId, {
            payload: failedPayload,
            eventId: failedTransition.eventId,
          }).catch((notifyError) => {
            logError(
              `Failed to notify membership-revoked Run ${runId}`,
              notifyError,
              { module: "run_queue" },
            );
          });
        }
        message.ack();
        continue;
      }
      let dispatchModel = claimed.model;
      if (!dispatchModel) {
        // Rolling compatibility for pre-model-column rows/messages. Resolve
        // once under current policy, then persist under the exact claimed
        // lease so every later retry uses the same immutable model.
        dispatchModel = await resolveRunModel(
          env.DB,
          claimed.accountId,
          model,
          env,
        );
        const frozen = await db
          .update(runs)
          .set({ model: dispatchModel })
          .where(
            and(
              eq(runs.id, runId),
              eq(runs.status, "running"),
              eq(runs.serviceId, serviceId),
              eq(runs.leaseVersion, leaseVersion),
              isNull(runs.model),
            ),
          );
        if (affectedRowCount(frozen) === 0) {
          logWarn(`Run ${runId} lost while freezing its execution model`, {
            module: "run_queue",
          });
          message.retry();
          continue;
        }
      } else if (model && model !== dispatchModel) {
        logWarn(`Ignoring queue model that differs from Run ${runId} ledger`, {
          module: "run_queue",
        });
      }

      // ---------------------------------------------------------------
      // Dispatch mode: fire-and-forget to runtime container (no 15-min limit)
      // Service binding provides implicit auth — no JWT needed.
      // ---------------------------------------------------------------
      // API keys are NOT sent in the dispatch payload. The host generates
      // per-run proxy tokens, and the container fetches keys via the
      // authenticated /proxy/api-keys endpoint.
      let res: Response;
      try {
        res = await env.EXECUTOR_HOST.fetch(
          new Request("https://executor/dispatch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId,
              serviceId,
              workerId: serviceId,
              model: dispatchModel,
              leaseVersion,
            }),
          }),
        );
      } catch (dispatchErr) {
        const dispatchError = `Dispatch exception: ${String(dispatchErr).slice(0, 500)}`;
        logError(
          `EXECUTOR_HOST.fetch() threw for run ${runId}: ${dispatchErr}`,
          dispatchErr,
          { module: "run_queue" },
        );
        await db
          .update(runs)
          .set({
            status: "queued",
            serviceId: null,
            serviceHeartbeat: null,
            error: dispatchError,
            completedAt: null,
            completionKey: null,
          })
          .where(
            and(
              eq(runs.id, runId),
              eq(runs.status, "running"),
              eq(runs.serviceId, serviceId),
            ),
          );
        retryRunQueueMessage(message);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch((e) => {
          logWarn("Failed to read container dispatch response body", {
            module: "run_queue",
            error: String(e),
          });
          return "";
        });
        const capacityBackpressure = isExecutorCapacityResponse(
          res.status,
          text,
        );
        if (capacityBackpressure) {
          logWarn(
            `Executor capacity deferred run ${runId}: ${res.status} ${text}`,
            { module: "run_queue" },
          );
        } else {
          logError(
            `Container dispatch failed for run ${runId}: ${res.status} ${text}`,
            undefined,
            { module: "run_queue" },
          );
        }

        if (res.status >= 400 && res.status < 500) {
          // Permanent client error — mark run as failed, do not retry
          const completedAt = new Date().toISOString();
          const dispatchError = `Dispatch rejected: ${res.status} ${text.slice(0, 500)}`;
          const terminalRun = await db
            .select({ sessionId: runs.sessionId })
            .from(runs)
            .where(eq(runs.id, runId))
            .get();
          const failedPayload = buildRunFailedPayload(runId, dispatchError, {
            sessionId: terminalRun?.sessionId ?? null,
          });
          const failedTransition = await transitionRunTerminalAtomically(
            env.DB,
            {
              runId,
              status: "failed",
              expectedStatuses: ["running"],
              expectedServiceId: serviceId,
              expectedLeaseVersion: leaseVersion,
              completedAt,
              error: dispatchError,
              eventType: "run.failed",
              terminalEvent: failedPayload,
            },
            { offloadBucket: env.TAKOS_OFFLOAD },
          );
          if (failedTransition.committed) {
            try {
              await notifyRunFailedEvent(env, runId, {
                payload: failedPayload,
                eventId: failedTransition.eventId,
              });
            } catch (notifyError) {
              logError(
                `Failed to notify WebSocket about dispatch rejection`,
                notifyError,
                { module: "run_queue" },
              );
            }
          }
          message.ack();
        } else {
          // Transient server error — reset run back to queued and retry
          await db
            .update(runs)
            .set({
              status: "queued",
              serviceId: null,
              serviceHeartbeat: null,
              // Pool saturation is healthy backpressure, not a run error.
              error: capacityBackpressure
                ? null
                : `Dispatch rejected: ${res.status} ${text.slice(0, 500)}`,
              completedAt: null,
              completionKey: null,
            })
            .where(
              and(
                eq(runs.id, runId),
                eq(runs.status, "running"),
                eq(runs.serviceId, serviceId),
              ),
            );
          if (capacityBackpressure) {
            await requeueRunForExecutorCapacity(env, message, body);
          } else {
            retryRunQueueMessage(message);
          }
        }
        continue;
      }

      // Container accepted the run (202) — ack immediately
      // Heartbeat and billing are handled by the container
      logInfo(
        `Run ${runId} dispatched to container service lease ${serviceId}`,
        { module: "run_queue" },
      );
      message.ack();
      continue;
    } catch (error) {
      logError(`Run ${runId} failed`, error, { module: "run_queue" });

      const dbForReset = getDb(env.DB);
      const resetResult = await dbForReset
        .update(runs)
        .set({
          status: "queued",
          serviceId: null,
          serviceHeartbeat: null,
          error: "Run queue handler failed before container dispatch completed",
          completedAt: null,
          completionKey: null,
        })
        .where(
          and(
            eq(runs.id, runId),
            eq(runs.status, "running"),
            eq(runs.serviceId, serviceId),
          ),
        );

      if (affectedRowCount(resetResult) === 0) {
        logWarn(
          `Could not reset run ${runId} - not owned by this worker or status changed`,
          { module: "run_queue" },
        );
      }

      retryRunQueueMessage(message);
    }
  }
}
