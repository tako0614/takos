// Runner handler module (queue + cron).
// Run dispatch, DLQ, stale run recovery.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageBatch, ScheduledEvent } from '../../shared/types/bindings.ts';
import type { RunQueueMessage } from '../../shared/types';
import { isValidRunQueueMessage, RUN_QUEUE_MESSAGE_VERSION } from '../../shared/types';
import type { RunnerEnv as Env } from '../../shared/types';
import { getDb, runs, dlqEntries } from '../../infra/db';
import { eq, and, lt, ne, isNull, sql } from 'drizzle-orm';
import {
  notifyRunFailedEvent,
  persistRunFailedEvent,
} from '../../application/services/run-notifier';

import { validateRunnerEnv, createEnvGuard } from '../../shared/utils/validate-env';
import { logError, logInfo, logWarn } from '../../shared/utils/logger';

const STALE_WORKER_THRESHOLD_MS = 5 * 60 * 1000; // 5 min — matches 60s heartbeat x 5 missed beats

// Cached environment validation guard.
const envGuard = createEnvGuard(validateRunnerEnv);

// ---------------------------------------------------------------------------
// Queue handler
// ---------------------------------------------------------------------------

export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    // Validate environment on first invocation (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      // Retry all messages so they are not lost due to misconfiguration.
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    const rawQueueName = batch.queue;
    const queueName = rawQueueName.replace(/-staging$/i, '');

    if (queueName !== 'takos-runs' && queueName !== 'takos-runs-dlq') {
      logWarn(`Unknown queue: ${rawQueueName}`, { module: 'runner_queue' });
      for (const message of batch.messages) {
        message.ack();
      }
      return;
    }

    const serviceId = crypto.randomUUID();

    // Fail fast if required bindings are missing — before claiming any run
    if (!env.EXECUTOR_HOST) {
      logError('EXECUTOR_HOST binding is missing; cannot dispatch runs', undefined, { module: 'run_queue' });
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    if (queueName === 'takos-runs-dlq') {
      for (const message of batch.messages) {
        const body = message.body as RunQueueMessage;
        const { runId } = body;

        const dbForDlq = getDb(env.DB);
        const run = await dbForDlq.select({
          sessionId: runs.sessionId,
          accountId: runs.accountId,
          threadId: runs.threadId,
          agentType: runs.agentType,
          error: runs.error,
        }).from(runs).where(eq(runs.id, runId)).get();

        const dlqEntry = {
          level: 'CRITICAL',
          event: 'RUN_DLQ_ENTRY',
          queue: rawQueueName,
          runId,
          spaceId: run?.accountId || 'unknown',
          threadId: run?.threadId || 'unknown',
          agentType: run?.agentType || 'unknown',
          previousError: run?.error || 'none',
          timestamp: new Date().toISOString(),
          retryCount: message.attempts,
        };
        logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, { module: 'run_dlq' });

        try {
          await dbForDlq.insert(dlqEntries).values({
            id: crypto.randomUUID(),
            queue: rawQueueName,
            messageBody: JSON.stringify(body),
            error: run?.error || 'Max retries exceeded',
            retryCount: message.attempts,
          }).run();
        } catch (persistErr) {
          logError('Failed to persist DLQ entry', persistErr, { module: 'run_dlq' });
        }

        const dlqNow = new Date().toISOString();
        await dbForDlq.update(runs).set({
          status: 'failed',
          error: `DLQ: Run failed permanently after max retries. Previous error: ${run?.error || 'unknown'}`,
          completedAt: dlqNow,
        }).where(and(eq(runs.id, runId), ne(runs.status, 'completed')));

        const failedEvent = await persistRunFailedEvent(
          env,
          runId,
          {
            error: 'Run failed permanently after multiple retries',
            permanent: true,
            createdAt: dlqNow,
            sessionId: run?.sessionId ?? null,
          },
        );

        try {
          await notifyRunFailedEvent(env, runId, failedEvent);
        } catch (notifyErr) {
          logError(`Failed to notify WebSocket about DLQ entry`, notifyErr, { module: 'run_dlq' });
        }

        message.ack();
      }

      return;
    }

    for (const message of batch.messages) {
      const body = message.body;

      if (!isValidRunQueueMessage(body)) {
        logError(`Invalid message format, skipping`, JSON.stringify(body).slice(0, 200), { module: 'run_queue' });
        message.ack();
        continue;
      }

      const { runId, model } = body;

      try {
        const db = getDb(env.DB);

        // Recover stale run from previous dead worker
        const staleThreshold = new Date(Date.now() - STALE_WORKER_THRESHOLD_MS).toISOString();
        const staleRecovery = await db.update(runs).set({
          status: 'queued',
          serviceId: null,
          serviceHeartbeat: null,
        }).where(and(eq(runs.id, runId), eq(runs.status, 'running'), lt(runs.serviceHeartbeat, staleThreshold)));

        if (staleRecovery.meta.changes > 0) {
          logWarn(`Recovered stale run ${runId} from dead worker`, { module: 'run_queue' });
        }

        const now = new Date().toISOString();
        // Claim with service lease owner IS NULL guard + lease_version increment to prevent dual-claim race (#4)
        const claimResult = await db.update(runs).set({
          status: 'running',
          startedAt: now,
          serviceId,
          serviceHeartbeat: now,
          leaseVersion: sql`lease_version + 1`,
        }).where(and(eq(runs.id, runId), eq(runs.status, 'queued'), isNull(runs.serviceId)));

        if (claimResult.meta.changes === 0) {
          // Run already claimed by another worker or in a terminal state
          message.ack();
          continue;
        }

        // Read back the leaseVersion after claim — guard with serviceId to prevent TOCTOU
        const claimed = await db.select({ leaseVersion: runs.leaseVersion }).from(runs)
          .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId))).get();
        if (!claimed) {
          // Run was taken over between claim and read-back
          logWarn(`Run ${runId} lost between claim and read-back`, { module: 'run_queue' });
          message.ack();
          continue;
        }
        const leaseVersion = claimed.leaseVersion;

        // ---------------------------------------------------------------
        // Dispatch mode: fire-and-forget to CF Container (no 15-min limit)
        // Service binding provides implicit auth — no JWT needed.
        // ---------------------------------------------------------------
        // API keys are NOT sent in the dispatch payload. The host generates
        // per-run proxy tokens, and the container fetches keys via the
        // authenticated /proxy/api-keys endpoint.
        let res: Response;
        try {
          res = await env.EXECUTOR_HOST.fetch(
            new Request('https://executor/dispatch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                runId,
                serviceId,
                workerId: serviceId,
                model,
                leaseVersion,
              }),
            })
          );
        } catch (dispatchErr) {
          logError(`EXECUTOR_HOST.fetch() threw for run ${runId}: ${dispatchErr}`, dispatchErr, { module: 'run_queue' });
          await db.update(runs).set({
            status: 'failed',
            error: `Dispatch exception: ${String(dispatchErr).slice(0, 500)}`,
            completedAt: new Date().toISOString(),
          }).where(and(eq(runs.id, runId), eq(runs.status, 'running'), eq(runs.serviceId, serviceId)));
          message.ack();
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          logError(`Container dispatch failed for run ${runId}: ${res.status} ${text}`, undefined, { module: 'run_queue' });

          if (res.status >= 400 && res.status < 500) {
            // Permanent client error — mark run as failed, do not retry
            await db.update(runs).set({
              status: 'failed',
              error: `Dispatch rejected: ${res.status} ${text.slice(0, 500)}`,
              completedAt: new Date().toISOString(),
            }).where(and(eq(runs.id, runId), eq(runs.status, 'running'), eq(runs.serviceId, serviceId)));
            message.ack();
          } else {
            // Transient server error — reset run back to queued and retry
            await db.update(runs).set({ status: 'queued', serviceId: null, serviceHeartbeat: null })
              .where(and(eq(runs.id, runId), eq(runs.status, 'running'), eq(runs.serviceId, serviceId)));
            message.retry();
          }
          continue;
        }

        // Container accepted the run (202) — ack immediately
        // Heartbeat and billing are handled by the container
        logInfo(`Run ${runId} dispatched to container service lease ${serviceId}`, { module: 'run_queue' });
        message.ack();
        continue;
      } catch (error) {
        logError(`Run ${runId} failed`, error, { module: 'run_queue' });

        const dbForReset = getDb(env.DB);
        const resetResult = await dbForReset.update(runs).set({
          status: 'queued',
          serviceId: null,
          serviceHeartbeat: null,
        }).where(and(eq(runs.id, runId), eq(runs.status, 'running'), eq(runs.serviceId, serviceId)));

        if (resetResult.meta.changes === 0) {
          logWarn(`Could not reset run ${runId} - not owned by this worker or status changed`, { module: 'run_queue' });
        }

        message.retry();
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Cron: re-enqueue stale running runs whose container crashed
  // ---------------------------------------------------------------------------
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // Validate environment on first invocation (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      return;
    }

    if (!env.EXECUTOR_HOST) {
      logError('EXECUTOR_HOST binding is missing; stale run recovery is disabled', undefined, { module: 'runner_cron' });
      return;
    }

    const staleThreshold = new Date(Date.now() - STALE_WORKER_THRESHOLD_MS).toISOString();
    const db = getDb(env.DB);

    const staleRuns = await db.select({ id: runs.id })
      .from(runs).where(and(eq(runs.status, 'running'), lt(runs.serviceHeartbeat, staleThreshold)))
      .limit(50).all();

    if (staleRuns.length === 0) return;

    logInfo(`Found ${staleRuns.length} stale running runs, re-enqueuing`, { module: 'runner_cron' });

    for (const run of staleRuns) {
      // Atomically reset status to queued (only if still running and stale)
      const resetResult = await db.update(runs).set({
        status: 'queued',
        serviceId: null,
        serviceHeartbeat: null,
      }).where(and(eq(runs.id, run.id), eq(runs.status, 'running'), lt(runs.serviceHeartbeat, staleThreshold)));

      if (resetResult.meta.changes > 0) {
        try {
          await env.RUN_QUEUE.send({
            version: RUN_QUEUE_MESSAGE_VERSION,
            runId: run.id,
            // model is not stored on the Run record; re-enqueue without it
            // (AgentRunner will fall back to workspace default model)
            timestamp: Date.now(),
            retryCount: 0,
          });
          logInfo(`Re-enqueued stale run ${run.id} (previous worker timed out)`, { module: 'runner_cron' });
        } catch (sendErr) {
          // Queue send failed — revert status back to 'running' so cron retries next cycle (#7)
          logError(`Failed to re-enqueue run ${run.id}, reverting to running for retry`, sendErr, { module: 'runner_cron' });
          try {
            await db.update(runs).set({
              status: 'running',
              serviceHeartbeat: new Date(0).toISOString(), // Keep stale so cron picks it up again
            }).where(and(eq(runs.id, run.id), eq(runs.status, 'queued')));
          } catch (revertErr) {
            logError(`Failed to revert run ${run.id} after queue send failure`, revertErr, { module: 'runner_cron' });
          }
        }
      }
    }

    // Clean up old tool_operations records (24h retention)
    try {
      const { cleanupStaleOperations } = await import('../../application/tools/idempotency');
      const cleaned = await cleanupStaleOperations(env.DB);
      if (cleaned > 0) {
        logInfo(`Cleaned ${cleaned} stale tool_operations records`, { module: 'runner_cron' });
      }
    } catch (cleanupErr) {
      logWarn(`Failed to clean up tool_operations`, { module: 'runner_cron', detail: cleanupErr });
    }
  },
};
