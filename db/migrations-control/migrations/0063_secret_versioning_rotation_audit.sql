-- Secret versioning and rotation audit evidence.
-- takos-migration-safety: expand
-- Raw secret material stays in the owning secret backend or the existing
-- resources grace-period columns; this schema stores only digests and metadata.

CREATE TABLE IF NOT EXISTS "secret_versions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "resource_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'current',
  "value_digest" TEXT NOT NULL,
  "cloud_partition" TEXT NOT NULL DEFAULT 'global',
  "rotation_policy" TEXT NOT NULL DEFAULT '{}',
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "activated_at" TEXT NOT NULL,
  "expires_at" TEXT,
  "superseded_by_version_id" TEXT,
  "created_by_account_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "secret_versions_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "resources" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "secret_versions_created_by_account_id_fkey"
    FOREIGN KEY ("created_by_account_id") REFERENCES "accounts" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_secret_versions_resource_version"
  ON "secret_versions" ("resource_id", "version");
CREATE INDEX IF NOT EXISTS "idx_secret_versions_resource_id"
  ON "secret_versions" ("resource_id");
CREATE INDEX IF NOT EXISTS "idx_secret_versions_resource_status"
  ON "secret_versions" ("resource_id", "status");
CREATE INDEX IF NOT EXISTS "idx_secret_versions_expires_at"
  ON "secret_versions" ("expires_at");

CREATE TABLE IF NOT EXISTS "secret_rotation_events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "resource_id" TEXT NOT NULL,
  "secret_version_id" TEXT,
  "event_type" TEXT NOT NULL,
  "actor_account_id" TEXT,
  "reason" TEXT NOT NULL DEFAULT 'manual',
  "details" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "secret_rotation_events_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "resources" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "secret_rotation_events_secret_version_id_fkey"
    FOREIGN KEY ("secret_version_id") REFERENCES "secret_versions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "secret_rotation_events_actor_account_id_fkey"
    FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_secret_rotation_events_resource_created_at"
  ON "secret_rotation_events" ("resource_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_secret_rotation_events_event_type"
  ON "secret_rotation_events" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_secret_rotation_events_actor_account_id"
  ON "secret_rotation_events" ("actor_account_id");
