import {
  createMobileApiClient,
  mobileRecord,
  mobileOptionalText,
  type FetchLike,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";

export interface TakosMobileNotificationPreview {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly createdAt?: string;
  readonly routePath: string;
  readonly unread: boolean;
}

export const takosMobileNotificationTypes = [
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

export const takosMobileNotificationChannels = [
  "in_app",
  "email",
  "push",
] as const;

/**
 * Takos-owned mobile push is deliberately limited to terminal Agent Run
 * outcomes. Social and messaging push belongs to Yurucommu / Yurumeet.
 */
export const takosMobilePushNotificationTypes = [
  "run.completed",
  "run.failed",
] as const satisfies readonly TakosMobileNotificationType[];

export type TakosMobileNotificationType =
  (typeof takosMobileNotificationTypes)[number];

export type TakosMobileNotificationChannel =
  (typeof takosMobileNotificationChannels)[number];

export type TakosMobileNotificationPreferences = Record<
  TakosMobileNotificationType,
  Record<TakosMobileNotificationChannel, boolean>
>;

export interface TakosMobileNotificationSettings {
  readonly preferences: TakosMobileNotificationPreferences;
  readonly pushSupportedTypes: readonly TakosMobileNotificationType[];
  readonly mutedUntil?: string;
}

export interface TakosMobileNotificationsCursor {
  readonly before: string;
  readonly beforeId: string;
}

export interface TakosMobileNotificationsPage {
  readonly notifications: readonly TakosMobileNotificationPreview[];
  readonly nextCursor?: TakosMobileNotificationsCursor;
}

export interface LoadTakosMobileNotificationsPageInput {
  readonly session: MobileSession;
  readonly limit?: number;
  readonly cursor?: TakosMobileNotificationsCursor;
  readonly fetch?: FetchLike;
}

export interface MarkTakosMobileNotificationReadInput {
  readonly session: MobileSession;
  readonly notificationId: string;
  readonly fetch?: FetchLike;
}

export interface MarkAllTakosMobileNotificationsReadInput {
  readonly session: MobileSession;
  readonly fetch?: FetchLike;
}

export interface UpdateTakosMobileNotificationPreferenceInput {
  readonly session: MobileSession;
  readonly type: TakosMobileNotificationType;
  readonly channel: TakosMobileNotificationChannel;
  readonly enabled: boolean;
  readonly fetch?: FetchLike;
}

export interface SetTakosMobileNotificationsMutedUntilInput {
  readonly session: MobileSession;
  readonly mutedUntil?: string;
  readonly fetch?: FetchLike;
}

export async function loadTakosMobileNotificationSettings(input: {
  readonly session: MobileSession;
  readonly fetch?: FetchLike;
}): Promise<TakosMobileNotificationSettings> {
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const [preferencesResponse, settingsResponse] = await Promise.all([
    client.json<TakosNotificationPreferencesResponse>(
      "/api/notifications/preferences",
    ),
    client.json<TakosNotificationSettingsResponse>(
      "/api/notifications/settings",
    ),
  ]);
  return {
    preferences: normalizeNotificationPreferences(
      preferencesResponse.preferences,
    ),
    pushSupportedTypes: normalizePushSupportedNotificationTypes(
      preferencesResponse.push_supported_types,
    ),
    mutedUntil: mobileOptionalText(settingsResponse.muted_until),
  };
}

export async function updateTakosMobileNotificationPreference(
  input: UpdateTakosMobileNotificationPreferenceInput,
): Promise<TakosMobileNotificationPreferences> {
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<TakosNotificationPreferencesResponse>(
    "/api/notifications/preferences",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        updates: [
          {
            type: input.type,
            channel: input.channel,
            enabled: input.enabled,
          },
        ],
      }),
    },
  );
  return normalizeNotificationPreferences(response.preferences);
}

export async function setTakosMobileNotificationsMutedUntil(
  input: SetTakosMobileNotificationsMutedUntilInput,
): Promise<{ readonly mutedUntil?: string }> {
  const mutedUntil = input.mutedUntil?.trim();
  if (mutedUntil && !Number.isFinite(Date.parse(mutedUntil))) {
    throw new Error("Muted-until timestamp must be a valid datetime.");
  }

  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<TakosNotificationSettingsResponse>(
    "/api/notifications/settings",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        muted_until: mutedUntil || null,
      }),
    },
  );
  return {
    mutedUntil: mobileOptionalText(response.muted_until),
  };
}

export async function loadTakosMobileNotificationsPage(
  input: LoadTakosMobileNotificationsPageInput,
): Promise<TakosMobileNotificationsPage> {
  const limit = normalizeNotificationLimit(input.limit);
  const params = new URLSearchParams({ limit: String(limit) });
  const before = input.cursor?.before.trim();
  const beforeId = input.cursor?.beforeId.trim();
  if (before) {
    params.set("before", before);
  }
  if (beforeId) {
    params.set("before_id", beforeId);
  }

  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<TakosNotificationsResponse>(
    `/api/notifications?${params.toString()}`,
  );
  const notifications = Array.isArray(response.notifications)
    ? response.notifications
        .map((notification) => summarizeTakosMobileNotification(notification))
        .filter(
          (notification): notification is TakosMobileNotificationPreview =>
            Boolean(notification),
        )
    : [];
  const lastNotification = notifications[notifications.length - 1];
  const nextCursor =
    notifications.length === limit && lastNotification?.createdAt
      ? {
          before: lastNotification.createdAt,
          beforeId: lastNotification.id,
        }
      : undefined;

  return { notifications, nextCursor };
}

export async function markTakosMobileNotificationRead(
  input: MarkTakosMobileNotificationReadInput,
): Promise<void> {
  const notificationId = input.notificationId.trim();
  if (!notificationId) {
    throw new Error("Notification id is required.");
  }

  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  await client.json(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    {
      method: "PATCH",
    },
  );
}

export async function markAllTakosMobileNotificationsRead(
  input: MarkAllTakosMobileNotificationsReadInput,
): Promise<void> {
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  await client.json("/api/notifications/read-all", {
    method: "PATCH",
  });
}

export function summarizeTakosMobileNotification(
  notification: unknown,
): TakosMobileNotificationPreview | undefined {
  if (!notification || typeof notification !== "object") return undefined;
  const record = notification as Record<string, unknown>;
  const id = mobileOptionalText(record.id);
  const title = mobileOptionalText(record.title);
  if (!id || !title) return undefined;
  return {
    id,
    title,
    body: mobileOptionalText(record.body)?.slice(0, 140),
    createdAt: mobileOptionalText(record.created_at),
    routePath: resolveNotificationRoutePath(record),
    unread: record.read_at == null,
  };
}

interface TakosNotificationsResponse {
  readonly notifications?: readonly unknown[];
}

interface TakosNotificationPreferencesResponse {
  readonly preferences?: unknown;
  readonly push_supported_types?: unknown;
}

interface TakosNotificationSettingsResponse {
  readonly muted_until?: string | null;
}

function normalizeNotificationPreferences(
  value: unknown,
): TakosMobileNotificationPreferences {
  const source = mobileRecord(value) ?? {};
  const preferences = {} as TakosMobileNotificationPreferences;
  for (const type of takosMobileNotificationTypes) {
    const row = mobileRecord(source[type]) ?? {};
    preferences[type] = {
      in_app: row.in_app === true,
      email: row.email === true,
      push: row.push === true,
    };
  }
  return preferences;
}

function normalizePushSupportedNotificationTypes(
  value: unknown,
): readonly TakosMobileNotificationType[] {
  if (!Array.isArray(value)) return [];
  const supported = new Set(
    value.filter((type): type is string => typeof type === "string"),
  );
  return takosMobilePushNotificationTypes.filter((type) => supported.has(type));
}

function normalizeNotificationLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.trunc(limit as number), 1), 50);
}

function resolveNotificationRoutePath(record: Record<string, unknown>): string {
  const data = mobileRecord(record.data);
  return (
    readRoutePath(data?.path) ??
    readRoutePath(data?.route) ??
    readRoutePath(data?.href) ??
    readRoutePath(data?.url) ??
    readRoutePath(record.path) ??
    "/notifications"
  );
}

function readRoutePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const routePath = value.trim();
  if (!routePath.startsWith("/") || routePath.startsWith("//")) {
    return undefined;
  }
  return routePath;
}
