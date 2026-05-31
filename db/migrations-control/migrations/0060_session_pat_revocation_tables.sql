-- Phase 18.2 (H11 + H12): session rotation + PAT lifecycle hardening.
--
-- H11 (session): persist a server-side blacklist for revoked session IDs so
-- logout immediately invalidates the cookie even though the session object
-- itself lives in a Durable Object. The middleware checks this table on every
-- request; rotated session IDs are likewise recorded so a stolen cookie cannot
-- be replayed after rotation has occurred.
--
-- H12 (PAT): persist a revocation table for personal access tokens. Hard
-- deletion of the underlying personal_access_tokens row would lose the audit
-- trail (token name, scopes, last_used_at), so the DELETE handler now flips
-- the row's revocation state via this table instead. A periodic cleanup job
-- prunes long-expired tokens and adds them to the blacklist as a defense in
-- depth (see takos-access-tokens.cleanupExpiredTakosPersonalAccessTokens).

CREATE TABLE IF NOT EXISTS "sessions_revoked" (
  "session_id" TEXT NOT NULL PRIMARY KEY,
  "user_id"    TEXT,
  "revoked_at" TEXT NOT NULL,
  "reason"     TEXT NOT NULL DEFAULT 'logout',
  "expires_at" TEXT
);

CREATE INDEX IF NOT EXISTS "idx_sessions_revoked_user_id"
  ON "sessions_revoked" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_revoked_expires_at"
  ON "sessions_revoked" ("expires_at");

CREATE TABLE IF NOT EXISTS "pat_revoked" (
  "token_id"   TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "revoked_at" TEXT NOT NULL,
  "reason"     TEXT NOT NULL DEFAULT 'user_revoked'
);

CREATE INDEX IF NOT EXISTS "idx_pat_revoked_token_hash"
  ON "pat_revoked" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_pat_revoked_account_id"
  ON "pat_revoked" ("account_id");
