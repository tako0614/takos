export const NOTIFICATION_PUSH_QUEUE_MAX_RETRIES = 5;
export const NOTIFICATION_PUSH_QUEUE_MAX_BATCH_SIZE = 5;
export const NOTIFICATION_PUSH_QUEUE_MAX_BATCH_TIMEOUT_SECONDS = 5;
export const NOTIFICATION_PUSH_QUEUE_MAX_CONCURRENCY = 5;
export const NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS = 5;
export const NOTIFICATION_PUSH_QUEUE_RETRY_MAX_FALLBACK_SECONDS = 15 * 60;
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
