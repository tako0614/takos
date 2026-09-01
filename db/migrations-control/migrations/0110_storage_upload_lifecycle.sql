-- takos-migration-safety: expand

ALTER TABLE "account_storage_files"
  ADD COLUMN "upload_state" TEXT NOT NULL DEFAULT 'ready'
  CHECK ("upload_state" IN ('pending', 'uploading', 'ready'));

ALTER TABLE "account_storage_files"
  ADD COLUMN "upload_expires_at" TEXT;

CREATE INDEX IF NOT EXISTS "idx_account_storage_files_upload_state_expires_at"
  ON "account_storage_files"("upload_state", "upload_expires_at");
