import { eq } from "drizzle-orm";

import {
  isValidNotificationPushQueueMessage,
  type MessageQueueBatch,
  type NotificationPushQueueMessage,
} from "../../shared/types/index.ts";
import type { NotificationPushDeliveryEnv } from "../../application/services/notifications/mobile-push-delivery.ts";
import { deliverNotificationToPushers } from "../../application/services/notifications/mobile-push-delivery.ts";
import { getDb, notifications } from "../../infra/db/index.ts";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import {
  notificationPushQueueFallbackDelaySeconds,
  NOTIFICATION_PUSH_DLQ_RETRY_DELAY_SECONDS,
} from "./notification-push-policy.ts";
import { isPushSupportedNotificationType } from "../../application/services/notifications/notification-models.ts";
import {
  getNotificationPreferences,
  isNotificationsMuted,
} from "../../application/services/notifications/service.ts";
import {
  markNotificationPushOutboxDone,
  recordNotificationPushOutboxEnqueued,
  reopenNotificationPushOutboxFromDlq,
} from "../../application/services/notifications/push-outbox.ts";

export type NotificationPushQueueEnv = NotificationPushDeliveryEnv;

export async function handleNotificationPushQueue(
  batch: MessageQueueBatch<unknown>,
  env: NotificationPushQueueEnv,
): Promise<void> {
  for (const message of batch.messages) {
    if (!isValidNotificationPushQueueMessage(message.body)) {
      logError("Invalid notification push queue message", undefined, {
        module: "notification_push_queue",
        transport_message_id: message.id,
      });
      message.ack();
      continue;
    }

    try {
      const body = message.body;
      const notification = await getDb(env.DB)
        .select({
          userId: notifications.recipientAccountId,
          scopeId: notifications.accountId,
          type: notifications.type,
        })
        .from(notifications)
        .where(eq(notifications.id, body.notificationId))
        .get();
      if (!notification) {
        logInfo("Notification push queue target no longer exists", {
          module: "notification_push_queue",
          notification_id: body.notificationId,
          transport_message_id: message.id,
        });
        message.ack();
        continue;
      }
      if (body.userId !== notification.userId) {
        logWarn(
          "Notification push queue recipient does not match stored event",
          {
            module: "notification_push_queue",
            notification_id: body.notificationId,
            transport_message_id: message.id,
          },
        );
        message.ack();
        continue;
      }
      if ((body.scopeId ?? null) !== (notification.scopeId ?? null)) {
        logWarn("Notification push queue scope does not match stored event", {
          module: "notification_push_queue",
          notification_id: body.notificationId,
          transport_message_id: message.id,
        });
        message.ack();
        continue;
      }

      // Old producers may have queued an event before the durable push outbox
      // existed. Adopt every valid event before gateway delivery so terminal
      // acknowledgement and DLQ replay always have a D1 authority.
      const replayStatus = await recordNotificationPushOutboxEnqueued(
        env.DB,
        body.notificationId,
      );
      if (replayStatus === "done") {
        logInfo("Notification push queue collapsed a completed duplicate", {
          module: "notification_push_queue",
          notification_id: body.notificationId,
          transport_message_id: message.id,
        });
        message.ack();
        continue;
      }
      if (!isPushSupportedNotificationType(notification.type)) {
        logWarn("Notification push queue ignored unsupported event type", {
          module: "notification_push_queue",
          notification_id: body.notificationId,
          notification_type: notification.type,
          transport_message_id: message.id,
        });
        await markNotificationPushOutboxDone(env.DB, body.notificationId);
        message.ack();
        continue;
      }

      // Queue delivery is intentionally at-least-once and may happen well
      // after notification creation. Re-evaluate the recipient's current
      // preference and mute state so a later opt-out is authoritative.
      const [preferences, muted] = await Promise.all([
        getNotificationPreferences(env.DB, body.userId),
        isNotificationsMuted(env.DB, body.userId),
      ]);
      if (!preferences[notification.type].push || muted) {
        logInfo("Notification push queue skipped by current preferences", {
          module: "notification_push_queue",
          notification_id: body.notificationId,
          notification_type: notification.type,
          muted,
          transport_message_id: message.id,
        });
        await markNotificationPushOutboxDone(env.DB, body.notificationId);
        message.ack();
        continue;
      }

      const result = await deliverNotificationToPushers(
        env,
        {
          userId: body.userId,
          notificationId: body.notificationId,
          spaceId: notification.scopeId,
        },
        { maxAttempts: 1 },
      );
      if (
        result.retryExhaustedCount > 0 ||
        result.configurationErrorCount > 0
      ) {
        const delaySeconds =
          result.retryAfterSeconds ??
          notificationPushQueueFallbackDelaySeconds(message.attempts);
        logWarn("Notification push queue delivery will retry", {
          module: "notification_push_queue",
          notification_id: body.notificationId,
          transport_message_id: message.id,
          attempts: message.attempts,
          delay_seconds: delaySeconds,
          gateway_batches: result.gatewayBatchCount,
          retry_exhausted: result.retryExhaustedCount,
          rejected: result.rejectedCount,
        });
        message.retry({ delaySeconds });
        continue;
      }

      logNotificationPushQueueResult(
        body,
        message.id,
        message.attempts,
        result,
      );
      await markNotificationPushOutboxDone(env.DB, body.notificationId);
      message.ack();
    } catch (error) {
      const delaySeconds = notificationPushQueueFallbackDelaySeconds(
        message.attempts,
      );
      logError("Notification push queue handler failed", error, {
        module: "notification_push_queue",
        transport_message_id: message.id,
        attempts: message.attempts,
        delay_seconds: delaySeconds,
      });
      message.retry({ delaySeconds });
    }
  }
}

export async function handleNotificationPushDlq(
  batch: MessageQueueBatch<unknown>,
  env: NotificationPushQueueEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const body = isValidNotificationPushQueueMessage(message.body)
      ? message.body
      : undefined;
    logError("CRITICAL: notification push message reached DLQ", undefined, {
      module: "notification_push_dlq",
      transport_message_id: message.id,
      attempts: message.attempts,
      ...(body ? { notification_id: body.notificationId } : {}),
      valid_message: Boolean(body),
    });
    if (!body) {
      message.ack();
      continue;
    }

    try {
      const replayStatus = await reopenNotificationPushOutboxFromDlq(
        env.DB,
        body.notificationId,
        `main Queue exhausted after ${message.attempts} attempts`,
      );
      logWarn("Notification push DLQ transferred replay ownership to D1", {
        module: "notification_push_dlq",
        notification_id: body.notificationId,
        transport_message_id: message.id,
        replay_status: replayStatus,
      });
      // Ack only after the durable state transition commits. `done` and
      // `missing` are already terminal; `queued` is owned by cron replay.
      message.ack();
    } catch (error) {
      const delaySeconds = Math.min(
        NOTIFICATION_PUSH_DLQ_RETRY_DELAY_SECONDS,
        Math.max(
          60,
          notificationPushQueueFallbackDelaySeconds(message.attempts),
        ),
      );
      logError("Notification push DLQ replay persistence failed", error, {
        module: "notification_push_dlq",
        notification_id: body.notificationId,
        transport_message_id: message.id,
        delay_seconds: delaySeconds,
      });
      message.retry({ delaySeconds });
    }
  }
}

function logNotificationPushQueueResult(
  body: NotificationPushQueueMessage,
  transportMessageId: string,
  attempts: number,
  result: Awaited<ReturnType<typeof deliverNotificationToPushers>>,
): void {
  const context = {
    module: "notification_push_queue",
    notification_id: body.notificationId,
    transport_message_id: transportMessageId,
    attempts,
    selected: result.selectedPusherCount,
    gateway_batches: result.gatewayBatchCount,
    rejected: result.rejectedCount,
    deleted_rejected: result.deletedRejectedCount,
    permanent_failures: result.permanentFailureCount,
    configuration_errors: result.configurationErrorCount,
    skipped_invalid: result.skippedInvalidPusherCount,
    selection_truncated: result.selectionTruncated,
  };
  if (
    result.permanentFailureCount > 0 ||
    result.configurationErrorCount > 0 ||
    result.skippedInvalidPusherCount > 0 ||
    result.selectionTruncated
  ) {
    logWarn(
      "Notification push queue delivery acknowledged with failures",
      context,
    );
    return;
  }
  logInfo("Notification push queue delivery acknowledged", context);
}
