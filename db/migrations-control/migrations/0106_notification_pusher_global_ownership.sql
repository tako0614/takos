-- takos-migration-safety: contract
-- takos-migration-approval: One provider token can belong to only one account for a product app. Deterministic latest-registration cleanup closes the pre-v1 cross-account reassignment race before the global unique index is installed.
-- takos-migration-rollback: drop idx_notification_pushers_app_pushkey and recreate idx_notification_pushers_account_app_pushkey only when rolling back to code that still performs non-atomic account reassignment.

DELETE FROM "notification_pushers"
WHERE "id" IN (
  SELECT older."id"
  FROM "notification_pushers" older
  JOIN "notification_pushers" newer
    ON newer."app_id" = older."app_id"
   AND newer."pushkey_hash" = older."pushkey_hash"
   AND (
     newer."last_seen_at" > older."last_seen_at"
     OR (
       newer."last_seen_at" = older."last_seen_at"
       AND newer."updated_at" > older."updated_at"
     )
     OR (
       newer."last_seen_at" = older."last_seen_at"
       AND newer."updated_at" = older."updated_at"
       AND newer."id" > older."id"
     )
   )
);

DROP INDEX IF EXISTS "idx_notification_pushers_account_app_pushkey";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_notification_pushers_app_pushkey"
  ON "notification_pushers"("app_id", "pushkey_hash");
