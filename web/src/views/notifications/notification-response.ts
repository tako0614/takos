export const NOTIFICATION_TYPES = [
  "deploy.completed",
  "deploy.failed",
  "run.completed",
  "run.failed",
  "pr.review.requested",
  "pr.comment",
  "workspace.invite",
  "billing.quota_warning",
  "security.new_login",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationItem {
  id: string;
  spaceId: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const NOTIFICATION_TYPE_SET = new Set<string>(NOTIFICATION_TYPES);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Notification response is missing ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function timestamp(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Notification response has invalid ${field}`);
  }
  return text;
}

function parseNotification(value: unknown): NotificationItem {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid notification response item");
  const type = requiredString(candidate.type, "type");
  if (!NOTIFICATION_TYPE_SET.has(type)) {
    throw new TypeError("Notification response has unknown type");
  }
  const data = record(candidate.data);
  if (!data) throw new TypeError("Notification response has invalid data");
  return {
    id: requiredString(candidate.id, "id"),
    spaceId: candidate.space_id === null
      ? null
      : requiredString(candidate.space_id, "space_id"),
    type: type as NotificationType,
    title: requiredString(candidate.title, "title"),
    body: optionalString(candidate.body, "body"),
    data,
    readAt: candidate.read_at === null
      ? null
      : timestamp(candidate.read_at, "read_at"),
    createdAt: timestamp(candidate.created_at, "created_at"),
  };
}

export function parseNotificationPage(value: unknown): NotificationItem[] {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.notifications)) {
    throw new TypeError("Invalid notification list response");
  }
  const notifications = candidate.notifications.map(parseNotification);
  const ids = new Set<string>();
  for (const notification of notifications) {
    if (ids.has(notification.id)) {
      throw new TypeError("Notification response contains duplicate ids");
    }
    ids.add(notification.id);
  }
  return notifications;
}

export function parseUnreadCount(value: unknown): number {
  const candidate = record(value);
  const count = candidate?.unread_count;
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new TypeError("Invalid notification unread count response");
  }
  return count as number;
}

export function parseNotificationMutation(value: unknown): true {
  const candidate = record(value);
  if (candidate?.success !== true) {
    throw new TypeError("Invalid notification mutation response");
  }
  return true;
}

export function mergeNotificationPages(
  current: readonly NotificationItem[],
  incoming: readonly NotificationItem[],
): NotificationItem[] {
  const ids = new Set(current.map((notification) => notification.id));
  return [
    ...current,
    ...incoming.filter((notification) => !ids.has(notification.id)),
  ];
}

export function notificationPageCursor(
  notifications: readonly NotificationItem[],
): { before: string; beforeId: string } | null {
  const last = notifications.at(-1);
  return last ? { before: last.createdAt, beforeId: last.id } : null;
}

function dataString(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getNotificationTargetPath(
  notification: NotificationItem,
): string | null {
  if (notification.type === "workspace.invite") {
    // Historical rows remain readable, but Takos no longer exposes Workspace
    // membership or an invitation destination.
    return null;
  }

  if (
    notification.type !== "run.completed" &&
    notification.type !== "run.failed"
  ) {
    return null;
  }
  const route = dataString(notification.data, "route");
  if (!route || !route.startsWith("/") || route.startsWith("//")) return null;

  const base = "https://notification-route.invalid";
  const parsed = new URL(route, base);
  if (parsed.origin !== base || parsed.hash || parsed.username || parsed.password) {
    return null;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "chat") return null;
  try {
    const routeSpaceId = decodeURIComponent(parts[1]);
    const routeThreadId = decodeURIComponent(parts[2]);
    if (
      !notification.spaceId ||
      routeSpaceId !== notification.spaceId ||
      dataString(notification.data, "thread_id") !== routeThreadId
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function dispatchNotificationsChanged(): void {
  globalThis.dispatchEvent?.(new Event("takos:notifications-changed"));
}
