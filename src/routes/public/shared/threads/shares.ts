import type { SqlDatabaseBinding } from "takos-api-contract/shared/types";
import { readThreadAccess } from "./read-model.ts";

export type ThreadShareMode = "public" | "password";

export type ThreadShareRecord = {
  id: string;
  thread_id: string;
  space_id: string;
  created_by: string | null;
  token: string;
  mode: ThreadShareMode;
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
};

export type ThreadShareWithLinks = ThreadShareRecord & {
  share_path: string;
  share_url: string;
};

export type CreateThreadShareInput = {
  mode: ThreadShareMode;
  password?: string | null;
  expires_at?: string | null;
};

export type CreateThreadShareResult = {
  share: ThreadShareWithLinks;
  password_required: boolean;
};

type ThreadShareRow = {
  id: string;
  threadId: string;
  spaceId: string;
  createdBy: string | null;
  token: string;
  mode: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  createdAt: string | Date;
};

const PASSWORD_PBKDF2_ITERATIONS = 100_000;

export async function listThreadSharesWithLinks(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  origin: string,
): Promise<ThreadShareWithLinks[] | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId);
  if (!access) return null;

  const rows = await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      created_by_account_id AS createdBy,
      token,
      mode,
      expires_at AS expiresAt,
      revoked_at AS revokedAt,
      last_accessed_at AS lastAccessedAt,
      created_at AS createdAt
    FROM thread_shares
    WHERE thread_id = ?
    ORDER BY created_at DESC
  `).bind(threadId).all<Record<string, unknown>>();

  return rows.results.map((row) => withShareLink(origin, toRecord(row)));
}

export async function createThreadShareWithLink(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  origin: string,
  input: CreateThreadShareInput,
): Promise<CreateThreadShareResult | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return null;

  const passwordHash = input.mode === "password"
    ? await hashSharePassword(input.password ?? "")
    : null;
  const expiresAt = normalizeExpiresAt(input.expires_at ?? null);
  const createdAt = new Date().toISOString();
  const token = generateThreadShareToken();

  const row = await db.prepare(`
    INSERT INTO thread_shares (
      id,
      thread_id,
      account_id,
      created_by_account_id,
      token,
      mode,
      password_hash,
      expires_at,
      revoked_at,
      last_accessed_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    RETURNING
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      created_by_account_id AS createdBy,
      token,
      mode,
      expires_at AS expiresAt,
      revoked_at AS revokedAt,
      last_accessed_at AS lastAccessedAt,
      created_at AS createdAt
  `).bind(
    crypto.randomUUID(),
    threadId,
    access.thread.space_id,
    actorAccountId,
    token,
    input.mode,
    passwordHash,
    expiresAt,
    createdAt,
  ).first<Record<string, unknown>>();

  if (!row) {
    throw new Error(
      `Failed to create share for thread ${threadId} (mode=${input.mode}, space=${access.thread.space_id}): RETURNING produced no row`,
    );
  }

  return {
    share: withShareLink(origin, toRecord(row)),
    password_required: input.mode === "password",
  };
}

export async function revokeThreadShare(
  db: SqlDatabaseBinding,
  threadId: string,
  shareId: string,
  actorAccountId: string,
): Promise<boolean | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return null;

  const result = await db.prepare(`
    UPDATE thread_shares
    SET revoked_at = ?
    WHERE id = ? AND thread_id = ? AND revoked_at IS NULL
  `).bind(new Date().toISOString(), shareId, threadId).run();

  return Number(result.meta.changes ?? 0) > 0;
}

function normalizeExpiresAt(value: string | null): string | null {
  if (!value) return null;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Invalid expires_at");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error("expires_at must be in the future");
  }
  return expiresAt.toISOString();
}

function generateThreadShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return base64UrlEncode(bytes);
}

async function hashSharePassword(password: string): Promise<string> {
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    throw new Error("Password is required (min 8 characters)");
  }
  const data = new TextEncoder().encode(trimmed);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    data,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function withShareLink(
  origin: string,
  share: ThreadShareRecord,
): ThreadShareWithLinks {
  const sharePath = `/share/${share.token}`;
  return {
    ...share,
    share_path: sharePath,
    share_url: `${origin}${sharePath}`,
  };
}

function toRecord(row: Record<string, unknown>): ThreadShareRecord {
  const share = asThreadShareRow(row);
  return {
    id: share.id,
    thread_id: share.threadId,
    space_id: share.spaceId,
    created_by: share.createdBy,
    token: share.token,
    mode: share.mode === "password" ? "password" : "public",
    expires_at: share.expiresAt,
    revoked_at: share.revokedAt,
    last_accessed_at: share.lastAccessedAt,
    created_at: toIsoString(share.createdAt),
  };
}

function asThreadShareRow(row: Record<string, unknown>): ThreadShareRow {
  return {
    id: stringField(row, "id"),
    threadId: stringField(row, "threadId"),
    spaceId: stringField(row, "spaceId"),
    createdBy: nullableStringField(row, "createdBy"),
    token: stringField(row, "token"),
    mode: stringField(row, "mode"),
    expiresAt: nullableStringField(row, "expiresAt"),
    revokedAt: nullableStringField(row, "revokedAt"),
    lastAccessedAt: nullableStringField(row, "lastAccessedAt"),
    createdAt: dateField(row, "createdAt"),
  };
}

function stringField(
  row: Record<string, unknown>,
  key: keyof ThreadShareRow,
): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Thread share row field ${String(key)} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: keyof ThreadShareRow,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(
    `Thread share row field ${String(key)} must be a string or null`,
  );
}

function dateField(
  row: Record<string, unknown>,
  key: keyof ThreadShareRow,
): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Thread share row field ${String(key)} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
