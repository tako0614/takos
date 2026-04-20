/**
 * Payment processor abstraction for the billing system.
 *
 * The billing system supports a single payment processor per deployment, selected
 * via the `BILLING_PROCESSOR` env (default: 'stripe'). All routes and webhook
 * handlers interact with the abstract `PaymentProcessor` interface — processor
 * specific concepts (Stripe Price IDs, Stripe webhook signature scheme, etc.)
 * are confined to `processors/<name>/`.
 *
 * To add a new processor:
 *   1. Implement `PaymentProcessor` in `processors/<name>/<name>-processor.ts`
 *   2. Register a factory in `processors/index.ts`
 *   3. Add the processor's env vars to `shared/types/env.ts`
 */

export interface CreateCheckoutInput {
  mode: "subscription" | "one_time";
  /** Processor-side SKU/Price identifier. Stripe: `price_*`. */
  priceId: string;
  userId: string;
  customerEmail: string;
  /** When set, the processor should reuse this customer instead of creating a new one. */
  existingCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

export interface CompletedCheckoutSession {
  sessionId: string;
  customerId: string | null;
  subscriptionId: string | null;
  mode: "subscription" | "one_time";
  paymentStatus: "paid" | "unpaid" | "no_payment_required" | null;
  metadata: Record<string, string>;
}

export interface CreatePortalInput {
  customerId: string;
  returnUrl: string;
}

export interface NormalizedInvoice {
  id: string;
  customerId: string;
  number: string | null;
  status: string | null;
  currency: string | null;
  amountDueCents: number | null;
  amountPaidCents: number | null;
  totalCents: number | null;
  createdUnix: number | null;
  periodStartUnix: number | null;
  periodEndUnix: number | null;
  /** Hosted HTML invoice URL (processor-hosted). */
  hostedUrl: string | null;
  /** PDF invoice URL (processor-hosted). */
  pdfUrl: string | null;
}

export interface ListInvoicesInput {
  customerId: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

/**
 * Webhook event normalized into a processor-agnostic shape. The webhook route
 * branches on `event.kind` and never sees processor-specific event types.
 *
 * `eventId` is used by the idempotency dedup table — it MUST be globally
 * unique within a single processor's event stream.
 */
export type BillingWebhookEvent =
  | {
    kind: "checkout_completed";
    eventId: string;
    session: CompletedCheckoutSession;
  }
  | {
    kind: "invoice_paid";
    eventId: string;
    customerId: string;
    currentPeriodEndUnix: number | null;
  }
  | {
    kind: "invoice_payment_failed";
    eventId: string;
    customerId: string;
  }
  | {
    kind: "subscription_updated";
    eventId: string;
    customerId: string;
    status: string | null;
    currentPeriodEndUnix: number | null;
  }
  | {
    kind: "subscription_canceled";
    eventId: string;
    customerId: string;
  }
  | {
    kind: "unhandled";
    eventId: string;
    processorEventType: string;
  };

export interface PaymentProcessor {
  /** Processor name written to `billing_accounts.processor_name`. */
  readonly name: string;

  createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<CheckoutSessionResult>;
  createPortalSession(input: CreatePortalInput): Promise<{ url: string }>;
  retrieveCheckoutSession(sessionId: string): Promise<CompletedCheckoutSession>;

  listInvoices(
    input: ListInvoicesInput,
  ): Promise<{ invoices: NormalizedInvoice[]; hasMore: boolean }>;
  retrieveInvoice(invoiceId: string): Promise<NormalizedInvoice>;
  sendInvoice(invoiceId: string): Promise<void>;

  /**
   * Verify the webhook payload signature and normalize it into a
   * `BillingWebhookEvent`. Throws on signature failure or malformed payload.
   * Unknown event types are returned as `kind: 'unhandled'` so the route can
   * acknowledge them without retry.
   */
  parseWebhook(
    payload: string,
    signature: string,
  ): Promise<BillingWebhookEvent>;

  /**
   * Validate that an invoice PDF URL belongs to this processor's trusted hosts.
   * Used by the invoice PDF proxy route to prevent SSRF.
   */
  isTrustedPdfUrl(url: URL): boolean;
}
