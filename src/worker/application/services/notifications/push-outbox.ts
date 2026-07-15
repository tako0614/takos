import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";

import {
  getDb,
  notificationPushOutbox,
  notifications,
} from "../../../infra/db/index.ts";
import type {
  MessageQueueBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import {
  NOTIFICATION_PUSH_QUEUE_MESSAGE_VERSION,
  type NotificationPushQueueMessage,
} from "../../../shared/types/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";

export const NOTIFICATION_PUSH_OUTBOX_STALE_TRANSPORT_MS = 25 * 60 * 60 * 1000;

export type NotificationPushOutboxStatus =
  | "queued"
  | "dispatching"
  | "enqueued"
  | "done";

export interface NotificationPushOutboxEnv {
  DB: SqlDatabaseBinding;
  TAKOS_NOTIFICATION_PUSH_QUEUE?: MessageQueueBinding<NotificationPushQueueMessage>;
}

export interface DispatchNotificationPushOutboxOptions {
  notificationId?: string;
  /** Recover a Queue handoff older than the maximum supported Retry-After. */
  staleBefore?: string;
  limit?: number;
}

type DispatchableNotificationPush = {
  notificationId: string;
  deliveryStatus: string;
  userId: string | null;
  scopeId: string | null;
};

/**
 * Persist the event id before any transport handoff. Notification content,
 * device tokens, and gateway credentials deliberately remain outside this
 * table and are resolved from their owning records at delivery time.
 */
export async function ensureNotificationPushOutbox(
  dbBinding: SqlDatabaseBinding,
  notificationId: string,
  createdAt = new Date().toISOString(),
): Promise<void> {
  await getDb(dbBinding)
    .insert(notificationPushOutbox)
    .values({
      notificationId,
      deliveryStatus: "queued",
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing({ target: notificationPushOutbox.notificationId });
}

/** Record that the main Queue currently owns the event, including old producers. */
export async function recordNotificationPushOutboxEnqueued(
  dbBinding: SqlDatabaseBinding,
  notificationId: string,
  enqueuedAt = new Date().toISOString(),
): Promise<NotificationPushOutboxStatus> {
  const db = getDb(dbBinding);
  await db
    .insert(notificationPushOutbox)
    .values({
      notificationId,
      deliveryStatus: "enqueued",
      claimedAt: enqueuedAt,
      attempts: 0,
      createdAt: enqueuedAt,
      updatedAt: enqueuedAt,
    })
    .onConflictDoNothing({ target: notificationPushOutbox.notificationId });
  await db
    .update(notificationPushOutbox)
    .set({
      deliveryStatus: "enqueued",
      claimToken: null,
      claimedAt: enqueuedAt,
      lastError: null,
      updatedAt: enqueuedAt,
    })
    .where(
      and(
        eq(notificationPushOutbox.notificationId, notificationId),
        ne(notificationPushOutbox.deliveryStatus, "done"),
      ),
    );
  return (
    (await getNotificationPushOutboxStatus(dbBinding, notificationId)) ??
    "enqueued"
  );
}

export async function getNotificationPushOutboxStatus(
  dbBinding: SqlDatabaseBinding,
  notificationId: string,
): Promise<NotificationPushOutboxStatus | null> {
  const row = await getDb(dbBinding)
    .select({ status: notificationPushOutbox.deliveryStatus })
    .from(notificationPushOutbox)
    .where(eq(notificationPushOutbox.notificationId, notificationId))
    .get();
  return row?.status === "queued" ||
    row?.status === "dispatching" ||
    row?.status === "enqueued" ||
    row?.status === "done"
    ? row.status
    : null;
}

export async function markNotificationPushOutboxDone(
  dbBinding: SqlDatabaseBinding,
  notificationId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await getDb(dbBinding)
    .update(notificationPushOutbox)
    .set({
      deliveryStatus: "done",
      claimToken: null,
      claimedAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(notificationPushOutbox.notificationId, notificationId));
}

/**
 * Transfer a valid DLQ event back to D1 before acknowledging the DLQ message.
 * A concurrent or earlier terminal delivery remains terminal and is never
 * reopened. Missing notifications are already terminal because no payload can
 * be resolved for them.
 */
export async function reopenNotificationPushOutboxFromDlq(
  dbBinding: SqlDatabaseBinding,
  notificationId: string,
  lastError: string,
): Promise<"queued" | "done" | "missing"> {
  const db = getDb(dbBinding);
  const notification = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .get();
  if (!notification) return "missing";

  const now = new Date().toISOString();
  await ensureNotificationPushOutbox(dbBinding, notificationId, now);
  await db
    .update(notificationPushOutbox)
    .set({
      deliveryStatus: "queued",
      claimToken: null,
      claimedAt: null,
      lastError: lastError.slice(0, 2048),
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationPushOutbox.notificationId, notificationId),
        ne(notificationPushOutbox.deliveryStatus, "done"),
      ),
    );
  return (await getNotificationPushOutboxStatus(dbBinding, notificationId)) ===
    "done"
    ? "done"
    : "queued";
}

/**
 * Bounded D1-to-Queue dispatcher. It claims rows before Queue.send, reverts
 * only its exact claim after a definite send failure, and lets cron recover an
 * ambiguous send only after the Queue's maximum 24-hour Retry-After window.
 */
export async function dispatchNotificationPushOutbox(
  env: NotificationPushOutboxEnv,
  options: DispatchNotificationPushOutboxOptions = {},
): Promise<number> {
  if (!env.TAKOS_NOTIFICATION_PUSH_QUEUE) return 0;
  const db = getDb(env.DB);
  const staleTransportOwner = options.staleBefore
    ? and(
        or(
          eq(notificationPushOutbox.deliveryStatus, "dispatching"),
          eq(notificationPushOutbox.deliveryStatus, "enqueued"),
        ),
        or(
          isNull(notificationPushOutbox.claimedAt),
          lt(notificationPushOutbox.claimedAt, options.staleBefore),
        ),
      )
    : undefined;
  const statusPredicate = staleTransportOwner
    ? or(
        eq(notificationPushOutbox.deliveryStatus, "queued"),
        staleTransportOwner,
      )
    : eq(notificationPushOutbox.deliveryStatus, "queued");

  const rows = (await db
    .select({
      notificationId: notificationPushOutbox.notificationId,
      deliveryStatus: notificationPushOutbox.deliveryStatus,
      userId: notifications.recipientAccountId,
      scopeId: notifications.accountId,
    })
    .from(notificationPushOutbox)
    .leftJoin(
      notifications,
      eq(notificationPushOutbox.notificationId, notifications.id),
    )
    .where(
      and(
        statusPredicate,
        ...(options.notificationId
          ? [eq(notificationPushOutbox.notificationId, options.notificationId)]
          : []),
      ),
    )
    .limit(Math.max(1, Math.min(options.limit ?? 50, 100)))
    .all()) as DispatchableNotificationPush[];

  let sent = 0;
  for (const row of rows) {
    if (!row.userId) {
      await markNotificationPushOutboxDone(env.DB, row.notificationId);
      continue;
    }

    const claimedAt = new Date().toISOString();
    const claimToken = crypto.randomUUID();
    const expectedStatus =
      row.deliveryStatus === "queued"
        ? eq(notificationPushOutbox.deliveryStatus, "queued")
        : options.staleBefore
          ? and(
              or(
                eq(notificationPushOutbox.deliveryStatus, "dispatching"),
                eq(notificationPushOutbox.deliveryStatus, "enqueued"),
              ),
              or(
                isNull(notificationPushOutbox.claimedAt),
                lt(notificationPushOutbox.claimedAt, options.staleBefore),
              ),
            )
          : null;
    if (!expectedStatus) continue;

    const claim = await db
      .update(notificationPushOutbox)
      .set({
        deliveryStatus: "dispatching",
        claimToken,
        claimedAt,
        attempts: sql`${notificationPushOutbox.attempts} + 1`,
        lastError: null,
        updatedAt: claimedAt,
      })
      .where(
        and(
          eq(notificationPushOutbox.notificationId, row.notificationId),
          expectedStatus,
        ),
      );
    if (affectedRowCount(claim) === 0) continue;

    let queueAccepted = false;
    try {
      await env.TAKOS_NOTIFICATION_PUSH_QUEUE.send({
        version: NOTIFICATION_PUSH_QUEUE_MESSAGE_VERSION,
        notificationId: row.notificationId,
        userId: row.userId,
        ...(row.scopeId ? { scopeId: row.scopeId } : {}),
        timestamp: Date.now(),
      });
      queueAccepted = true;
      sent += 1;
      const finalized = await db
        .update(notificationPushOutbox)
        .set({
          deliveryStatus: "enqueued",
          claimToken: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(notificationPushOutbox.notificationId, row.notificationId),
            eq(notificationPushOutbox.deliveryStatus, "dispatching"),
            eq(notificationPushOutbox.claimToken, claimToken),
            eq(notificationPushOutbox.claimedAt, claimedAt),
          ),
        );
      if (affectedRowCount(finalized) === 0) {
        logWarn(
          "Notification push outbox handoff was finalized by another owner",
          {
            module: "notification_push_outbox",
            notification_id: row.notificationId,
          },
        );
      }
    } catch (error) {
      logError("Notification push outbox Queue handoff failed", error, {
        module: "notification_push_outbox",
        notification_id: row.notificationId,
        queue_accepted: queueAccepted,
      });
      // A successful Queue.send followed by an ambiguous D1 update must retain
      // `dispatching`: cron recovers it after the transport retry window. Only
      // a definite send failure may return the exact claim to `queued`.
      if (queueAccepted) continue;
      try {
        await db
          .update(notificationPushOutbox)
          .set({
            deliveryStatus: "queued",
            claimToken: null,
            claimedAt: null,
            lastError: String(error).slice(0, 2048),
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(notificationPushOutbox.notificationId, row.notificationId),
              eq(notificationPushOutbox.deliveryStatus, "dispatching"),
              eq(notificationPushOutbox.claimToken, claimToken),
              eq(notificationPushOutbox.claimedAt, claimedAt),
            ),
          );
      } catch (revertError) {
        logWarn("Notification push outbox claim revert failed", {
          module: "notification_push_outbox",
          notification_id: row.notificationId,
          error:
            revertError instanceof Error
              ? revertError.message
              : String(revertError),
        });
      }
    }
  }
  return sent;
}
