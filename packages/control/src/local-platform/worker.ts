import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { WorkerEnv } from '../runtime/worker/env.ts';
import { createWorkerRuntime } from '../runtime/worker/index.ts';
import { createNodeWebEnv } from '../node-platform/env-builder.ts';
import {
  buildLocalMessageBatch,
  isConsumableQueue,
  LOCAL_DLQ_QUEUE_NAMES,
  LOCAL_QUEUE_RETRY_LIMITS,
  type ConsumableQueue,
  type LocalQueueRecord,
} from './queue-runtime.ts';
import { logError, logInfo } from '../shared/utils/logger.ts';
import { buildNodeWorkerPlatform } from '../platform/adapters/node.ts';
import type { PlatformScheduledEvent } from '../shared/types/bindings.ts';

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_SCHEDULED_INTERVAL_MS = 60_000;
const DEFAULT_HEARTBEAT_TTL_MS = 120_000;
const workerHandler = createWorkerRuntime(buildNodeWorkerPlatform);

function resolveDuration(envVarName: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[envVarName] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveHeartbeatFile(): string | null {
  const explicit = process.env.TAKOS_LOCAL_WORKER_HEARTBEAT_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  const dataDir = process.env.TAKOS_LOCAL_DATA_DIR?.trim();
  if (!dataDir) return null;
  return path.resolve(dataDir, 'worker-heartbeat.json');
}

export function resolveWorkerHeartbeatTtlMs(): number {
  return resolveDuration('TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS', DEFAULT_HEARTBEAT_TTL_MS);
}

async function updateHeartbeat(status: 'starting' | 'idle' | 'worked' | 'error', details?: Record<string, unknown>): Promise<void> {
  const heartbeatFile = resolveHeartbeatFile();
  if (!heartbeatFile) return;
  await mkdir(path.dirname(heartbeatFile), { recursive: true });
  await writeFile(heartbeatFile, JSON.stringify({
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    status,
    ...details,
  }));
}

function createForwardingBinding(baseUrl: string): { fetch(request: Request): Promise<Response> } {
  return {
    async fetch(request: Request): Promise<Response> {
      const incoming = new URL(request.url);
      const target = new URL(incoming.pathname.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      target.search = incoming.search;
      return globalThis.fetch(new Request(target, request));
    },
  };
}

function createScheduledEvent(scheduledTime: number): PlatformScheduledEvent {
  return {
    scheduledTime,
    cron: '* * * * *',
    noRetry() {},
  } as PlatformScheduledEvent;
}

function requireConsumableQueue<T>(queue: unknown, label: string): ConsumableQueue<T> {
  if (!isConsumableQueue(queue)) {
    throw new Error(`${label} is not a consumable queue implementation (missing queueName or receive())`);
  }
  return queue as ConsumableQueue<T>;
}

function getWorkerQueues(env: WorkerEnv): Array<ConsumableQueue<unknown>> {
  return [
    requireConsumableQueue(env.RUN_QUEUE, 'RUN_QUEUE'),
    requireConsumableQueue(env.INDEX_QUEUE, 'INDEX_QUEUE'),
    requireConsumableQueue(env.WORKFLOW_QUEUE, 'WORKFLOW_QUEUE'),
    requireConsumableQueue(env.DEPLOY_QUEUE, 'DEPLOY_QUEUE'),
  ];
}

async function dispatchRecord(
  env: WorkerEnv,
  queue: ConsumableQueue<unknown>,
  record: LocalQueueRecord<unknown>,
): Promise<boolean> {
  let acked = false;
  let retried = false;
  const batch = buildLocalMessageBatch(queue.queueName, record, {
    onAck: () => {
      acked = true;
    },
    onRetry: () => {
      retried = true;
    },
  });

  await workerHandler.queue(batch, env);

  if (!retried) return acked;

  const nextAttempts = Math.max(1, record.attempts ?? 1) + 1;
  const retryLimit = LOCAL_QUEUE_RETRY_LIMITS[queue.queueName];

  if (nextAttempts > retryLimit) {
    const dlqBatch = buildLocalMessageBatch(LOCAL_DLQ_QUEUE_NAMES[queue.queueName], {
      ...record,
      attempts: nextAttempts,
    });
    await workerHandler.queue(dlqBatch, env);
    return true;
  }

  await (queue as { sendBatch(messages: Iterable<unknown>): Promise<void> }).sendBatch([
    { ...record, attempts: nextAttempts },
  ]);
  return true;
}

export async function runLocalWorkerIteration(
  env: WorkerEnv,
  queues = getWorkerQueues(env),
): Promise<boolean> {
  for (const queue of queues) {
    const record = await queue.receive();
    if (!record) continue;
    await dispatchRecord(env, queue, record);
    return true;
  }
  return false;
}

export async function createLocalWorkerEnv(): Promise<WorkerEnv> {
  const baseEnv = await createNodeWebEnv();
  const executorHostUrl = process.env.TAKOS_LOCAL_EXECUTOR_HOST_URL;
  const runtimeHostUrl = process.env.TAKOS_LOCAL_RUNTIME_HOST_URL;
  return {
    ...baseEnv,
    ...(executorHostUrl ? { EXECUTOR_HOST: createForwardingBinding(executorHostUrl) } : {}),
    ...(runtimeHostUrl ? { RUNTIME_HOST: createForwardingBinding(runtimeHostUrl) } : {}),
  };
}

export async function startLocalWorkerLoop(): Promise<void> {
  const env = await createLocalWorkerEnv();
  const pollIntervalMs = resolveDuration('TAKOS_LOCAL_WORKER_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS);
  const scheduledIntervalMs = resolveDuration('TAKOS_LOCAL_WORKER_SCHEDULED_INTERVAL_MS', DEFAULT_SCHEDULED_INTERVAL_MS);
  let nextScheduledAt = Date.now() + scheduledIntervalMs;
  await updateHeartbeat('starting', { pollIntervalMs, scheduledIntervalMs });

  logInfo('takos-worker local loop started', {
    module: 'local_worker',
    pollIntervalMs,
    scheduledIntervalMs,
  });

  for (;;) {
    try {
      const worked = await runLocalWorkerIteration(env);
      const now = Date.now();
      if (now >= nextScheduledAt) {
        await workerHandler.scheduled(createScheduledEvent(now), env);
        nextScheduledAt = now + scheduledIntervalMs;
      }
      await updateHeartbeat(worked ? 'worked' : 'idle', { nextScheduledAt });
      if (!worked) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      logError('local worker iteration failed', error, { module: 'local_worker' });
      await updateHeartbeat('error', {
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      await sleep(pollIntervalMs);
    }
  }
}
