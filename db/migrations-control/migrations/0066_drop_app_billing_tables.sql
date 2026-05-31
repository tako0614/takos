-- takos-migration-safety: contract
-- takos-migration-approval: Billing ownership moved to Takosumi Accounts/Cloud; Takos app now stores only app-local usage in app_usage_* tables.
-- takos-migration-rollback: restore affected tables from backup, then add a forward compatibility migration before rolling application code back.

DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS usage_rollups;
DROP TABLE IF EXISTS billing_transactions;
DROP TABLE IF EXISTS billing_auto_purchase_settings;
DROP TABLE IF EXISTS stripe_webhook_events;
DROP TABLE IF EXISTS billing_accounts;
DROP TABLE IF EXISTS billing_plan_features;
DROP TABLE IF EXISTS billing_plan_quotas;
DROP TABLE IF EXISTS billing_plan_rates;
DROP TABLE IF EXISTS billing_plans;
