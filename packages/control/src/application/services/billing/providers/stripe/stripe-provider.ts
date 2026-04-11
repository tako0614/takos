/**
 * Stripe implementation of the `PaymentProvider` interface.
 *
 * This adapter wraps the low-level fetch-based helpers in
 * `application/services/billing/stripe.ts` and translates Stripe-specific
 * shapes into the provider-agnostic types from `payment-provider.ts`.
 *
 * No code outside `providers/stripe/` should import from `stripe.ts` directly.
 */

import type { Env } from '../../../../../shared/types/index.ts';
import type {
  BillingWebhookEvent,
  CheckoutSessionResult,
  CompletedCheckoutSession,
  CreateCheckoutInput,
  CreatePortalInput,
  ListInvoicesInput,
  NormalizedInvoice,
  PaymentProvider,
} from '../../payment-provider.ts';
import {
  createCheckoutSession as stripeCreateCheckoutSession,
  createPortalSession as stripeCreatePortalSession,
  listInvoices as stripeListInvoices,
  retrieveCheckoutSession as stripeRetrieveCheckoutSession,
  retrieveInvoice as stripeRetrieveInvoice,
  sendInvoice as stripeSendInvoice,
  type StripeCheckoutSession,
  type StripeInvoice,
  type StripeSubscription,
  type StripeWebhookCheckoutSession,
  type StripeWebhookEvent,
  type StripeWebhookInvoice,
  verifyWebhookSignature,
} from '../../stripe.ts';

function toCustomerIdString(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id;
}

function toCheckoutMode(mode: 'subscription' | 'payment' | undefined): 'subscription' | 'one_time' {
  return mode === 'subscription' ? 'subscription' : 'one_time';
}

function toPaymentStatus(value: string | null | undefined): CompletedCheckoutSession['paymentStatus'] {
  if (value === 'paid' || value === 'unpaid' || value === 'no_payment_required') {
    return value;
  }
  return null;
}

function normalizeCheckoutSession(
  session: StripeCheckoutSession | StripeWebhookCheckoutSession,
): CompletedCheckoutSession {
  return {
    sessionId: session.id,
    customerId: toCustomerIdString(session.customer ?? null),
    subscriptionId: session.subscription ?? null,
    mode: toCheckoutMode(session.mode),
    paymentStatus: toPaymentStatus(session.payment_status ?? null),
    metadata: session.metadata ?? {},
  };
}

function normalizeInvoice(invoice: StripeInvoice): NormalizedInvoice {
  const customerId = toCustomerIdString(invoice.customer);
  if (!customerId) {
    throw new Error(`Stripe invoice ${invoice.id} has no customer`);
  }
  return {
    id: invoice.id,
    customerId,
    number: invoice.number ?? null,
    status: invoice.status ?? null,
    currency: invoice.currency ?? null,
    amountDueCents: invoice.amount_due ?? null,
    amountPaidCents: invoice.amount_paid ?? null,
    totalCents: invoice.total ?? null,
    createdUnix: invoice.created ?? null,
    periodStartUnix: invoice.period_start ?? null,
    periodEndUnix: invoice.period_end ?? null,
    hostedUrl: invoice.hosted_invoice_url ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
  };
}

function normalizeWebhookEvent(event: StripeWebhookEvent): BillingWebhookEvent {
  const eventId = event.id;
  switch (event.type) {
    case 'checkout.session.completed': {
      const obj = event.data.object as unknown as StripeWebhookCheckoutSession;
      return {
        kind: 'checkout_completed',
        eventId,
        session: normalizeCheckoutSession(obj),
      };
    }
    case 'invoice.paid': {
      const obj = event.data.object as unknown as StripeWebhookInvoice;
      const customerId = toCustomerIdString(obj.customer);
      if (!customerId) {
        return { kind: 'unhandled', eventId, providerEventType: event.type };
      }
      const periodEnd = obj.lines?.data?.[0]?.period?.end ?? null;
      return {
        kind: 'invoice_paid',
        eventId,
        customerId,
        currentPeriodEndUnix: periodEnd,
      };
    }
    case 'invoice.payment_failed': {
      const obj = event.data.object as unknown as StripeWebhookInvoice;
      const customerId = toCustomerIdString(obj.customer);
      if (!customerId) {
        return { kind: 'unhandled', eventId, providerEventType: event.type };
      }
      return { kind: 'invoice_payment_failed', eventId, customerId };
    }
    case 'customer.subscription.updated': {
      const obj = event.data.object as unknown as StripeSubscription;
      const customerId = toCustomerIdString(obj.customer);
      if (!customerId) {
        return { kind: 'unhandled', eventId, providerEventType: event.type };
      }
      return {
        kind: 'subscription_updated',
        eventId,
        customerId,
        status: typeof obj.status === 'string' ? obj.status : null,
        currentPeriodEndUnix: typeof obj.current_period_end === 'number'
          ? obj.current_period_end
          : null,
      };
    }
    case 'customer.subscription.deleted': {
      const obj = event.data.object as unknown as StripeSubscription;
      const customerId = toCustomerIdString(obj.customer);
      if (!customerId) {
        return { kind: 'unhandled', eventId, providerEventType: event.type };
      }
      return { kind: 'subscription_canceled', eventId, customerId };
    }
    default:
      return {
        kind: 'unhandled',
        eventId,
        providerEventType: event.type,
      };
  }
}

export function createStripeProvider(env: Env): PaymentProvider {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  return {
    name: 'stripe',

    async createCheckoutSession(input: CreateCheckoutInput): Promise<CheckoutSessionResult> {
      const { url, sessionId } = await stripeCreateCheckoutSession({
        secretKey,
        priceId: input.providerPriceId,
        mode: input.mode === 'subscription' ? 'subscription' : 'payment',
        userId: input.userId,
        customerEmail: input.customerEmail,
        stripeCustomerId: input.existingCustomerId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        metadata: input.metadata,
      });
      return { url, sessionId };
    },

    async createPortalSession(input: CreatePortalInput): Promise<{ url: string }> {
      return await stripeCreatePortalSession({
        secretKey,
        customerId: input.customerId,
        returnUrl: input.returnUrl,
      });
    },

    async retrieveCheckoutSession(sessionId: string): Promise<CompletedCheckoutSession> {
      const session = await stripeRetrieveCheckoutSession({ secretKey, sessionId });
      return normalizeCheckoutSession(session);
    },

    async listInvoices(
      input: ListInvoicesInput,
    ): Promise<{ invoices: NormalizedInvoice[]; hasMore: boolean }> {
      const { invoices, has_more } = await stripeListInvoices({
        secretKey,
        customerId: input.customerId,
        limit: input.limit,
        startingAfter: input.startingAfter,
        endingBefore: input.endingBefore,
      });
      return {
        invoices: invoices.map(normalizeInvoice),
        hasMore: has_more,
      };
    },

    async retrieveInvoice(invoiceId: string): Promise<NormalizedInvoice> {
      const invoice = await stripeRetrieveInvoice({ secretKey, invoiceId });
      return normalizeInvoice(invoice);
    },

    async sendInvoice(invoiceId: string): Promise<void> {
      await stripeSendInvoice({ secretKey, invoiceId });
    },

    async parseWebhook(payload: string, signature: string): Promise<BillingWebhookEvent> {
      if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
      }
      const { event } = await verifyWebhookSignature({
        payload,
        signature,
        secret: webhookSecret,
      });
      return normalizeWebhookEvent(event);
    },

    isTrustedPdfUrl(url: URL): boolean {
      return url.hostname.endsWith('.stripe.com');
    },
  };
}
