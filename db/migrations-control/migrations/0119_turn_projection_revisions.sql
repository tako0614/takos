-- takos-migration-safety: expand

-- Immutable, derived projections owned by the Takos Worker. The first
-- consumers are the exact provider history for one Run and terminal semantic
-- turn recall. Both shapes share one
-- deletion and RunContext authority surface instead of growing parallel
-- memory stores.
CREATE TABLE IF NOT EXISTS "turn_projection_revisions" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "projection_kind" TEXT NOT NULL
    CHECK (
      "projection_kind" IN ('run_model_input', 'semantic_turn')
    ),
  "format_version" INTEGER NOT NULL DEFAULT 1
    CHECK ("format_version" = 1),
  "algorithm_revision" TEXT NOT NULL,
  "source_start_sequence" INTEGER NOT NULL
    CHECK ("source_start_sequence" >= -1),
  "source_end_sequence" INTEGER NOT NULL
    CHECK (
      "source_end_sequence" >= -1 AND
      "source_end_sequence" >= "source_start_sequence"
    ),
  "projection_digest" TEXT NOT NULL
    CHECK (
      length("projection_digest") = 71 AND
      "projection_digest" LIKE 'sha256:%'
    ),
  "projection_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "turn_projection_revisions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "turn_projection_revisions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "runs" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "turn_projection_revisions_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "threads" ("id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  "turn_projection_revisions_account_id_run_id_projection_kind_unique"
  ON "turn_projection_revisions" (
    "account_id",
    "run_id",
    "projection_kind"
  );

CREATE UNIQUE INDEX IF NOT EXISTS
  "turn_projection_revisions_account_id_resource_id_projection_digest_unique"
  ON "turn_projection_revisions" (
    "account_id",
    "resource_id",
    "projection_digest"
  );

CREATE INDEX IF NOT EXISTS "idx_turn_projection_revisions_thread_kind_sequence"
  ON "turn_projection_revisions" (
    "account_id",
    "thread_id",
    "projection_kind",
    "source_end_sequence"
  );

CREATE INDEX IF NOT EXISTS "idx_turn_projection_revisions_run_kind"
  ON "turn_projection_revisions" ("run_id", "projection_kind");

-- Vector storage is an untrusted retrieval accelerator. These rows retain only
-- bounded identifiers and digests; projection text always comes back from the
-- canonical revision above and is revalidated before model exposure.
CREATE TABLE IF NOT EXISTS "turn_projection_vector_refs" (
  "projection_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "vector_id" TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL CHECK ("chunk_index" >= 0),
  "chunk_count" INTEGER NOT NULL
    CHECK ("chunk_count" >= 1 AND "chunk_count" <= 3),
  "chunk_digest" TEXT NOT NULL
    CHECK (
      length("chunk_digest") = 71 AND
      "chunk_digest" LIKE 'sha256:%'
    ),
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("projection_id", "chunk_index"),
  CONSTRAINT "turn_projection_vector_refs_projection_id_fkey"
    FOREIGN KEY ("projection_id") REFERENCES "turn_projection_revisions" ("id")
      ON DELETE CASCADE,
  CONSTRAINT "turn_projection_vector_refs_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
      ON DELETE CASCADE,
  UNIQUE ("vector_id")
);

CREATE INDEX IF NOT EXISTS "idx_turn_projection_vector_refs_account_id"
  ON "turn_projection_vector_refs" ("account_id", "projection_id");
