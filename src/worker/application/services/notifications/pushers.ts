import { and, eq } from "drizzle-orm";
import type {
  NotificationPusher,
  NotificationPusherRegistration,
} from "takosumi-contract";

import { getDb, notificationPushers } from "../../../infra/db/index.ts";
import type { SqlDatabaseLike } from "../../../infra/db/client.ts";
import { generateId } from "../../../shared/utils/index.ts";

export interface RegisterNotificationPusherInput {
  readonly accountId: string;
  readonly product?: string | null;
  readonly scope?: string | null;
  readonly pusher: NotificationPusher;
  readonly gatewayUrl: string;
}

export interface UnregisterNotificationPusherInput {
  readonly accountId: string;
  readonly appId: string;
  readonly pushkey: string;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function registerNotificationPusher(
  dbBinding: SqlDatabaseLike,
  input: RegisterNotificationPusherInput,
): Promise<NotificationPusherRegistration> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();
  const data = pusherDataWithoutUrl(input.pusher);
  const pushkeyHash = await sha256Hex(input.pusher.pushkey);

  await db
    .insert(notificationPushers)
    .values({
      id: generateId(16),
      accountId: input.accountId,
      product: input.product ?? null,
      scope: input.scope ?? null,
      kind: input.pusher.kind,
      appId: input.pusher.app_id,
      pushkey: input.pusher.pushkey,
      pushkeyHash,
      appDisplayName: input.pusher.app_display_name ?? null,
      deviceDisplayName: input.pusher.device_display_name ?? null,
      profileTag: input.pusher.profile_tag ?? null,
      lang: input.pusher.lang ?? null,
      gatewayUrl: input.gatewayUrl,
      data: JSON.stringify(data),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
        notificationPushers.accountId,
        notificationPushers.appId,
        notificationPushers.pushkeyHash,
      ],
      set: {
        product: input.product ?? null,
        scope: input.scope ?? null,
        kind: input.pusher.kind,
        pushkey: input.pusher.pushkey,
        appDisplayName: input.pusher.app_display_name ?? null,
        deviceDisplayName: input.pusher.device_display_name ?? null,
        profileTag: input.pusher.profile_tag ?? null,
        lang: input.pusher.lang ?? null,
        gatewayUrl: input.gatewayUrl,
        data: JSON.stringify(data),
        updatedAt: now,
        lastSeenAt: now,
      },
    });

  const row = await db
    .select({
      id: notificationPushers.id,
      kind: notificationPushers.kind,
      appId: notificationPushers.appId,
      appDisplayName: notificationPushers.appDisplayName,
      deviceDisplayName: notificationPushers.deviceDisplayName,
      profileTag: notificationPushers.profileTag,
      lang: notificationPushers.lang,
      gatewayUrl: notificationPushers.gatewayUrl,
      data: notificationPushers.data,
      product: notificationPushers.product,
      scope: notificationPushers.scope,
      createdAt: notificationPushers.createdAt,
      lastSeenAt: notificationPushers.lastSeenAt,
    })
    .from(notificationPushers)
    .where(
      and(
        eq(notificationPushers.accountId, input.accountId),
        eq(notificationPushers.appId, input.pusher.app_id),
        eq(notificationPushers.pushkeyHash, pushkeyHash),
      ),
    )
    .get();

  if (!row) throw new Error("Failed to register notification pusher");
  return {
    id: row.id,
    kind: "http",
    app_id: row.appId,
    app_display_name: row.appDisplayName ?? undefined,
    device_display_name: row.deviceDisplayName ?? undefined,
    profile_tag: row.profileTag ?? undefined,
    lang: row.lang ?? undefined,
    data: safeJsonObject(row.data),
    gateway_url: row.gatewayUrl,
    product: row.product,
    scope: row.scope,
    registered_at: row.createdAt,
    last_seen_at: row.lastSeenAt,
  };
}

export async function unregisterNotificationPusher(
  dbBinding: SqlDatabaseLike,
  input: UnregisterNotificationPusherInput,
): Promise<{ readonly deleted: true }> {
  const db = getDb(dbBinding);
  const pushkeyHash = await sha256Hex(input.pushkey);
  await db
    .delete(notificationPushers)
    .where(
      and(
        eq(notificationPushers.accountId, input.accountId),
        eq(notificationPushers.appId, input.appId),
        eq(notificationPushers.pushkeyHash, pushkeyHash),
      ),
    );

  return { deleted: true };
}

function pusherDataWithoutUrl(
  pusher: NotificationPusher,
): NotificationPusherRegistration["data"] {
  const { url: _url, ...data } = pusher.data;
  return data;
}

function safeJsonObject(value: string): NotificationPusherRegistration["data"] {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Return an empty pusher data bag for corrupt rows; dispatch can refresh it.
  }
  return {};
}
