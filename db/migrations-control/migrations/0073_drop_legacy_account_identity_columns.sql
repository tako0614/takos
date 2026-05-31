-- takos-migration-safety: contract
-- takos-migration-approval: App-local Google/Takos auth identity aliases moved to auth_identities; runtime schema no longer reads accounts.google_sub or accounts.takos_auth_id.
-- takos-migration-rollback: restore the accounts table from backup, or add forward-repair columns and backfill from auth_identities before rolling application code back to a version that reads these aliases.

DROP INDEX IF EXISTS "accounts_google_sub_key";
DROP INDEX IF EXISTS "accounts_google_sub_idx";
DROP INDEX IF EXISTS "accounts_takos_auth_id_idx";

ALTER TABLE "accounts" DROP COLUMN "google_sub";
ALTER TABLE "accounts" DROP COLUMN "takos_auth_id";
