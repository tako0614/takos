import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { createdAtColumn, timestamps, updatedAtColumn } from './schema-utils';

// 18. BillingAccount
export const billingAccounts = sqliteTable('billing_accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().unique(),
  planId: text('plan_id').notNull(),
  balanceCents: integer('balance_cents').notNull().default(0),
  status: text('status').notNull().default('active'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStartedAt: text('subscription_started_at'),
  subscriptionPeriodEnd: text('subscription_period_end'),
  ...timestamps,
}, (table) => ({
  idxStripeCustomer: index('idx_billing_accounts_stripe_customer_id').on(table.stripeCustomerId),
  idxStatus: index('idx_billing_accounts_status').on(table.status),
  idxPlan: index('idx_billing_accounts_plan_id').on(table.planId),
  idxAccount: index('idx_billing_accounts_account_id').on(table.accountId),
}));

// 19. BillingPlanFeature
export const billingPlanFeatures = sqliteTable('billing_plan_features', {
  planId: text('plan_id').notNull(),
  featureKey: text('feature_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
}, (table) => ({
  pk: primaryKey({ columns: [table.planId, table.featureKey] }),
}));

// 20. BillingPlanQuota
export const billingPlanQuotas = sqliteTable('billing_plan_quotas', {
  planId: text('plan_id').notNull(),
  quotaKey: text('quota_key').notNull(),
  limitValue: integer('limit_value').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.planId, table.quotaKey] }),
}));

// 21. BillingPlanRate
export const billingPlanRates = sqliteTable('billing_plan_rates', {
  planId: text('plan_id').notNull(),
  meterType: text('meter_type').notNull(),
  rateCents: integer('rate_cents').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.planId, table.meterType] }),
}));

// 22. BillingPlan
export const billingPlans = sqliteTable('billing_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (table) => ({
  idxName: index('idx_billing_plans_name').on(table.name),
  idxIsDefault: index('idx_billing_plans_is_default').on(table.isDefault),
}));

// 23. BillingTransaction
export const billingTransactions = sqliteTable('billing_transactions', {
  id: text('id').primaryKey(),
  billingAccountId: text('billing_account_id').notNull(),
  type: text('type').notNull(),
  amountCents: integer('amount_cents').notNull(),
  balanceAfterCents: integer('balance_after_cents').notNull(),
  description: text('description'),
  referenceId: text('reference_id'),
  metadata: text('metadata').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  idxType: index('idx_billing_transactions_type').on(table.type),
  idxReference: index('idx_billing_transactions_reference_id').on(table.referenceId),
  idxCreatedAt: index('idx_billing_transactions_created_at').on(table.createdAt),
  idxBillingAccount: index('idx_billing_transactions_billing_account_id').on(table.billingAccountId),
}));

// 98. UsageEvent
export const usageEvents = sqliteTable('usage_events', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').unique('idx_usage_events_idempotency_key'),
  billingAccountId: text('billing_account_id').notNull(),
  scopeType: text('scope_type').notNull().default('space'),
  accountId: text('account_id'),
  meterType: text('meter_type').notNull(),
  units: real('units').notNull(),
  costCents: integer('cost_cents').notNull().default(0),
  referenceId: text('reference_id'),
  referenceType: text('reference_type'),
  metadata: text('metadata').notNull().default('{}'),
  ...createdAtColumn,
}, (table) => ({
  idxReference: index('idx_usage_events_reference_id').on(table.referenceId),
  idxMeterType: index('idx_usage_events_meter_type').on(table.meterType),
  idxCreatedAt: index('idx_usage_events_created_at').on(table.createdAt),
  idxBillingAccount: index('idx_usage_events_billing_account_id').on(table.billingAccountId),
  idxAccount: index('idx_usage_events_account_id').on(table.accountId),
}));

// 99. UsageRollup
export const usageRollups = sqliteTable('usage_rollups', {
  id: text('id').primaryKey(),
  billingAccountId: text('billing_account_id').notNull(),
  scopeType: text('scope_type').notNull(),
  accountId: text('account_id'),
  meterType: text('meter_type').notNull(),
  periodStart: text('period_start').notNull(),
  units: real('units').notNull().default(0),
  costCents: integer('cost_cents').notNull().default(0),
  ...updatedAtColumn,
}, (table) => ({
  uniqBillingScope: uniqueIndex('idx_usage_rollups_billing_scope').on(table.billingAccountId, table.scopeType, table.accountId, table.meterType, table.periodStart),
  idxPeriodStart: index('idx_usage_rollups_period_start').on(table.periodStart),
  idxBillingAccount: index('idx_usage_rollups_billing_account_id').on(table.billingAccountId),
  idxAccount: index('idx_usage_rollups_account_id').on(table.accountId),
}));
