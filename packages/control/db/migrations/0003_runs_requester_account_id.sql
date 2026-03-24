ALTER TABLE "runs" ADD COLUMN "requester_account_id" TEXT;

CREATE INDEX "idx_runs_requester_account_id" ON "runs"("requester_account_id");

-- Backfill existing runs so capability resolution can map to a principal-like user id.
UPDATE "runs"
SET "requester_account_id" = (
  SELECT COALESCE(
    "accounts"."owner_account_id",
    CASE WHEN "accounts"."type" = 'user' THEN "accounts"."id" ELSE NULL END,
    "runs"."account_id"
  )
  FROM "accounts"
  WHERE "accounts"."id" = "runs"."account_id"
)
WHERE "requester_account_id" IS NULL;
