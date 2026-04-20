/**
 * ActivityPub Delivery Queue — persistent retry/backoff/DLQ for outbound
 * ActivityPub POSTs.
 *
 * Round 11 audit finding #4: prior to this service, `deliverToFollowers`
 * used a one-shot `Promise.allSettled` and silently dropped any inbox
 * that failed (timeout, 5xx, network error). That violates the
 * ActivityPub at-least-once delivery expectation and causes cascading
 * federation drift when a remote instance flaps.
 *
 * This module persists every (activity, inbox) pair that did not deliver
 * on the first attempt and replays them on a backoff ladder until either
 * the inbox acknowledges with 2xx or the dead-letter threshold is hit.
 *
 * Lifecycle:
 *   pending   — waiting for (re)attempt; `next_attempt_at <= now` means due
 *   delivered — inbox returned 2xx
 *   failed    — backoff ladder exhausted (attempts >= MAX_ATTEMPTS); DLQ
 *
 * Backoff schedule is intentionally conservative to avoid thundering-herd
 * when a remote instance comes back online:
 *   attempt 1 → +1m
 *   attempt 2 → +5m
 *   attempt 3 → +30m
 *   attempt 4 → +2h
 *   attempt 5 → +12h
 *   attempt 6 → +24h
 *   attempt 7 → +48h  (last retry, then DLQ)
 */

import { and, eq, lte, sql } from "drizzle-orm";
import type { D1Database } from "../../../shared/types/bindings.ts";
import type { Env } from "../../../shared/types/env.ts";
import { getDb } from "../../../infra/db/client.ts";
import { apDeliveryQueue } from "../../../infra/db/schema.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { logError, logInfo, logWarn } from "../../../shared/utils/logger.ts";
import { signAndDeliver } from "./activity-delivery.ts";

/** Maximum delivery attempts before moving an entry to the DLQ ('failed'). */
const MAX_ATTEMPTS = 7;

/**
 * Backoff schedule in milliseconds. Index matches `attempts` (0-based).
 * attempts=0 means the initial enqueue; the first retry fires after
 * BACKOFF_MS[1]. attempts=MAX_ATTEMPTS (7) is dead-lettered.
 */
const BACKOFF_MS = [
  60_000, // 1m (used for the initial enqueue)
  60_000, // 1m — retry 1
  5 * 60_000, // 5m — retry 2
  30 * 60_000, // 30m — retry 3
  2 * 60 * 60_000, // 2h — retry 4
  12 * 60 * 60_000, // 12h — retry 5
  24 * 60 * 60_000, // 24h — retry 6
  48 * 60 * 60_000, // 48h — retry 7 (last)
];

export interface EnqueueDeliveryInput {
  db: D1Database;
  activityId: string;
  inboxUrl: string;
  payload: Record<string, unknown>;
  signingKeyId?: string | null;
  /**
   * Delay (ms) before the first attempt. Defaults to 0 for immediate delivery
   * on the next tick. Pass a positive value when seeding a retry after a
   * synchronous first attempt failed.
   */
  initialDelayMs?: number;
  /** Initial attempt counter. Defaults to 0 for brand-new entries. */
  initialAttempts?: number;
}

export interface EnqueueDeliveryResult {
  id: string;
  nextAttemptAt: number;
}

/**
 * Persist a single (activity, inbox) pair into the delivery queue.
 *
 * Callers MUST provide a stable `activityId` so that audit / observability
 * can correlate retries with the original activity record (ForgeFed Push,
 * Delete, Add, etc.). If the activity itself has an `id` field the caller
 * should pass that value.
 */
export async function enqueueDelivery(
  input: EnqueueDeliveryInput,
): Promise<EnqueueDeliveryResult> {
  const db = getDb(input.db);
  const now = Date.now();
  const initialAttempts = input.initialAttempts ?? 0;
  const initialDelay = input.initialDelayMs ?? 0;
  const nextAttemptAt = now + Math.max(0, initialDelay);

  const id = generateId();
  const record = {
    id,
    activityId: input.activityId,
    inboxUrl: input.inboxUrl,
    payload: JSON.stringify(input.payload),
    signingKeyId: input.signingKeyId ?? null,
    attempts: initialAttempts,
    nextAttemptAt,
    lastError: null,
    status: "pending" as const,
    createdAt: new Date().toISOString(),
  };

  await db.insert(apDeliveryQueue).values(record);
  return { id, nextAttemptAt };
}

export interface TickDeliveryQueueInput {
  db: D1Database;
  env: Pick<Env, "PLATFORM_PRIVATE_KEY">;
  /** Maximum number of pending entries to process in this tick. Default 20. */
  batch?: number;
  /** Override the current time — used only for deterministic tests. */
  now?: number;
}

export interface TickDeliveryQueueResult {
  /** Number of entries inspected on this tick. */
  scanned: number;
  /** Entries that delivered successfully (2xx response). */
  delivered: number;
  /** Entries that failed this attempt but were re-queued for backoff. */
  requeued: number;
  /** Entries that exhausted the backoff ladder and moved to the DLQ. */
  dlq: number;
}

/**
 * Drain a batch of pending, due delivery entries. For each entry:
 *   1. Parse the stored payload JSON
 *   2. Resolve the signing key from env.PLATFORM_PRIVATE_KEY
 *   3. Call `signAndDeliver(inboxUrl, activity, pem, keyId)`
 *   4. On success → status='delivered'
 *      On failure → attempts++, either re-queue with backoff or DLQ
 *
 * Per-entry exceptions are swallowed and logged so that a single poisoned
 * row cannot stall the entire tick. The tick returns aggregated counts
 * for observability.
 */
export async function tickDeliveryQueue(
  input: TickDeliveryQueueInput,
): Promise<TickDeliveryQueueResult> {
  const db = getDb(input.db);
  const now = input.now ?? Date.now();
  const batch = Math.max(1, input.batch ?? 20);

  const rows = await db.select()
    .from(apDeliveryQueue)
    .where(and(
      eq(apDeliveryQueue.status, "pending"),
      lte(apDeliveryQueue.nextAttemptAt, now),
    ))
    .limit(batch)
    .all();

  if (rows.length === 0) {
    return { scanned: 0, delivered: 0, requeued: 0, dlq: 0 };
  }

  let delivered = 0;
  let requeued = 0;
  let dlq = 0;

  for (const row of rows) {
    try {
      let activity: Record<string, unknown>;
      try {
        activity = JSON.parse(row.payload) as Record<string, unknown>;
      } catch (parseErr) {
        // A row with an unparseable payload is poison. DLQ it immediately
        // so the queue is not stuck on a single bad entry.
        logError(
          "Delivery queue payload parse failed — dead-lettering",
          parseErr,
          {
            action: "ap_delivery_tick_parse",
            entryId: row.id,
            activityId: row.activityId,
          },
        );
        await db.update(apDeliveryQueue)
          .set({
            status: "failed",
            lastError: "payload_parse_error",
          })
          .where(eq(apDeliveryQueue.id, row.id));
        dlq++;
        continue;
      }

      const signingKeyId = row.signingKeyId;
      const signingKeyPem = input.env.PLATFORM_PRIVATE_KEY?.trim();
      if (!signingKeyId || !signingKeyPem) {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await db.update(apDeliveryQueue)
            .set({
              status: "failed",
              attempts: nextAttempts,
              lastError: !signingKeyId
                ? "missing_signing_key_id"
                : "missing_platform_private_key",
            })
            .where(eq(apDeliveryQueue.id, row.id));
          dlq++;
          continue;
        }

        const slot = Math.min(nextAttempts, BACKOFF_MS.length - 1);
        await db.update(apDeliveryQueue)
          .set({
            attempts: nextAttempts,
            nextAttemptAt: now + BACKOFF_MS[slot],
            lastError: !signingKeyId
              ? "missing_signing_key_id"
              : "missing_platform_private_key",
          })
          .where(eq(apDeliveryQueue.id, row.id));
        requeued++;
        logWarn("Delivery entry cannot be signed; retrying later", {
          action: "ap_delivery_tick_signing_required",
          entryId: row.id,
          signingKeyId: signingKeyId ?? "",
        });
        continue;
      }

      const ok = await signAndDeliver(
        row.inboxUrl,
        activity,
        signingKeyPem,
        signingKeyId,
      );

      if (ok) {
        await db.update(apDeliveryQueue)
          .set({
            status: "delivered",
            lastError: null,
          })
          .where(eq(apDeliveryQueue.id, row.id));
        delivered++;
        continue;
      }

      const nextAttempts = row.attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        await db.update(apDeliveryQueue)
          .set({
            status: "failed",
            attempts: nextAttempts,
            lastError: "max_attempts_exceeded",
          })
          .where(eq(apDeliveryQueue.id, row.id));
        dlq++;
        logWarn("Delivery entry moved to DLQ after max attempts", {
          action: "ap_delivery_tick_dlq",
          entryId: row.id,
          activityId: row.activityId,
          inboxUrl: row.inboxUrl,
          attempts: String(nextAttempts),
        });
        continue;
      }

      // Pick the backoff slot for this attempt. Clamp to the last slot for
      // safety in case MAX_ATTEMPTS and BACKOFF_MS drift.
      const slot = Math.min(nextAttempts, BACKOFF_MS.length - 1);
      const delayMs = BACKOFF_MS[slot];
      const nextAt = now + delayMs;

      await db.update(apDeliveryQueue)
        .set({
          attempts: nextAttempts,
          nextAttemptAt: nextAt,
          lastError: "delivery_failed",
        })
        .where(eq(apDeliveryQueue.id, row.id));
      requeued++;
    } catch (err) {
      // Never let one bad row poison the whole tick. Log and mark the row
      // with a generic error so the next tick can retry it.
      logError("Unexpected error handling delivery entry", err, {
        action: "ap_delivery_tick_entry",
        entryId: row.id,
      });
      try {
        await db.update(apDeliveryQueue)
          .set({
            lastError: err instanceof Error
              ? err.message.slice(0, 500)
              : "unknown_error",
          })
          .where(eq(apDeliveryQueue.id, row.id));
      } catch (_innerErr) {
        // Ignore nested DB errors — next tick will retry.
      }
    }
  }

  if (rows.length > 0) {
    logInfo("Delivery queue tick completed", {
      action: "ap_delivery_tick",
      scanned: String(rows.length),
      delivered: String(delivered),
      requeued: String(requeued),
      dlq: String(dlq),
    });
  }

  return {
    scanned: rows.length,
    delivered,
    requeued,
    dlq,
  };
}

/**
 * Count pending / delivered / failed entries for observability dashboards
 * and tests. Callers should not rely on this for hot-path logic.
 */
export async function countDeliveryQueueStatuses(
  dbBinding: D1Database,
): Promise<{ pending: number; delivered: number; failed: number }> {
  const db = getDb(dbBinding);
  const result = await db.select({
    status: apDeliveryQueue.status,
    count: sql<number>`count(*)`,
  })
    .from(apDeliveryQueue)
    .groupBy(apDeliveryQueue.status)
    .all();

  const counts = { pending: 0, delivered: 0, failed: 0 };
  for (const row of result) {
    if (row.status === "pending") counts.pending = Number(row.count);
    else if (row.status === "delivered") counts.delivered = Number(row.count);
    else if (row.status === "failed") counts.failed = Number(row.count);
  }
  return counts;
}
