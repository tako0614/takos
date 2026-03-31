/**
 * Billing service -- main barrel module.
 *
 * Re-exports every public symbol from the focused sub-modules so that
 * existing consumers can keep importing from `billing/billing`.
 */

// Types and constants
export {
  METER_TYPES,
  WEEKLY_RUNTIME_WINDOW_DAYS,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
} from './billing-types.ts';

export type {
  MeterType,
  TransactionType,
  BillingCheckResult,
  UsageRecordInput,
  UsageRecordResult,
  RollingUsageSnapshot,
  WeeklyRuntimeLimitCheck,
  BillingAccountWithPlan,
} from './billing-types.ts';

// Plan definitions and resolution
export {
  CANONICAL_BILLING_PLAN_IDS,
  assertBillingPlanId,
  resolveBillingPlanTier,
  resolveBillingMode,
  loadBillingAccountWithPlan,
  ensureDefaultBillingCatalog,
  hasExpectedBillingCatalog,
  resolveCanonicalBillingPlanId,
  resolveCanonicalBillingPlanIdFromName,
  isCanonicalBillingPlanId,
  DEFAULT_BILLING_QUOTAS,
  DEFAULT_BILLING_RATES,
} from './billing-plans.ts';
export type {
  BillingPlanId,
  BillingPlanTier,
  BillingMode,
} from './billing-plans.ts';

// Account management
export {
  getOrCreateBillingAccount,
  assignPlanToUser,
  addCredits,
  checkFeatureAccess,
} from './billing-accounts.ts';

// Usage tracking
export {
  checkBillingQuota,
  recordUsage,
  getRollingUsage,
  checkWeeklyRuntimeLimit,
} from './billing-usage.ts';

// Run-level batch usage recording
export { recordRunUsageBatch } from './billing-run-usage.ts';
