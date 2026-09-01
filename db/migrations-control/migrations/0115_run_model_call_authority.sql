-- takos-migration-safety: expand

-- Immutable, content-free evidence for every provider request begun by the
-- current agent runtime. The request body remains in the run-scoped container;
-- Takos persists only its digest and the exact RunContext authority that
-- approved the call. A stable identity plus an ephemeral begin nonce lets one
-- lost begin response replay safely while preventing a replacement container
-- from silently issuing the same provider request again.
CREATE TABLE IF NOT EXISTS "run_model_calls" (
  "id" TEXT PRIMARY KEY NOT NULL
    CHECK (length("id") = 68 AND "id" LIKE 'rmc_%'),
  "run_id" TEXT NOT NULL,
  "context_revision" INTEGER NOT NULL
    CHECK ("context_revision" >= 1),
  "context_digest" TEXT NOT NULL
    CHECK (
      length("context_digest") = 71 AND
      "context_digest" LIKE 'sha256:%'
    ),
  "run_grant_digest" TEXT NOT NULL
    CHECK (
      length("run_grant_digest") = 71 AND
      "run_grant_digest" LIKE 'sha256:%'
    ),
  "request_digest" TEXT NOT NULL
    CHECK (
      length("request_digest") = 71 AND
      "request_digest" LIKE 'sha256:%'
    ),
  "transport_attempt" INTEGER NOT NULL
    CHECK ("transport_attempt" BETWEEN 1 AND 64),
  "begin_nonce_digest" TEXT NOT NULL
    CHECK (
      length("begin_nonce_digest") = 71 AND
      "begin_nonce_digest" LIKE 'sha256:%'
    ),
  "service_id" TEXT NOT NULL,
  "lease_version" INTEGER NOT NULL
    CHECK ("lease_version" >= 0),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "run_model_calls_revision_fkey"
    FOREIGN KEY ("run_id", "context_revision")
      REFERENCES "run_context_revisions" ("run_id", "revision")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_run_model_calls_identity"
  ON "run_model_calls" (
    "run_id",
    "context_revision",
    "request_digest",
    "transport_attempt"
  );

CREATE INDEX IF NOT EXISTS "idx_run_model_calls_run_created_at"
  ON "run_model_calls" ("run_id", "created_at");
