import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtColumn } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";

/**
 * Index naming note.
 *
 * The applied baseline SQL and the Drizzle declarations do not always use the
 * same naming convention for equivalent indexes. Treat generated
 * index-name-only diffs as intentional schema-change candidates: either apply
 * the rename consistently to every environment or keep the generated migration
 * a no-op. New table declarations should choose explicit `.index()` names that
 * match their applied SQL so the drift set does not grow.
 */

// 17. AuthSession
export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  expiresAt: text("expires_at").notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxTokenHash: index("idx_auth_sessions_token_hash").on(table.tokenHash),
  idxExpiresAt: index("idx_auth_sessions_expires_at").on(table.expiresAt),
  idxAccount: index("idx_auth_sessions_account_id").on(table.accountId),
}));

// Phase 18.2 H11: server-side blacklist for revoked / rotated session IDs.
// The Session record itself lives in a Durable Object, but the middleware
// must reject a known-revoked cookie immediately even if the DO has not yet
// observed the deletion (eventual consistency window). Rows are written on
// `POST /api/auth/logout` and on rotation.
export const sessionsRevoked = sqliteTable("sessions_revoked", {
  sessionId: text("session_id").primaryKey(),
  userId: text("user_id"),
  revokedAt: text("revoked_at").notNull(),
  reason: text("reason").notNull().default("logout"),
  expiresAt: text("expires_at"),
}, (table) => ({
  idxUserId: index("idx_sessions_revoked_user_id").on(table.userId),
  idxExpiresAt: index("idx_sessions_revoked_expires_at").on(table.expiresAt),
}));
