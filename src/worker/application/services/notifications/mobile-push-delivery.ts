import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  createNotificationPushGatewayRequest,
  type NotificationPusher,
  type NotificationPushGatewayResponse,
} from "takosumi-contract";

import { getDb, notificationPushers } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { MAX_NOTIFICATION_PUSH_RETRY_AFTER_SECONDS } from "../../../shared/constants/notification-push.ts";
import {
  compareAndDeleteNotificationPushers,
  validateNotificationPusherStoredData,
} from "./pushers.ts";
import {
  isLocalhost,
  isPrivateIP,
} from "@takos/worker-platform-utils/validation";

/**
 * Release-readiness marker for the product-owned notification delivery path.
 * Provider-specific APNs/FCM credentials and translation stay in the gateway.
 */
export const NOTIFICATION_PUSH_DELIVERY_BACKEND =
  "takos.notification-pusher-gateway.v1" as const;

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 365;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 15_000;
const MAX_GATEWAY_RESPONSE_BYTES = 64 * 1024;
const MAX_PUSHERS_PER_DELIVERY = 16;
// Keep one host batch within the Cloudflare Workers Free external-subrequest
// budget even when the gateway spends one request on FCM OAuth before device
// delivery (40 devices => at most 41 provider subrequests).
const MAX_DEVICES_PER_GATEWAY_REQUEST = 40;
const RETENTION_BATCH_SIZE = 500;

type StoredNotificationPusher = {
  readonly id: string;
  readonly accountId: string;
  readonly appId: string;
  readonly pushkey: string;
  readonly pushkeyHash: string;
  readonly gatewayUrl: string;
  readonly data: string;
  readonly updatedAt: string;
};

export type NotificationPushGatewayFailureKind =
  "configuration" | "permanent" | "retryable";

export type NotificationPushGatewayBatchResult = {
  readonly status:
    | "delivered"
    | "configuration_error"
    | "permanent_failure"
    | "retry_exhausted";
  readonly attempts: number;
  readonly deviceCount: number;
  readonly rejectedCount: number;
  readonly deletedRejectedCount: number;
  readonly permanentDeviceFailureCount: number;
  readonly failureKind?: NotificationPushGatewayFailureKind;
  readonly responseStatus?: number;
  readonly retryAfterSeconds?: number;
  readonly reason?: string;
};

export interface NotificationPushDeliveryResult {
  readonly selectedPusherCount: number;
  readonly selectionTruncated: boolean;
  readonly dispatchedPusherCount: number;
  readonly skippedInvalidPusherCount: number;
  readonly gatewayBatchCount: number;
  readonly rejectedCount: number;
  readonly deletedRejectedCount: number;
  readonly retryExhaustedCount: number;
  readonly permanentFailureCount: number;
  readonly configurationErrorCount: number;
  readonly retryAfterSeconds?: number;
  readonly batches: readonly NotificationPushGatewayBatchResult[];
}

export interface NotificationPusherRetentionResult {
  readonly cutoff: string;
  readonly selected: number;
  readonly deleted: number;
  readonly hasMore: boolean;
}

export interface DeliverNotificationPushOptions {
  readonly now?: Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxAttempts?: number;
}

export type NotificationPushDeliveryEnv = Pick<
  Env,
  | "DB"
  | "TAKOS_EGRESS"
  | "TAKOS_NOTIFICATION_PUSH_GATEWAY_URL"
  | "TAKOS_NOTIFICATION_PUSH_GATEWAY_TOKEN"
  | "TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS"
  | "TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK"
  | "TAKOS_NOTIFICATION_PUSH_MAX_ATTEMPTS"
  | "TAKOS_NOTIFICATION_PUSH_TIMEOUT_MS"
>;

export function validateNotificationPushGatewayUrl(
  value: string,
  options: {
    readonly allowedHosts?: string;
    readonly allowInsecureLoopback?: boolean;
  } = {},
):
  | { readonly ok: true; readonly url: string }
  | {
      readonly ok: false;
      readonly reason: string;
    } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "gateway URL is invalid" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "gateway URL must not contain credentials" };
  }
  if (url.hash) {
    return { ok: false, reason: "gateway URL must not contain a fragment" };
  }
  const hostname = normalizeHostname(url.hostname);
  const insecureLoopback =
    url.protocol === "http:" &&
    options.allowInsecureLoopback === true &&
    isExplicitLoopbackHostname(hostname);
  if (url.protocol !== "https:" && !insecureLoopback) {
    return { ok: false, reason: "gateway URL must use https" };
  }
  if (!insecureLoopback && url.port && url.port !== "443") {
    return { ok: false, reason: "gateway URL must use its default port" };
  }
  if (insecureLoopback && url.port === "0") {
    return { ok: false, reason: "gateway URL port is invalid" };
  }
  if (
    !insecureLoopback &&
    (!hostname ||
      isLocalhost(hostname) ||
      isPrivateIP(hostname) ||
      (!hostname.includes(".") && !hostname.includes(":")))
  ) {
    return { ok: false, reason: "gateway host must be a public hostname" };
  }
  if (!insecureLoopback && !hostAllowed(hostname, options.allowedHosts)) {
    return { ok: false, reason: "gateway host is not allowed" };
  }

  url.hostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  return { ok: true, url: url.toString() };
}

export function classifyNotificationPushGatewayStatus(
  status: number,
): NotificationPushGatewayFailureKind {
  return status === 408 || status === 425 || status === 429 || status >= 500
    ? "retryable"
    : "permanent";
}

export function parseNotificationPushRetryAfter(
  value: string | null | undefined,
  now: Date = new Date(),
): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  let seconds: number;
  if (/^\d+$/u.test(normalized)) {
    if (normalized.length > 15) {
      return MAX_NOTIFICATION_PUSH_RETRY_AFTER_SECONDS;
    }
    seconds = Number(normalized);
  } else {
    if (normalized.length > 128 || !/[A-Za-z]/u.test(normalized)) {
      return undefined;
    }
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) return undefined;
    seconds = Math.ceil((timestamp - now.getTime()) / 1_000);
  }
  if (!Number.isSafeInteger(seconds)) {
    return MAX_NOTIFICATION_PUSH_RETRY_AFTER_SECONDS;
  }
  if (seconds < 1) seconds = 1;
  return Math.min(MAX_NOTIFICATION_PUSH_RETRY_AFTER_SECONDS, seconds);
}

export async function deliverNotificationToPushers(
  env: NotificationPushDeliveryEnv,
  input: {
    readonly userId: string;
    readonly notificationId: string;
    readonly spaceId?: string | null;
  },
  options: DeliverNotificationPushOptions = {},
): Promise<NotificationPushDeliveryResult> {
  const db = getDb(env.DB);
  const selectedRows = await db
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
    .where(
      and(
        eq(notificationPushers.accountId, input.userId),
        or(
          eq(notificationPushers.product, "takos"),
          isNull(notificationPushers.product),
        ),
      ),
    )
    .orderBy(
      desc(notificationPushers.lastSeenAt),
      desc(notificationPushers.updatedAt),
      desc(notificationPushers.id),
    )
    .limit(MAX_PUSHERS_PER_DELIVERY + 1)
    .all();
  const selectionTruncated = selectedRows.length > MAX_PUSHERS_PER_DELIVERY;
  const rows = selectedRows.slice(0, MAX_PUSHERS_PER_DELIVERY);

  const groups = new Map<string, StoredNotificationPusher[]>();
  let skippedInvalidPusherCount = 0;
  for (const row of rows) {
    const gateway = validateNotificationPushGatewayUrl(row.gatewayUrl, {
      allowedHosts: env.TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS,
      allowInsecureLoopback: isNotificationPushInsecureLoopbackEnabled(env),
    });
    if (!gateway.ok || !safePusherData(row.data)) {
      skippedInvalidPusherCount += 1;
      continue;
    }
    const group = groups.get(gateway.url) ?? [];
    group.push({ ...row, gatewayUrl: gateway.url });
    groups.set(gateway.url, group);
  }

  const batches: NotificationPushGatewayBatchResult[] = [];
  for (const [gatewayUrl, pushers] of groups) {
    for (
      let offset = 0;
      offset < pushers.length;
      offset += MAX_DEVICES_PER_GATEWAY_REQUEST
    ) {
      const batch = pushers.slice(
        offset,
        offset + MAX_DEVICES_PER_GATEWAY_REQUEST,
      );
      batches.push(
        await deliverGatewayBatch(env, gatewayUrl, batch, input, options),
      );
    }
  }

  const retryAfterSeconds = batches.reduce<number | undefined>(
    (maximum, batch) =>
      batch.retryAfterSeconds === undefined
        ? maximum
        : Math.max(maximum ?? 0, batch.retryAfterSeconds),
    undefined,
  );
  return {
    selectedPusherCount: rows.length,
    selectionTruncated,
    dispatchedPusherCount: batches.reduce(
      (total, batch) => total + batch.deviceCount,
      0,
    ),
    skippedInvalidPusherCount,
    gatewayBatchCount: batches.length,
    rejectedCount: batches.reduce(
      (total, batch) => total + batch.rejectedCount,
      0,
    ),
    deletedRejectedCount: batches.reduce(
      (total, batch) => total + batch.deletedRejectedCount,
      0,
    ),
    retryExhaustedCount: batches.filter(
      (batch) => batch.status === "retry_exhausted",
    ).length,
    permanentFailureCount: batches.filter(
      (batch) =>
        batch.status === "permanent_failure" ||
        batch.permanentDeviceFailureCount > 0,
    ).length,
    configurationErrorCount: batches.filter(
      (batch) => batch.status === "configuration_error",
    ).length,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    batches,
  };
}

export async function pruneStaleNotificationPushers(
  env: Pick<Env, "DB" | "TAKOS_NOTIFICATION_PUSH_RETENTION_DAYS">,
  options: { readonly now?: Date; readonly batchSize?: number } = {},
): Promise<NotificationPusherRetentionResult> {
  const db = getDb(env.DB);
  const retentionDays = boundedInteger(
    env.TAKOS_NOTIFICATION_PUSH_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
  );
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const batchSize = boundedInteger(
    options.batchSize,
    RETENTION_BATCH_SIZE,
    1,
    RETENTION_BATCH_SIZE,
  );
  const candidates = await db
    .select({ id: notificationPushers.id })
    .from(notificationPushers)
    .where(lt(notificationPushers.lastSeenAt, cutoff))
    .limit(batchSize + 1)
    .all();
  const selected = candidates.slice(0, batchSize);
  const deleteResult =
    selected.length > 0
      ? await db
          .delete(notificationPushers)
          .where(
            and(
              inArray(
                notificationPushers.id,
                selected.map((row) => row.id),
              ),
              lt(notificationPushers.lastSeenAt, cutoff),
            ),
          )
          .run()
      : undefined;
  return {
    cutoff,
    selected: selected.length,
    deleted: affectedRowCount(deleteResult),
    hasMore: candidates.length > batchSize,
  };
}

async function deliverGatewayBatch(
  env: NotificationPushDeliveryEnv,
  gatewayUrl: string,
  rows: readonly StoredNotificationPusher[],
  input: {
    readonly userId: string;
    readonly notificationId: string;
    readonly spaceId?: string | null;
  },
  options: DeliverNotificationPushOptions,
): Promise<NotificationPushGatewayBatchResult> {
  if (!env.TAKOS_EGRESS) {
    return failureResult(
      "configuration_error",
      rows.length,
      0,
      "configuration",
      "TAKOS_EGRESS binding is required",
    );
  }

  const maxAttempts = boundedInteger(
    options.maxAttempts ?? env.TAKOS_NOTIFICATION_PUSH_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
    1,
    MAX_ATTEMPTS,
  );
  const timeoutMs = boundedInteger(
    env.TAKOS_NOTIFICATION_PUSH_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const sleep = options.sleep ?? sleepFor;
  let pendingRows = [...rows];
  const rejectedRowIds = new Set<string>();
  const failedRowIds = new Set<string>();
  let deletedRejectedCount = 0;
  let requestedRetryAfterSeconds: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const requestBody = JSON.stringify(
      createNotificationPushGatewayRequest({
        event: {
          id: input.notificationId,
          scopeId: input.spaceId ?? undefined,
        },
        pushers: pendingRows.map((row) => storedRowToEventIdOnlyPusher(row)),
        now: options.now,
      }),
    );
    let response: Response;
    try {
      response = await fetchGateway(
        env,
        gatewayUrl,
        input.spaceId ?? input.userId,
        requestBody,
        timeoutMs,
      );
    } catch {
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return failureResult(
        "retry_exhausted",
        rows.length,
        attempt,
        "retryable",
        "gateway request failed",
        undefined,
        rejectedRowIds.size,
        deletedRejectedCount,
        failedRowIds.size,
        requestedRetryAfterSeconds,
      );
    }

    const failureKind = response.ok
      ? null
      : classifyNotificationPushGatewayStatus(response.status);
    const responseRetryAfterSeconds = parseNotificationPushRetryAfter(
      response.headers.get("retry-after"),
      options.now,
    );
    if (responseRetryAfterSeconds !== undefined) {
      requestedRetryAfterSeconds = Math.max(
        requestedRetryAfterSeconds ?? 0,
        responseRetryAfterSeconds,
      );
    }
    const parsed = await readGatewayResponse(
      response,
      new Set(pendingRows.map((row) => row.pushkey)),
    );
    if (!parsed.ok) {
      if (failureKind === "retryable" && attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return failureResult(
        failureKind === "retryable" ? "retry_exhausted" : "permanent_failure",
        rows.length,
        attempt,
        failureKind ?? "permanent",
        parsed.reason,
        response.status,
        rejectedRowIds.size,
        deletedRejectedCount,
        failedRowIds.size,
        failureKind === "retryable" ? requestedRetryAfterSeconds : undefined,
      );
    }

    const rejected = new Set(parsed.value.rejected);
    const newlyRejectedRows = pendingRows.filter((row) =>
      rejected.has(row.pushkey),
    );
    for (const row of newlyRejectedRows) rejectedRowIds.add(row.id);
    deletedRejectedCount += await compareAndDeleteNotificationPushers(
      getDb(env.DB),
      newlyRejectedRows,
    );

    const failed = new Set(parsed.value.failed ?? []);
    const newlyFailedRows = pendingRows.filter((row) =>
      failed.has(row.pushkey),
    );
    for (const row of newlyFailedRows) failedRowIds.add(row.id);

    const nonRejectedRows = pendingRows.filter(
      (row) => !rejected.has(row.pushkey) && !failed.has(row.pushkey),
    );
    const retryableRows = parsed.value.retryable
      ? nonRejectedRows.filter((row) =>
          parsed.value.retryable!.includes(row.pushkey),
        )
      : undefined;

    if (failureKind === "permanent") {
      return failureResult(
        "permanent_failure",
        rows.length,
        attempt,
        "permanent",
        "gateway returned an error status",
        response.status,
        rejectedRowIds.size,
        deletedRejectedCount,
        failedRowIds.size,
        undefined,
      );
    }

    const nextRows =
      retryableRows ?? (failureKind === "retryable" ? nonRejectedRows : []);
    if (nextRows.length > 0) {
      if (attempt < maxAttempts) {
        pendingRows = nextRows;
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return failureResult(
        "retry_exhausted",
        rows.length,
        attempt,
        "retryable",
        "gateway attempts exhausted",
        response.status,
        rejectedRowIds.size,
        deletedRejectedCount,
        failedRowIds.size,
        requestedRetryAfterSeconds,
      );
    }

    if (failedRowIds.size > 0) {
      return failureResult(
        "permanent_failure",
        rows.length,
        attempt,
        "permanent",
        "gateway reported permanent device failures",
        response.status,
        rejectedRowIds.size,
        deletedRejectedCount,
        failedRowIds.size,
      );
    }

    return {
      status: "delivered",
      attempts: attempt,
      deviceCount: rows.length,
      rejectedCount: rejectedRowIds.size,
      deletedRejectedCount,
      permanentDeviceFailureCount: 0,
      responseStatus: response.status,
    };
  }

  return failureResult(
    "retry_exhausted",
    rows.length,
    maxAttempts,
    "retryable",
    "gateway attempts exhausted",
    undefined,
    rejectedRowIds.size,
    deletedRejectedCount,
    failedRowIds.size,
    requestedRetryAfterSeconds,
  );
}

async function fetchGateway(
  env: NotificationPushDeliveryEnv,
  gatewayUrl: string,
  egressScopeId: string,
  requestBody: string,
  timeoutMs: number,
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Takos-Egress-Mode": "notification-push",
    "X-Takos-Space-Id": egressScopeId,
  });
  const bearer = exactGatewayBearer(env, gatewayUrl);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await env.TAKOS_EGRESS!.fetch(gatewayUrl, {
      method: "POST",
      headers,
      body: requestBody,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function exactGatewayBearer(
  env: NotificationPushDeliveryEnv,
  gatewayUrl: string,
): string | null {
  const token = env.TAKOS_NOTIFICATION_PUSH_GATEWAY_TOKEN?.trim();
  const configuredUrl = env.TAKOS_NOTIFICATION_PUSH_GATEWAY_URL?.trim();
  if (!token || !configuredUrl) return null;
  const parsed = validateNotificationPushGatewayUrl(configuredUrl, {
    allowedHosts: env.TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS,
  });
  return parsed.ok && parsed.url === gatewayUrl ? token : null;
}

function storedRowToEventIdOnlyPusher(
  row: StoredNotificationPusher,
): NotificationPusher {
  const data = safePusherData(row.data) ?? {};
  return {
    kind: "http",
    app_id: row.appId,
    pushkey: row.pushkey,
    data: {
      ...data,
      url: row.gatewayUrl,
      format: "event_id_only",
    },
  };
}

function safePusherData(
  value: string,
):
  | Record<string, never>
  | Record<
      string,
      | string
      | number
      | boolean
      | null
      | readonly unknown[]
      | Record<string, unknown>
    >
  | null {
  try {
    const parsed = JSON.parse(value);
    const validation = validateNotificationPusherStoredData(parsed);
    return validation.ok ? validation.data : null;
  } catch {
    return null;
  }
}

async function readGatewayResponse(
  response: Response,
  requestedPushkeys: ReadonlySet<string>,
): Promise<
  | { readonly ok: true; readonly value: NotificationPushGatewayResponse }
  | { readonly ok: false; readonly reason: string }
> {
  const bytes = await readBoundedBody(response, MAX_GATEWAY_RESPONSE_BYTES);
  if (!bytes.ok) return bytes;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes.value));
  } catch {
    return { ok: false, reason: "gateway response is not valid JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "gateway response is invalid" };
  }
  const responseValue = value as {
    readonly rejected?: unknown;
    readonly retryable?: unknown;
    readonly failed?: unknown;
  };
  const rejected = validateGatewayPushkeyList(
    responseValue.rejected,
    requestedPushkeys,
  );
  const retryable =
    responseValue.retryable === undefined
      ? undefined
      : validateGatewayPushkeyList(responseValue.retryable, requestedPushkeys);
  const failed =
    responseValue.failed === undefined
      ? undefined
      : validateGatewayPushkeyList(responseValue.failed, requestedPushkeys);
  if (
    !rejected ||
    (responseValue.retryable !== undefined && !retryable) ||
    (responseValue.failed !== undefined && !failed) ||
    (retryable && retryable.some((pushkey) => rejected.includes(pushkey))) ||
    (failed && failed.some((pushkey) => rejected.includes(pushkey))) ||
    (failed &&
      retryable &&
      failed.some((pushkey) => retryable.includes(pushkey)))
  ) {
    return { ok: false, reason: "gateway pushkey lists are invalid" };
  }
  return {
    ok: true,
    value: {
      rejected,
      ...(Array.isArray(retryable) ? { retryable } : {}),
      ...(Array.isArray(failed) ? { failed } : {}),
    },
  };
}

function validateGatewayPushkeyList(
  value: unknown,
  requestedPushkeys: ReadonlySet<string>,
): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DEVICES_PER_GATEWAY_REQUEST) {
    return null;
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      new TextEncoder().encode(entry).byteLength > 512 ||
      !requestedPushkeys.has(entry) ||
      seen.has(entry)
    ) {
      return null;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<
  | { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly reason: string }
> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    return { ok: false, reason: "gateway response is too large" };
  }
  if (!response.body) return { ok: true, value: new Uint8Array() };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "gateway response is too large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: result };
}

function failureResult(
  status: Exclude<NotificationPushGatewayBatchResult["status"], "delivered">,
  deviceCount: number,
  attempts: number,
  failureKind: NotificationPushGatewayFailureKind,
  reason: string,
  responseStatus?: number,
  rejectedCount = 0,
  deletedRejectedCount = 0,
  permanentDeviceFailureCount = 0,
  retryAfterSeconds?: number,
): NotificationPushGatewayBatchResult {
  return {
    status,
    attempts,
    deviceCount,
    rejectedCount,
    deletedRejectedCount,
    permanentDeviceFailureCount,
    failureKind,
    reason,
    ...(responseStatus === undefined ? {} : { responseStatus }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[([^\]]+)\]$/u, "$1");
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function isExplicitLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

export function isNotificationPushInsecureLoopbackEnabled(
  env: Pick<Env, "TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK">,
): boolean {
  return (
    env.TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK?.trim().toLowerCase() ===
    "true"
  );
}

function hostAllowed(hostname: string, allowlist: string | undefined): boolean {
  const entries = (allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return false;
  return entries.some((entry) => {
    if (entry === "*") return true;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
    }
    return hostname === entry;
  });
}

function boundedInteger(
  value: string | number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function retryDelayMs(completedAttempt: number): number {
  return Math.min(1_000, 100 * 2 ** Math.max(0, completedAttempt - 1));
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
