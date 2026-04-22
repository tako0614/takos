CREATE TABLE IF NOT EXISTS "service_env_vars__fk_repair" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "service_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "value_encrypted" TEXT NOT NULL,
  "is_secret" INTEGER NOT NULL DEFAULT 0,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("service_id") REFERENCES "services" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "service_env_vars__fk_repair" (
  "id",
  "service_id",
  "account_id",
  "name",
  "value_encrypted",
  "is_secret",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "service_id",
  "account_id",
  "name",
  "value_encrypted",
  "is_secret",
  "created_at",
  "updated_at"
FROM "service_env_vars";

DROP TABLE "service_env_vars";
ALTER TABLE "service_env_vars__fk_repair" RENAME TO "service_env_vars";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_env_vars_service_name"
  ON "service_env_vars" ("service_id", "name");
CREATE INDEX IF NOT EXISTS "idx_service_env_vars_service_id"
  ON "service_env_vars" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_service_env_vars_account_id"
  ON "service_env_vars" ("account_id");
