-- takos-migration-safety: expand

-- Mutable custom Skill rows and image-bundled managed Skills are discovery
-- sources, not execution snapshots. Content-addressed revisions preserve the
-- exact bounded instructions and contract selected for an active Run. There
-- is intentionally no FK to the mutable skills table: updating or deleting a
-- logical Skill must not cascade-delete content already pinned by a Run.
CREATE TABLE IF NOT EXISTS "skill_revisions" (
  "id" TEXT PRIMARY KEY NOT NULL
    CHECK (length("id") BETWEEN 1 AND 128),
  "account_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL
    CHECK (length("resource_id") BETWEEN 1 AND 128),
  "source" TEXT NOT NULL
    CHECK ("source" IN ('managed', 'custom')),
  "skill_id" TEXT NOT NULL
    CHECK (length("skill_id") BETWEEN 1 AND 128),
  "content_digest" TEXT NOT NULL
    CHECK (
      length("content_digest") = 71 AND
      "content_digest" LIKE 'sha256:%'
    ),
  "content_json" TEXT NOT NULL
    CHECK (length("content_json") BETWEEN 2 AND 65536),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "skill_revisions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_skill_revisions_content"
  ON "skill_revisions" ("account_id", "resource_id", "content_digest");
CREATE INDEX IF NOT EXISTS "idx_skill_revisions_logical_skill"
  ON "skill_revisions" (
    "account_id", "source", "skill_id", "created_at"
  );

-- A plan freezes selection order, locale, and the exact content revisions even
-- when zero Skills were selected. The row is Run-owned and may be deleted only
-- with that Run; individual Skill revisions remain account-owned so other Runs
-- can reuse identical content without copying it again.
CREATE TABLE IF NOT EXISTS "run_skill_plan_revisions" (
  "run_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL
    CHECK ("revision" BETWEEN 1 AND 1000000),
  "account_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL
    CHECK (length("resource_id") BETWEEN 1 AND 128),
  "plan_digest" TEXT NOT NULL
    CHECK (
      length("plan_digest") = 71 AND
      "plan_digest" LIKE 'sha256:%'
    ),
  "plan_json" TEXT NOT NULL
    CHECK (length("plan_json") BETWEEN 2 AND 65536),
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "revision"),
  CONSTRAINT "run_skill_plan_revisions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "run_skill_plan_revisions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_run_skill_plan_revisions_resource"
  ON "run_skill_plan_revisions" ("resource_id");
CREATE INDEX IF NOT EXISTS "idx_run_skill_plan_revisions_account_created"
  ON "run_skill_plan_revisions" ("account_id", "created_at");
