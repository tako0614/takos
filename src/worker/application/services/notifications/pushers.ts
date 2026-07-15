import { and, asc, eq, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  NotificationPusher,
  NotificationPusherRegistration,
} from "takosumi-contract";

import { getDb, notificationPushers } from "../../../infra/db/index.ts";
import type { SqlDatabaseLike } from "../../../infra/db/client.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";

export const MAX_NOTIFICATION_PUSHERS_PER_ACCOUNT = 16;
export const MAX_NOTIFICATION_PUSHERS_PER_APP = 8;
export const MAX_NOTIFICATION_PUSHER_DATA_BYTES = 2 * 1024;
const MAX_NOTIFICATION_PUSHER_DATA_DEPTH = 8;
const MAX_NOTIFICATION_PUSHER_DATA_ENTRIES = 64;
const MAX_NOTIFICATION_PUSHER_DATA_ARRAY_LENGTH = 64;
const MAX_NOTIFICATION_PUSHER_DATA_KEY_BYTES = 128;
const MAX_NOTIFICATION_PUSHER_DATA_STRING_BYTES = 1024;
const QUOTA_DELETE_BATCH_SIZE = 40;

export type NotificationPusherCompareKey = {
  readonly id: string;
  readonly accountId: string;
  readonly appId: string;
  readonly pushkey: string;
  readonly pushkeyHash: string;
  readonly gatewayUrl: string;
  readonly data: string;
  readonly updatedAt: string;
};

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

export type NotificationPusherDataValidationResult =
  | {
      readonly ok: true;
      readonly data: NotificationPusherRegistration["data"];
      readonly serialized: string;
    }
  | { readonly ok: false; readonly reason: string };

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
  const dataValidation = validateNotificationPusherDataForStorage(input.pusher);
  if (!dataValidation.ok) {
    throw new RangeError(dataValidation.reason);
  }
  const { data, serialized: serializedData } = dataValidation;
  const pushkeyHash = await sha256Hex(input.pusher.pushkey);
  const existing = await db
    .select({
      id: notificationPushers.id,
      accountId: notificationPushers.accountId,
    })
    .from(notificationPushers)
    .where(
      and(
        eq(notificationPushers.appId, input.pusher.app_id),
        eq(notificationPushers.pushkeyHash, pushkeyHash),
      ),
    )
    .get();

  const row = await db
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
      data: serializedData,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      // Global app+token ownership makes cross-account reassignment one atomic
      // UPSERT. A second writer can win, but the two accounts can never both
      // retain (or mutually delete) the same provider token.
      target: [notificationPushers.appId, notificationPushers.pushkeyHash],
      set: {
        accountId: input.accountId,
        product: input.product ?? null,
        scope: input.scope ?? null,
        kind: input.pusher.kind,
        pushkey: input.pusher.pushkey,
        appDisplayName: input.pusher.app_display_name ?? null,
        deviceDisplayName: input.pusher.device_display_name ?? null,
        profileTag: input.pusher.profile_tag ?? null,
        lang: input.pusher.lang ?? null,
        gatewayUrl: input.gatewayUrl,
        data: serializedData,
        updatedAt: now,
        lastSeenAt: now,
      },
    })
    .returning({
      id: notificationPushers.id,
      accountId: notificationPushers.accountId,
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
    .get();

  if (!row) throw new Error("Failed to register notification pusher");
  if (!existing || existing.accountId !== input.accountId) {
    await enforceNotificationPusherQuota(db, {
      accountId: input.accountId,
      appId: input.pusher.app_id,
      protectedId: row.id,
    });
  }
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

export function validateNotificationPusherDataForStorage(
  pusher: NotificationPusher,
): NotificationPusherDataValidationResult {
  return validateNotificationPusherStoredData(pusherDataWithoutUrl(pusher));
}

export function validateNotificationPusherStoredData(
  value: unknown,
): NotificationPusherDataValidationResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.prototype.hasOwnProperty.call(value, "url")
  ) {
    return {
      ok: false,
      reason: "pusher.data must be a JSON object without url",
    };
  }
  const data = value as NotificationPusherRegistration["data"];
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return { ok: false, reason: "pusher.data must be valid JSON" };
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_NOTIFICATION_PUSHER_DATA_BYTES
  ) {
    return {
      ok: false,
      reason: `pusher.data must be at most ${MAX_NOTIFICATION_PUSHER_DATA_BYTES} bytes without url`,
    };
  }

  const budget = { entries: 0 };
  if (!isJsonWithinStorageBudget(data, 0, budget)) {
    return {
      ok: false,
      reason: "pusher.data exceeds the supported structure limits",
    };
  }
  return { ok: true, data, serialized };
}

async function enforceNotificationPusherQuota(
  db: ReturnType<typeof getDb>,
  input: {
    readonly accountId: string;
    readonly appId: string;
    readonly protectedId: string;
  },
): Promise<void> {
  const appCandidates = await selectCompareCandidates(
    db,
    and(
      eq(notificationPushers.accountId, input.accountId),
      eq(notificationPushers.appId, input.appId),
      ne(notificationPushers.id, input.protectedId),
    ),
  );
  const appExcess = Math.max(
    0,
    appCandidates.length + 1 - MAX_NOTIFICATION_PUSHERS_PER_APP,
  );
  await compareAndDeleteNotificationPushers(
    db,
    appCandidates.slice(0, appExcess),
  );

  const accountCandidates = await selectCompareCandidates(
    db,
    and(
      eq(notificationPushers.accountId, input.accountId),
      ne(notificationPushers.id, input.protectedId),
    ),
  );
  const accountExcess = Math.max(
    0,
    accountCandidates.length + 1 - MAX_NOTIFICATION_PUSHERS_PER_ACCOUNT,
  );
  await compareAndDeleteNotificationPushers(
    db,
    accountCandidates.slice(0, accountExcess),
  );
}

async function selectCompareCandidates(
  db: ReturnType<typeof getDb>,
  condition: SQL | undefined,
): Promise<NotificationPusherCompareKey[]> {
  return db
    .select({
      id: notificationPushers.id,
      accountId: notificationPushers.accountId,
      appId: notificationPushers.appId,
      pushkey: notificationPushers.pushkey,
      pushkeyHash: notificationPushers.pushkeyHash,
      gatewayUrl: notificationPushers.gatewayUrl,
      data: notificationPushers.data,
      updatedAt: notificationPushers.updatedAt,
    })
    .from(notificationPushers)
    .where(condition)
    .orderBy(
      asc(notificationPushers.lastSeenAt),
      asc(notificationPushers.updatedAt),
      asc(notificationPushers.id),
    )
    .all();
}

export async function compareAndDeleteNotificationPushers(
  db: ReturnType<typeof getDb>,
  candidates: readonly NotificationPusherCompareKey[],
): Promise<number> {
  let deleted = 0;
  for (
    let offset = 0;
    offset < candidates.length;
    offset += QUOTA_DELETE_BATCH_SIZE
  ) {
    const batch = candidates.slice(offset, offset + QUOTA_DELETE_BATCH_SIZE);
    const result = await db
      .delete(notificationPushers)
      .where(
        or(
          ...batch.map((row) =>
            and(
              eq(notificationPushers.id, row.id),
              eq(notificationPushers.accountId, row.accountId),
              eq(notificationPushers.appId, row.appId),
              eq(notificationPushers.pushkey, row.pushkey),
              eq(notificationPushers.pushkeyHash, row.pushkeyHash),
              eq(notificationPushers.gatewayUrl, row.gatewayUrl),
              eq(notificationPushers.data, row.data),
              eq(notificationPushers.updatedAt, row.updatedAt),
            ),
          ),
        ),
      )
      .run();
    deleted += affectedRowCount(result);
  }
  return deleted;
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

function isJsonWithinStorageBudget(
  value: unknown,
  depth: number,
  budget: { entries: number },
): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    return (
      new TextEncoder().encode(value).byteLength <=
      MAX_NOTIFICATION_PUSHER_DATA_STRING_BYTES
    );
  }
  if (depth > MAX_NOTIFICATION_PUSHER_DATA_DEPTH) return false;
  if (Array.isArray(value)) {
    if (value.length > MAX_NOTIFICATION_PUSHER_DATA_ARRAY_LENGTH) return false;
    budget.entries += value.length;
    if (budget.entries > MAX_NOTIFICATION_PUSHER_DATA_ENTRIES) return false;
    return value.every((entry) =>
      isJsonWithinStorageBudget(entry, depth + 1, budget),
    );
  }
  if (!value || typeof value !== "object") return false;

  const entries = Object.entries(value);
  budget.entries += entries.length;
  if (budget.entries > MAX_NOTIFICATION_PUSHER_DATA_ENTRIES) return false;
  return entries.every(
    ([key, nested]) =>
      new TextEncoder().encode(key).byteLength <=
        MAX_NOTIFICATION_PUSHER_DATA_KEY_BYTES &&
      isJsonWithinStorageBudget(nested, depth + 1, budget),
  );
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
