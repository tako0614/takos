CREATE TABLE IF NOT EXISTS billing_auto_purchase_settings (
  billing_account_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  threshold_credits INTEGER NOT NULL DEFAULT 0,
  pack_id TEXT NOT NULL,
  monthly_limit_credits INTEGER NOT NULL,
  connector_payment_method_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_auto_purchase_enabled
  ON billing_auto_purchase_settings (enabled);
