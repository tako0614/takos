CREATE TABLE IF NOT EXISTS "account_password_credentials" (
  "account_id" TEXT NOT NULL PRIMARY KEY,
  "password_hash" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "account_password_credentials_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
