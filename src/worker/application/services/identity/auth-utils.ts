/**
 * Auth Utilities for takos-control
 *
 * Provides session management and security utilities.
 * Current login flows use Takosumi Accounts OIDC.
 */

import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { authSessions, getDb } from "../../../infra/db/index.ts";
import { and, desc, eq, gt, notInArray } from "drizzle-orm";
import { logInfo } from "../../../shared/utils/logger.ts";
import { bytesToHex } from "../../../shared/utils/encoding-utils.ts";

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** ISO-8601 string offset from `clock.now()` by `offsetMs` milliseconds. */
function offsetISO(offsetMs: number, clock: Clock = systemClock): string {
  return new Date(clock.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PASSWORD_PBKDF2_ITERATIONS = 100000;

/**
 * Generate a random UUID (internal to auth-utils)
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Timing-safe string comparison to prevent timing attacks (internal to auth-utils)
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    result |= charA ^ charB;
  }
  return result === 0;
}

/**
 * Validate avatar URL (must be HTTPS)
 */
export function isValidAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Hash a password using PBKDF2 with SHA-256
 * Returns salt:hash format
 *
 * Used by thread-shares for share password protection.
 */
export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
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

/**
 * Verify a password against stored hash
 *
 * Used by thread-shares for share password verification.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const hexPairs = saltHex.match(/.{2}/g);
  if (!hexPairs) return false;
  const salt = new Uint8Array(hexPairs.map((byte) => parseInt(byte, 16)));
  const data = new TextEncoder().encode(password);
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

  return timingSafeEqual(bytesToHex(new Uint8Array(bits)), hashHex);
}

/**
 * Hash a token using SHA-256
 */
export async function hashToken(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Generate a session token (64 hex characters)
 */
export function generateSessionToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Create a SQL store-based auth session (for service API token validation)
 */
export async function createAuthSession(
  d1: SqlDatabaseBinding,
  userId: string,
  userAgent?: string,
  ipAddress?: string,
  clock: Clock = systemClock,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const sessionId = generateId();
  const expiresAt = offsetISO(30 * 24 * 60 * 60 * 1000, clock); // 30 days

  const db = getDb(d1);
  await db.insert(authSessions).values({
    id: sessionId,
    accountId: userId,
    tokenHash,
    userAgent: userAgent || null,
    ipAddress: ipAddress || null,
    expiresAt,
    createdAt: new Date().toISOString(),
  });

  return { token, expiresAt };
}

/**
 * Validate a SQL store-based auth session
 */
export async function validateAuthSession(
  d1: SqlDatabaseBinding,
  token: string,
): Promise<{ valid: boolean; userId?: string; expiresAt?: string }> {
  const tokenHash = await hashToken(token);
  const db = getDb(d1);

  const session = await db.select({
    accountId: authSessions.accountId,
    expiresAt: authSessions.expiresAt,
  })
    .from(authSessions)
    .where(and(
      eq(authSessions.tokenHash, tokenHash),
      gt(authSessions.expiresAt, new Date().toISOString()),
    ))
    .get();

  if (!session) {
    return { valid: false };
  }

  return {
    valid: true,
    userId: session.accountId,
    expiresAt: session.expiresAt,
  };
}

/**
 * Delete a SQL store-based auth session
 */
export async function deleteAuthSession(
  d1: SqlDatabaseBinding,
  token: string,
): Promise<void> {
  const tokenHash = await hashToken(token);
  const db = getDb(d1);
  await db.delete(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash));
}

/**
 * Clean up old sessions for a user (keep last N sessions)
 */
export async function cleanupUserSessions(
  d1: SqlDatabaseBinding,
  userId: string,
  keepCount: number = 5,
): Promise<void> {
  const db = getDb(d1);
  const sessions = await db.select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.accountId, userId))
    .orderBy(desc(authSessions.createdAt))
    .limit(keepCount)
    .all();

  const keepIds = sessions.map((s) => s.id);
  if (keepIds.length > 0) {
    await db.delete(authSessions)
      .where(and(
        eq(authSessions.accountId, userId),
        notInArray(authSessions.id, keepIds),
      ));
  }
}

/**
 * Audit log helper (logs to console, can be extended to store in DB)
 */
export async function auditLog(
  event: string,
  details: Record<string, unknown>,
): Promise<void> {
  logInfo(`${event}`, { module: "audit", detail: JSON.stringify(details) });
}
