/**
 * Billing RPC for the account plane.
 * Ported from takosumi dashboard-ui/src/lib/rpc/billing.ts.
 */
import { apiFetch } from "./http.ts";
import * as paths from "./paths.ts";

export interface StripeCheckoutResult {
  readonly url?: string;
  readonly sessionId?: string;
}

export async function startStripeCheckout(input: {
  readonly planId?: string;
  readonly successUrl?: string;
  readonly cancelUrl?: string;
}): Promise<StripeCheckoutResult> {
  return await apiFetch<StripeCheckoutResult>(paths.STRIPE_CHECKOUT, {
    method: "POST",
    body: input,
  });
}
