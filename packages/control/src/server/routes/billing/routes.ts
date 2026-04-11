/**
 * Billing API Routes
 *
 * Endpoints for subscription management, usage viewing, and payment provider
 * integration. The active provider is selected via the `BILLING_PROVIDER` env
 * (default: 'stripe') — see `application/services/billing/providers/`.
 */

import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { registerBillingAccountRoutes } from "./account-routes.ts";
import { registerBillingCheckoutRoutes } from "./checkout-routes.ts";
import { billingRouteDeps } from "./deps.ts";
import { registerBillingInvoiceRoutes } from "./invoices-routes.ts";
import { billingWebhookHandler } from "./webhook.ts";

const billingRoutes = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

registerBillingAccountRoutes(billingRoutes);
registerBillingCheckoutRoutes(billingRoutes);
registerBillingInvoiceRoutes(billingRoutes);

export { billingRouteDeps, billingWebhookHandler };
export {
  getConfiguredProTopupPacks,
  resolveConfiguredProTopupPack,
} from "../../../application/services/billing/providers/stripe/stripe-purchase-config.ts";

export default billingRoutes;
