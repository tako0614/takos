/**
 * Billing service -- main barrel module.
 *
 * Re-exports every public symbol from the focused sub-modules so that
 * existing consumers can keep importing from `billing/billing`.
 */

// Types and constants
export {
  METER_TYPES,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
  WEEKLY_RUNTIME_WINDOW_DAYS,
} from "./billing-types.ts";

export type {
  BillingAccountWithPlan,
  BillingCheckResult,
  MeterType,
  RollingUsageSnapshot,
  TransactionType,
  UsageRecordInput,
  UsageRecordResult,
  WeeklyRuntimeLimitCheck,
} from "./billing-types.ts";

// Plan definitions and resolution
export {
  assertBillingPlanId,
  CANONICAL_BILLING_PLAN_IDS,
  DEFAULT_BILLING_QUOTAS,
  DEFAULT_BILLING_RATES,
  ensureDefaultBillingCatalog,
  hasExpectedBillingCatalog,
  isCanonicalBillingPlanId,
  loadBillingAccountWithPlan,
  resolveBillingMode,
  resolveBillingPlanTier,
  resolveCanonicalBillingPlanId,
  resolveCanonicalBillingPlanIdFromName,
} from "./billing-plans.ts";
export type {
  BillingMode,
  BillingPlanId,
  BillingPlanTier,
} from "./billing-plans.ts";

// Account management
export {
  addCredits,
  assignPlanToUser,
  checkFeatureAccess,
  getOrCreateBillingAccount,
} from "./billing-accounts.ts";

// Usage tracking
export {
  checkBillingQuota,
  checkWeeklyRuntimeLimit,
  getRollingUsage,
  recordUsage,
} from "./billing-usage.ts";

// Run-level batch usage recording
export { recordRunUsageBatch } from "./billing-run-usage.ts";

// Payment processor abstraction
export type {
  BillingWebhookEvent,
  CheckoutSessionResult,
  CompletedCheckoutSession,
  CreateCheckoutInput,
  CreatePortalInput,
  ListInvoicesInput,
  NormalizedInvoice,
  PaymentProcessor,
} from "./payment-processor.ts";
export { resolvePaymentProcessor } from "./processors/index.ts";
