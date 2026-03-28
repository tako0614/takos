import type { Env } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import { getDb, serviceCommonEnvReconcileJobs } from '../../../infra/db';
import { eq, and, or, inArray, isNull, isNotNull, lte } from 'drizzle-orm';

export type CommonEnvReconcileTrigger =
  | 'workspace_env_put'
  | 'workspace_env_delete'
  | 'worker_env_patch'
  | 'manual_links_set'
  | 'manual_links_patch'
  | 'bundle_required_links'
  | 'periodic_drift'
  | 'retry_dispatch';

export type CommonEnvReconcileStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'retry_wait'
  | 'dead_letter';

export interface CommonEnvReconcileJobRow {
  id: string;
  accountId: string;
  serviceId: string;
  workerId: string;
  targetKeysJson: string | null;
  trigger: CommonEnvReconcileTrigger;
  status: CommonEnvReconcileStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

const MAX_RETRY_ATTEMPTS = 5;
const PROCESSING_LEASE_TTL_MS = 5 * 60_000;
const STALE_PROCESSING_FALLBACK_MS = 15 * 60_000;

function normalizeTargetKeys(keys?: string[]): string | null {
  if (!keys || keys.length === 0) return null;
  return JSON.stringify(Array.from(new Set(keys)).sort());
}

function parseTargetKeys(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const keys = parsed.filter((v): v is string => typeof v === 'string');
    if (keys.length === 0) return undefined;
    return keys;
  } catch {
    return undefined;
  }
}

function backoffMs(attempt: number): number {
  if (attempt <= 1) return 60_000;
  if (attempt === 2) return 3 * 60_000;
  if (attempt === 3) return 15 * 60_000;
  if (attempt === 4) return 60 * 60_000;
  return 3 * 60 * 60_000;
}

function processingLeaseExpiresAt(baseMs = Date.now()): string {
  return new Date(baseMs + PROCESSING_LEASE_TTL_MS).toISOString();
}

function staleProcessingCutoff(baseMs = Date.now()): string {
  return new Date(baseMs - STALE_PROCESSING_FALLBACK_MS).toISOString();
}

function toErrorCode(error: unknown): string {
  return error instanceof Error ? 'apply_failed' : 'unknown_error';
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

interface CommonEnvReconcileJobAttemptRow {
  id: string;
  attempts: number;
}

interface ActiveJobRow {
  id: string;
  status: CommonEnvReconcileStatus;
  targetKeysJson: string | null;
}

type TargetKeySet = Set<string> | null | 'invalid';

function toTargetKeySet(targetKeysJson: string | null): TargetKeySet {
  if (targetKeysJson === null) return null;
  const keys = parseTargetKeys(targetKeysJson);
  if (!keys) return 'invalid';
  return new Set(keys);
}

function isCoveredBy(existing: TargetKeySet, requested: Set<string> | null): boolean {
  if (existing === 'invalid') return false;
  if (existing === null) return true;
  if (requested === null) return false;
  for (const key of requested) {
    if (!existing.has(key)) return false;
  }
  return true;
}

function mergeTargetKeySets(existing: TargetKeySet, requested: Set<string> | null): string | null {
  if (existing === null || requested === null) return null;
  if (existing === 'invalid') {
    return normalizeTargetKeys(Array.from(requested));
  }
  const merged = new Set(existing);
  for (const key of requested) {
    merged.add(key);
  }
  return normalizeTargetKeys(Array.from(merged));
}

const t = serviceCommonEnvReconcileJobs;

export class CommonEnvReconcileJobStore {
  constructor(private readonly env: Env) {}

  private async listActiveJobsForService(params: {
    spaceId: string;
    serviceId: string;
  }): Promise<ActiveJobRow[]> {
    const db = getDb(this.env.DB);
    return db
      .select({
        id: t.id,
        status: t.status,
        targetKeysJson: t.targetKeysJson,
      })
      .from(t)
      .where(
        and(
          eq(t.accountId, params.spaceId),
          eq(t.serviceId, params.serviceId),
          inArray(t.status, ['pending', 'queued', 'processing', 'retry_wait']),
        ),
      )
      .orderBy(t.createdAt)
      .all() as Promise<ActiveJobRow[]>;
  }

  private async listActiveJobsForWorker(params: {
    spaceId: string;
    workerId: string;
  }): Promise<ActiveJobRow[]> {
    return this.listActiveJobsForService({
      spaceId: params.spaceId,
      serviceId: params.workerId,
    });
  }

  private async bumpRetryWaitToPending(jobId: string): Promise<void> {
    const db = getDb(this.env.DB);
    const ts = new Date().toISOString();
    await db
      .update(t)
      .set({
        status: 'pending',
        trigger: 'retry_dispatch',
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        enqueuedAt: ts,
        updatedAt: ts,
      })
      .where(and(eq(t.id, jobId), eq(t.status, 'retry_wait')));
  }

  private async retargetActiveJob(params: {
    job: ActiveJobRow;
    targetKeysJson: string | null;
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    const db = getDb(this.env.DB);
    const ts = new Date().toISOString();
    if (params.job.status === 'retry_wait') {
      await db
        .update(t)
        .set({
          status: 'pending',
          targetKeysJson: params.targetKeysJson,
          trigger: params.trigger,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          enqueuedAt: ts,
          updatedAt: ts,
        })
        .where(and(eq(t.id, params.job.id), eq(t.status, 'retry_wait')));
      return;
    }

    if (params.job.status === 'pending' || params.job.status === 'queued') {
      await db
        .update(t)
        .set({
          targetKeysJson: params.targetKeysJson,
          trigger: params.trigger,
          updatedAt: ts,
        })
        .where(
          and(
            eq(t.id, params.job.id),
            inArray(t.status, ['pending', 'queued']),
          ),
        );
    }
  }

  async enqueueService(params: {
    spaceId: string;
    serviceId: string;
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<string> {
    const targetKeysJson = normalizeTargetKeys(params.targetKeys);
    const requestedKeys = targetKeysJson ? new Set(parseTargetKeys(targetKeysJson) || []) : null;
    const activeJobs = await this.listActiveJobsForService({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
    });

    for (const job of activeJobs) {
      const existingKeys = toTargetKeySet(job.targetKeysJson);
      if (!isCoveredBy(existingKeys, requestedKeys)) continue;
      if (job.status === 'retry_wait') {
        await this.bumpRetryWaitToPending(job.id);
      }
      return job.id;
    }

    if (requestedKeys === null) {
      const promotable = activeJobs.find((job) =>
        job.status === 'pending' || job.status === 'queued' || job.status === 'retry_wait'
      );
      if (promotable) {
        await this.retargetActiveJob({
          job: promotable,
          targetKeysJson: null,
          trigger: params.trigger,
        });
        return promotable.id;
      }
    } else {
      const mergeCandidate = activeJobs.find((job) =>
        job.status === 'pending' || job.status === 'queued' || job.status === 'retry_wait'
      );
      if (mergeCandidate) {
        const mergedTargetKeysJson = mergeTargetKeySets(
          toTargetKeySet(mergeCandidate.targetKeysJson),
          requestedKeys
        );
        await this.retargetActiveJob({
          job: mergeCandidate,
          targetKeysJson: mergedTargetKeysJson,
          trigger: params.trigger,
        });
        return mergeCandidate.id;
      }
    }

    const db = getDb(this.env.DB);
    const id = generateId();
    const ts = new Date().toISOString();
    await db
      .insert(t)
      .values({
        id,
        accountId: params.spaceId,
        serviceId: params.serviceId,
        targetKeysJson,
        trigger: params.trigger,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        enqueuedAt: ts,
        startedAt: null,
        completedAt: null,
        createdAt: ts,
        updatedAt: ts,
      });
    return id;
  }

  async enqueue(params: {
    spaceId: string;
    workerId: string;
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<string> {
    return this.enqueueService({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      targetKeys: params.targetKeys,
      trigger: params.trigger,
    });
  }

  async enqueueForServices(params: {
    spaceId: string;
    serviceIds: string[];
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    for (const serviceId of params.serviceIds) {
      await this.enqueueService({
        spaceId: params.spaceId,
        serviceId,
        targetKeys: params.targetKeys,
        trigger: params.trigger,
      });
    }
  }

  async enqueueForWorkers(params: {
    spaceId: string;
    workerIds: string[];
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.enqueueForServices({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
      targetKeys: params.targetKeys,
      trigger: params.trigger,
    });
  }

  async listRunnable(limit: number): Promise<CommonEnvReconcileJobRow[]> {
    const db = getDb(this.env.DB);
    const rows = await db
      .select({
        id: t.id,
        accountId: t.accountId,
        serviceId: t.serviceId,
        workerId: t.serviceId,
        targetKeysJson: t.targetKeysJson,
        trigger: t.trigger,
        status: t.status,
        attempts: t.attempts,
        nextAttemptAt: t.nextAttemptAt,
        lastErrorCode: t.lastErrorCode,
        lastErrorMessage: t.lastErrorMessage,
      })
      .from(t)
      .where(
        and(
          inArray(t.status, ['pending', 'retry_wait']),
          or(isNull(t.nextAttemptAt), lte(t.nextAttemptAt, new Date().toISOString())),
        ),
      )
      .orderBy(t.createdAt)
      .limit(Math.max(1, limit))
      .all();
    return rows as CommonEnvReconcileJobRow[];
  }

  async markProcessing(jobId: string): Promise<boolean> {
    const db = getDb(this.env.DB);
    const ts = new Date().toISOString();
    const leaseToken = generateId();
    const leaseExpiresAt = processingLeaseExpiresAt();
    const result = await db
      .update(t)
      .set({
        status: 'processing',
        startedAt: ts,
        leaseToken,
        leaseExpiresAt,
        updatedAt: ts,
      })
      .where(
        and(
          eq(t.id, jobId),
          inArray(t.status, ['pending', 'retry_wait']),
        ),
      )
      .returning({ id: t.id });
    return result.length > 0;
  }

  async markCompleted(jobId: string): Promise<void> {
    const db = getDb(this.env.DB);
    const ts = new Date().toISOString();
    await db
      .update(t)
      .set({
        status: 'completed',
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: ts,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: ts,
      })
      .where(eq(t.id, jobId));
  }

  async markRetry(jobId: string, currentAttempts: number, error: unknown): Promise<void> {
    const db = getDb(this.env.DB);
    const attempts = currentAttempts + 1;
    const ts = new Date().toISOString();
    const code = toErrorCode(error);
    const message = toErrorMessage(error);
    if (attempts >= MAX_RETRY_ATTEMPTS) {
      await db
        .update(t)
        .set({
          status: 'dead_letter',
          attempts,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: code,
          lastErrorMessage: message,
          updatedAt: ts,
        })
        .where(eq(t.id, jobId));
      return;
    }

    const nextAttemptAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
    await db
      .update(t)
      .set({
        status: 'retry_wait',
        attempts,
        nextAttemptAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: ts,
      })
      .where(eq(t.id, jobId));
  }

  private async listStaleProcessing(limit: number): Promise<CommonEnvReconcileJobAttemptRow[]> {
    const db = getDb(this.env.DB);
    const nowIso = new Date().toISOString();
    const fallbackCutoff = staleProcessingCutoff();
    return db
      .select({
        id: t.id,
        attempts: t.attempts,
      })
      .from(t)
      .where(
        and(
          eq(t.status, 'processing'),
          or(
            and(isNotNull(t.leaseExpiresAt), lte(t.leaseExpiresAt, nowIso)),
            and(isNull(t.leaseExpiresAt), lte(t.updatedAt, fallbackCutoff)),
          ),
        ),
      )
      .orderBy(t.updatedAt)
      .limit(Math.max(1, limit))
      .all();
  }

  async recoverStaleProcessing(limit: number): Promise<number> {
    const staleJobs = await this.listStaleProcessing(limit);
    for (const job of staleJobs) {
      await this.markRetry(job.id, job.attempts, new Error('processing_stale'));
    }
    return staleJobs.length;
  }

  async enqueuePeriodicDriftSweep(limit: number): Promise<number> {
    const nowIso = new Date().toISOString();
    const fallbackCutoff = staleProcessingCutoff();
    const targets = await this.env.DB
      .prepare(`
        SELECT DISTINCT l.account_id, l.service_id
        FROM service_common_env_links l
        LEFT JOIN common_env_reconcile_jobs j
          ON j.service_id = l.service_id
          AND j.account_id = l.account_id
          AND (
            j.status IN ('pending', 'queued', 'retry_wait')
            OR (
              j.status = 'processing'
              AND (
                (j.lease_expires_at IS NOT NULL AND j.lease_expires_at > ?)
                OR (j.lease_expires_at IS NULL AND j.updated_at > ?)
              )
            )
          )
        WHERE j.id IS NULL
        LIMIT ?
      `)
      .bind(nowIso, fallbackCutoff, Math.max(1, limit))
      .all<{ account_id: string; service_id: string }>();
    const rows = targets.results || [];
    for (const row of rows) {
      await this.enqueueService({
        spaceId: row.account_id,
        serviceId: row.service_id,
        trigger: 'periodic_drift',
      });
    }
    return rows.length;
  }

  static parseTargetKeys(row: { targetKeysJson: string | null }): string[] | undefined {
    return parseTargetKeys(row.targetKeysJson);
  }
}
