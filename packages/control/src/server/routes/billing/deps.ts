import { getDb } from "../../../infra/db/index.ts";
import {
  addCredits,
  assertBillingPlanId,
  getOrCreateBillingAccount,
  resolveBillingMode,
  resolveBillingPlanTier,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
} from "../../../application/services/billing/billing.ts";
import {
  createCheckoutSession,
  createPortalSession,
  listInvoices,
  retrieveCheckoutSession,
  retrieveInvoice,
  sendInvoice,
  verifyWebhookSignature,
} from "../../../application/services/billing/stripe.ts";

export const billingRouteDeps = {
  getDb,
  getOrCreateBillingAccount,
  addCredits,
  assertBillingPlanId,
  resolveBillingMode,
  resolveBillingPlanTier,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  retrieveCheckoutSession,
  listInvoices,
  retrieveInvoice,
  sendInvoice,
};
