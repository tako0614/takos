export declare const NOTIFICATION_CHANNELS: readonly ["in_app", "email", "push"];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export declare const NOTIFICATION_TYPES: readonly ["deploy.completed", "deploy.failed", "run.completed", "run.failed", "pr.review.requested", "pr.comment", "social.followed", "social.follow.requested", "social.follow.accepted", "workspace.invite", "billing.quota_warning", "security.new_login"];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export declare function isNotificationChannel(value: unknown): value is NotificationChannel;
export declare function isNotificationType(value: unknown): value is NotificationType;
export type NotificationPreferenceMatrix = Record<NotificationType, Record<NotificationChannel, boolean>>;
export declare const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceMatrix;
//# sourceMappingURL=notification-models.d.ts.map