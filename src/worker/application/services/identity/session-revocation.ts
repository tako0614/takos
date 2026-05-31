/**
 * Phase 18.2 H11: server-side session blacklist.
 *
 * Sessions live in a Durable Object, but logout / rotation must invalidate a
 * cookie even before the DO has observed the deletion (eventual consistency
 * window) and across replicas. The `sessions_revoked` SQL store table records every
 * revoked or rotated session ID; the auth middleware checks it on every
 * request and rejects matches with 401.
 */

import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { eq } from "drizzle-orm";

import { getDb, sessionsRevoked } from "../../../infra/db/index.ts";
import { logError } from "../../../shared/utils/logger.ts";

export type SessionRevocationReason =
  | "logout"
  | "rotated"
  | "admin_revoked"
  | "expired"
  | "compromised";

export interface RecordSessionRevocationInput {
  readonly sessionId: string;
  readonly userId?: string | null;
  readonly reason?: SessionRevocationReason;
  readonly expiresAt?: string | null;
}

/**
 * Insert a row marking the given session ID as revoked. Uses INSERT OR
 * REPLACE so calling twice is safe (idempotent).
 */
export async function recordSessionRevocation(
  d1: SqlDatabaseBinding,
  input: RecordSessionRevocationInput,
): Promise<void> {
  const reason = input.reason ?? "logout";
  const revokedAt = new Date().toISOString();

  // Drizzle does not expose UPSERT for sqliteTable + SQL store in all versions, so we
  // use a raw prepared statement keyed by primary key (`session_id`).
  try {
    await d1
      .prepare(
        `INSERT INTO sessions_revoked
           (session_id, user_id, revoked_at, reason, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           revoked_at = excluded.revoked_at,
           reason     = excluded.reason,
           expires_at = excluded.expires_at`,
      )
      .bind(
        input.sessionId,
        input.userId ?? null,
        revokedAt,
        reason,
        input.expiresAt ?? null,
      )
      .run();
  } catch (err) {
    logError("Failed to record session revocation", err, {
      module: "services/identity/session-revocation",
    });
    throw err;
  }
}

/**
 * Quick lookup: is this session ID present in the blacklist?
 *
 * The middleware calls this on every request. The table has a primary-key
 * index on `session_id` so the lookup is O(1).
 */
export async function isSessionRevoked(
  d1: SqlDatabaseBinding,
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const db = getDb(d1);
    const row = await db
      .select({ id: sessionsRevoked.sessionId })
      .from(sessionsRevoked)
      .where(eq(sessionsRevoked.sessionId, sessionId))
      .get();
    return !!row;
  } catch (err) {
    // Fail-closed: if we cannot consult the blacklist, treat the session as
    // revoked. Returning `true` here forces the middleware to require a fresh
    // login rather than allowing potentially-revoked cookies to slip through.
    logError("Failed to query session revocation", err, {
      module: "services/identity/session-revocation",
    });
    return true;
  }
}

/**
 * Best-effort cleanup of expired entries. Background jobs may call this to
 * keep the table from growing unbounded. Rows whose `expires_at` is past the
 * current time are deleted; rows with NULL `expires_at` are retained as
 * permanent revocations.
 */
export async function cleanupExpiredSessionRevocations(
  d1: SqlDatabaseBinding,
  now: Date = new Date(),
): Promise<void> {
  try {
    await d1
      .prepare(
        `DELETE FROM sessions_revoked
         WHERE expires_at IS NOT NULL AND expires_at < ?`,
      )
      .bind(now.toISOString())
      .run();
  } catch (err) {
    logError("Failed to clean up session revocations", err, {
      module: "services/identity/session-revocation",
    });
  }
}
