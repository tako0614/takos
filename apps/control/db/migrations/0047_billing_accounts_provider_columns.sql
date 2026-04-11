-- Generalize Stripe-specific columns on billing_accounts to provider-agnostic
-- naming so the billing system can swap to a different payment provider via
-- the BILLING_PROVIDER env without further migrations on this table.
--
-- The webhook idempotency table `stripe_webhook_events` is intentionally left
-- as-is. When a non-Stripe provider is added, give it its own dedup table or
-- rename this one in a follow-up migration.

ALTER TABLE "billing_accounts" RENAME COLUMN "stripe_customer_id" TO "provider_customer_id";
ALTER TABLE "billing_accounts" RENAME COLUMN "stripe_subscription_id" TO "provider_subscription_id";
ALTER TABLE "billing_accounts" ADD COLUMN "provider_name" TEXT NOT NULL DEFAULT 'stripe';

DROP INDEX IF EXISTS "billing_accounts_stripe_customer_id_idx";
DROP INDEX IF EXISTS "idx_billing_accounts_stripe_customer_id";
CREATE INDEX "idx_billing_accounts_provider_customer_id" ON "billing_accounts" ("provider_customer_id");
