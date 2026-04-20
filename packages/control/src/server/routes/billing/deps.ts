import { getDb } from "../../../infra/db/index.ts";
import {
  addCredits,
  assertBillingPlanId,
  getOrCreateBillingAccount,
  resolveBillingMode,
  resolveBillingPlanTier,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
} from "../../../application/services/billing/billing.ts";
import { resolvePaymentProcessor } from "../../../application/services/billing/processors/index.ts";

export const billingRouteDeps = {
  getDb,
  getOrCreateBillingAccount,
  addCredits,
  assertBillingPlanId,
  resolveBillingMode,
  resolveBillingPlanTier,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
  resolvePaymentProcessor,
};
