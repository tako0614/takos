/**
 * Stripe API Service for takos-control
 *
 * Uses raw fetch() + crypto.subtle for Workers compatibility.
 * No Stripe SDK dependency.
 */
export declare function createCheckoutSession(opts: {
    secretKey: string;
    priceId: string;
    mode: 'subscription' | 'payment';
    userId: string;
    customerEmail: string;
    stripeCustomerId?: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
}): Promise<{
    url: string;
    sessionId: string;
}>;
export declare function createPortalSession(opts: {
    secretKey: string;
    customerId: string;
    returnUrl: string;
}): Promise<{
    url: string;
}>;
export interface StripeCheckoutSession {
    id: string;
    customer: string | null;
    subscription: string | null;
    mode?: 'subscription' | 'payment';
    payment_status?: string | null;
    metadata: Record<string, string>;
}
export declare function retrieveCheckoutSession(opts: {
    secretKey: string;
    sessionId: string;
}): Promise<StripeCheckoutSession>;
/**
 * Verify Stripe webhook signature using crypto.subtle (Workers-compatible).
 * Implements Stripe's v1 signature scheme: HMAC-SHA256(timestamp.payload).
 */
export declare function verifyWebhookSignature(opts: {
    payload: string;
    signature: string;
    secret: string;
    tolerance?: number;
}): Promise<{
    event: StripeWebhookEvent;
}>;
export interface StripeInvoice {
    id: string;
    /** Customer ID string, or expanded customer object when ?expand[]=customer is used. */
    customer: string | {
        id: string;
    };
    status?: string | null;
    number?: string | null;
    currency?: string | null;
    amount_due?: number | null;
    amount_paid?: number | null;
    total?: number | null;
    created?: number | null;
    period_start?: number | null;
    period_end?: number | null;
    hosted_invoice_url?: string | null;
    invoice_pdf?: string | null;
}
/** Stripe subscription object (fields used in webhook handling). */
export interface StripeSubscription {
    id: string;
    customer: string;
    status: string;
}
/** Stripe invoice line item period. */
interface StripeInvoiceLinePeriod {
    start?: number;
    end?: number;
}
/** Stripe invoice line item. */
interface StripeInvoiceLineItem {
    period?: StripeInvoiceLinePeriod;
}
/** Stripe invoice object as received in webhook payloads. */
export interface StripeWebhookInvoice extends StripeInvoice {
    lines?: {
        data?: StripeInvoiceLineItem[];
    };
}
/** Stripe checkout.session webhook object (minimal fields). */
export interface StripeWebhookCheckoutSession {
    id: string;
    customer: string | null;
    subscription: string | null;
    mode?: 'subscription' | 'payment';
    payment_status?: string | null;
    metadata: Record<string, string>;
}
/**
 * Map from Stripe event type to the expected data.object shape.
 * Unmapped event types fall back to Record<string, unknown>.
 */
export interface StripeEventObjectMap {
    'checkout.session.completed': StripeWebhookCheckoutSession;
    'invoice.paid': StripeWebhookInvoice;
    'customer.subscription.deleted': StripeSubscription;
}
export type StripeWebhookEventType = keyof StripeEventObjectMap;
export interface StripeWebhookEvent<T extends string = string> {
    id: string;
    type: T;
    data: {
        object: T extends StripeWebhookEventType ? StripeEventObjectMap[T] : Record<string, unknown>;
    };
}
export declare function listInvoices(opts: {
    secretKey: string;
    customerId: string;
    limit?: number;
    startingAfter?: string;
    endingBefore?: string;
}): Promise<{
    invoices: StripeInvoice[];
    has_more: boolean;
}>;
export declare function retrieveInvoice(opts: {
    secretKey: string;
    invoiceId: string;
}): Promise<StripeInvoice>;
export declare function sendInvoice(opts: {
    secretKey: string;
    invoiceId: string;
}): Promise<StripeInvoice>;
export {};
//# sourceMappingURL=stripe.d.ts.map