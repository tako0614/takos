-- takos-migration-safety: expand

-- Skill descriptors expose only a bounded manifest. Resource bodies are
-- immutable, content-addressed rows and become model-visible only after the
-- parent Skill instructions and this exact resource are appended to the
-- RunContext. The mutable template catalog is never an execution authority.
CREATE TABLE IF NOT EXISTS "skill_resource_revisions" (
  "id" TEXT PRIMARY KEY NOT NULL
    CHECK (length("id") BETWEEN 1 AND 128),
  "account_id" TEXT NOT NULL,
  "skill_revision_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL
    CHECK (length("resource_id") BETWEEN 1 AND 128),
  "resource_key" TEXT NOT NULL
    CHECK (length("resource_key") BETWEEN 1 AND 128),
  "media_type" TEXT NOT NULL
    CHECK (length("media_type") BETWEEN 1 AND 128),
  "content_digest" TEXT NOT NULL
    CHECK (
      length("content_digest") = 71 AND
      "content_digest" LIKE 'sha256:%'
    ),
  "content_bytes" INTEGER NOT NULL
    CHECK ("content_bytes" BETWEEN 0 AND 16384),
  "content_text" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "skill_resource_revisions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "skill_resource_revisions_skill_revision_id_fkey"
    FOREIGN KEY ("skill_revision_id") REFERENCES "skill_revisions" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_skill_resource_revisions_key"
  ON "skill_resource_revisions" ("skill_revision_id", "resource_key");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_skill_resource_revisions_content"
  ON "skill_resource_revisions" (
    "account_id", "resource_id", "content_digest"
  );
CREATE INDEX IF NOT EXISTS "idx_skill_resource_revisions_skill"
  ON "skill_resource_revisions" ("account_id", "skill_revision_id");
