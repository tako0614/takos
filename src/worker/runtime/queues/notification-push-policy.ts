export const NOTIFICATION_PUSH_QUEUE_MAX_RETRIES = 5;
export const NOTIFICATION_PUSH_QUEUE_MAX_BATCH_SIZE = 5;
export const NOTIFICATION_PUSH_QUEUE_MAX_BATCH_TIMEOUT_SECONDS = 5;
export const NOTIFICATION_PUSH_QUEUE_MAX_CONCURRENCY = 5;
export const NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS = 5;
export const NOTIFICATION_PUSH_QUEUE_RETRY_MAX_FALLBACK_SECONDS = 15 * 60;
// The DLQ has no second DLQ. Keep D1 outages out of the default three-retry
// deletion path while remaining bounded below the shortest Queue retention.
export const NOTIFICATION_PUSH_DLQ_MAX_RETRIES = 100;
export const NOTIFICATION_PUSH_DLQ_RETRY_DELAY_SECONDS = 10 * 60;
// Cloudflare Queues currently permits delayed send/retry up to 24 hours.
export { MAX_NOTIFICATION_PUSH_RETRY_AFTER_SECONDS as NOTIFICATION_PUSH_QUEUE_RETRY_MAX_DELAY_SECONDS } from "../../shared/constants/notification-push.ts";

export function notificationPushQueueFallbackDelaySeconds(
  attempts: number,
): number {
  const exponent = Math.max(0, Math.min(20, Math.trunc(attempts) - 1));
  return Math.min(
    NOTIFICATION_PUSH_QUEUE_RETRY_MAX_FALLBACK_SECONDS,
    NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS * 2 ** exponent,
  );
}
