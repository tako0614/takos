import { THREAD_SHARE_TOKEN_PATTERN } from "takos-api-contract/thread-share";

const MAX_THREAD_SHARES_PER_RESPONSE = 1_000;
const MAX_ID_CHARACTERS = 256;
const MAX_TIMESTAMP_CHARACTERS = 64;

const RAW_SHARE_FIELDS = new Set([
  "id",
  "thread_id",
  "space_id",
  "created_by",
  "token",
  "mode",
  "expires_at",
  "revoked_at",
  "last_accessed_at",
  "created_at",
]);
const LINKED_SHARE_FIELDS = new Set([
  ...RAW_SHARE_FIELDS,
  "share_path",
  "share_url",
]);

export interface ThreadShare {
  id: string;
  thread_id: string;
  space_id: string;
  mode: "public" | "password";
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
  share_path: string;
  share_url: string;
}

interface ParsedRawShare extends Omit<ThreadShare, "share_path" | "share_url"> {
  token: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactFields(
  value: Record<string, unknown>,
  expected: Set<string>,
): boolean {
  const fields = Object.keys(value);
  return fields.length === expected.size &&
    fields.every((field) => expected.has(field));
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(`Invalid Thread share ${field}`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, MAX_TIMESTAMP_CHARACTERS);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid Thread share ${field}`);
  }
  return text;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function parseRawShare(
  value: unknown,
  expected: { threadId: string; spaceId: string },
  fields = RAW_SHARE_FIELDS,
): ParsedRawShare {
  const candidate = record(value);
  if (
    !candidate || !exactFields(candidate, fields) ||
    candidate.thread_id !== expected.threadId ||
    candidate.space_id !== expected.spaceId ||
    (candidate.mode !== "public" && candidate.mode !== "password") ||
    (candidate.created_by !== null &&
      (typeof candidate.created_by !== "string" ||
        !candidate.created_by.trim() ||
        candidate.created_by.length > MAX_ID_CHARACTERS)) ||
    typeof candidate.token !== "string" ||
    !THREAD_SHARE_TOKEN_PATTERN.test(candidate.token)
  ) {
    throw new TypeError("Invalid Thread share response record");
  }

  const createdAt = timestamp(candidate.created_at, "created_at");
  const expiresAt = nullableTimestamp(candidate.expires_at, "expires_at");
  const revokedAt = nullableTimestamp(candidate.revoked_at, "revoked_at");
  const lastAccessedAt = nullableTimestamp(
    candidate.last_accessed_at,
    "last_accessed_at",
  );
  const createdAtMs = Date.parse(createdAt);
  for (const value of [expiresAt, revokedAt, lastAccessedAt]) {
    if (value !== null && Date.parse(value) < createdAtMs) {
      throw new TypeError("Invalid Thread share timestamp order");
    }
  }

  return {
    id: boundedString(candidate.id, "id", MAX_ID_CHARACTERS),
    thread_id: expected.threadId,
    space_id: expected.spaceId,
    mode: candidate.mode,
    expires_at: expiresAt,
    revoked_at: revokedAt,
    last_accessed_at: lastAccessedAt,
    created_at: createdAt,
    token: candidate.token,
  };
}

function withValidatedLinks(
  raw: ParsedRawShare,
  sharePath: unknown,
  shareUrl: unknown,
  expectedOrigin: string,
): ThreadShare {
  const path = boundedString(sharePath, "path", 512);
  const url = boundedString(shareUrl, "URL", 2_048);
  let origin: string;
  try {
    origin = new URL(expectedOrigin).origin;
  } catch {
    throw new TypeError("Invalid expected Thread share origin");
  }
  if (path !== `/share/${raw.token}` || url !== `${origin}${path}`) {
    throw new TypeError("Thread share link does not match its token");
  }
  const parsedUrl = new URL(url);
  if (
    parsedUrl.origin !== origin || parsedUrl.pathname !== path ||
    parsedUrl.search || parsedUrl.hash || parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new TypeError("Invalid Thread share URL");
  }
  const { token: _token, ...share } = raw;
  return { ...share, share_path: path, share_url: url };
}

function parseLinkedShare(
  value: unknown,
  expected: { threadId: string; spaceId: string; origin: string },
): ThreadShare {
  const candidate = record(value);
  const raw = parseRawShare(candidate, expected, LINKED_SHARE_FIELDS);
  return withValidatedLinks(
    raw,
    candidate?.share_path,
    candidate?.share_url,
    expected.origin,
  );
}

export function parseThreadSharesResponse(
  value: unknown,
  expected: { threadId: string; spaceId: string; origin: string },
): ThreadShare[] {
  const candidate = record(value);
  if (
    !candidate || !exactFields(candidate, new Set(["shares"])) ||
    !Array.isArray(candidate.shares) ||
    candidate.shares.length > MAX_THREAD_SHARES_PER_RESPONSE
  ) {
    throw new TypeError("Invalid Thread share inventory response");
  }
  const shares = candidate.shares.map((share) =>
    parseLinkedShare(share, expected)
  );
  if (
    new Set(shares.map((share) => share.id)).size !== shares.length ||
    new Set(shares.map((share) => share.share_path)).size !== shares.length
  ) {
    throw new TypeError("Duplicate Thread share identity");
  }
  return shares;
}

export function parseThreadShareCreateResponse(
  value: unknown,
  expected: { threadId: string; spaceId: string; origin: string },
): ThreadShare {
  const candidate = record(value);
  if (
    !candidate ||
    !exactFields(
      candidate,
      new Set(["share", "share_path", "share_url", "password_required"]),
    )
  ) {
    throw new TypeError("Invalid Thread share creation response");
  }
  const raw = parseRawShare(candidate.share, expected);
  if (candidate.password_required !== (raw.mode === "password")) {
    throw new TypeError("Thread share password state does not match its mode");
  }
  return withValidatedLinks(
    raw,
    candidate.share_path,
    candidate.share_url,
    expected.origin,
  );
}

export function parseThreadShareRevokeResponse(value: unknown): void {
  const candidate = record(value);
  if (
    !candidate || !exactFields(candidate, new Set(["success"])) ||
    candidate.success !== true
  ) {
    throw new TypeError("Invalid Thread share revocation response");
  }
}
