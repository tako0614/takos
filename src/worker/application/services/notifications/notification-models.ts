export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Keep this list stable. DB stores these values.
export const NOTIFICATION_TYPES = [
  // Deployments
  "deploy.completed",
  "deploy.failed",
  // Agent runs
  "run.completed",
  "run.failed",
  // Pull requests
  "pr.review.requested",
  "pr.comment",
  // Workspace
  "workspace.invite",
  // Billing
  "billing.quota_warning",
  // Security
  "security.new_login",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Takos product notifications that may leave the inbox through mobile push.
 *
 * Keep this exported list stable for service and client capability discovery.
 * Social and messaging push taxonomies belong to their owning products
 * (Yurucommu / Yurumeet), not to the Takos notification preference matrix.
 */
export const PUSH_SUPPORTED_NOTIFICATION_TYPES = [
  "run.completed",
  "run.failed",
] as const satisfies readonly NotificationType[];

export type PushSupportedNotificationType =
  (typeof PUSH_SUPPORTED_NOTIFICATION_TYPES)[number];

export function isPushSupportedNotificationType(
  value: unknown,
): value is PushSupportedNotificationType {
  return (
    typeof value === "string" &&
    (PUSH_SUPPORTED_NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export function isNotificationChannel(
  value: unknown,
): value is NotificationChannel {
  return (
    typeof value === "string" &&
    (NOTIFICATION_CHANNELS as readonly string[]).includes(value)
  );
}

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

export type NotificationPreferenceMatrix = Record<
  NotificationType,
  Record<NotificationChannel, boolean>
>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceMatrix = {
  "deploy.completed": { in_app: true, email: true, push: false },
  "deploy.failed": { in_app: true, email: true, push: false },

  "run.completed": { in_app: true, email: false, push: true },
  "run.failed": { in_app: true, email: true, push: true },

  "pr.review.requested": { in_app: true, email: false, push: false },
  "pr.comment": { in_app: true, email: false, push: false },

  "workspace.invite": { in_app: true, email: true, push: false },

  "billing.quota_warning": { in_app: true, email: true, push: false },

  "security.new_login": { in_app: true, email: true, push: false },
};
