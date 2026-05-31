-- Add 24h grace period support for secret-typed resource rotation.
--
-- During the grace period both the new and previous secret values remain
-- valid so in-flight consumers can continue to authenticate against the old
-- value while they reload. The columns are lazy-cleared on the next read or
-- rotate operation after `previous_secret_expires_at` has elapsed.

ALTER TABLE resources ADD COLUMN previous_secret_value TEXT;
ALTER TABLE resources ADD COLUMN previous_secret_expires_at TEXT;
