/**
 * Stripe API Service for takos-control
 *
 * Uses raw fetch() + crypto.subtle for Workers compatibility.
 * No Stripe SDK dependency.
 */

import { constantTimeEqual } from '../../../shared/utils/hash';
import { bytesToHex } from '../../../shared/utils/encoding-utils';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Execute an authenticated request against the Stripe REST API.
 * Throws on non-2xx responses with the status code and body.
 */
async function stripeRequest<T>(
  secretKey: string,
  path: string,
  label: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey}`,
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${STRIPE_API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stripe ${label} error: ${res.status} ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * POST to Stripe with URL-encoded form body.
 */
async function stripePost<T>(
  secretKey: string,
  path: string,
  label: string,
  params?: URLSearchParams,
): Promise<T> {
  return stripeRequest<T>(secretKey, path, label, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params?.toString() ?? '',
  });
}

// ============================================================================
// Checkout Session
// ============================================================================

export async function createCheckoutSession(opts: {
  secretKey: string;
  priceId: string;
  mode: 'subscription' | 'payment';
  userId: string;
  customerEmail: string;
  stripeCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<{ url: string; sessionId: string }> {
  const params = new URLSearchParams();
  params.set('mode', opts.mode);
  params.set('line_items[0][price]', opts.priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', opts.successUrl);
  params.set('cancel_url', opts.cancelUrl);
  params.set('metadata[user_id]', opts.userId);
  for (const [key, value] of Object.entries(opts.metadata ?? {})) {
    params.set(`metadata[${key}]`, value);
  }

  if (opts.stripeCustomerId) {
    params.set('customer', opts.stripeCustomerId);
  } else {
    params.set('customer_email', opts.customerEmail);
  }

  const data = await stripePost<{ id: string; url: string }>(
    opts.secretKey,
    '/checkout/sessions',
    'checkout',
    params,
  );
  return { url: data.url, sessionId: data.id };
}

// ============================================================================
// Customer Portal
// ============================================================================

export async function createPortalSession(opts: {
  secretKey: string;
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const params = new URLSearchParams();
  params.set('customer', opts.customerId);
  params.set('return_url', opts.returnUrl);

  const data = await stripePost<{ url: string }>(
    opts.secretKey,
    '/billing_portal/sessions',
    'portal',
    params,
  );
  return { url: data.url };
}

// ============================================================================
// Retrieve Checkout Session (for webhook processing)
// ============================================================================

export interface StripeCheckoutSession {
  id: string;
  customer: string | null;
  subscription: string | null;
  mode?: 'subscription' | 'payment';
  payment_status?: string | null;
  metadata: Record<string, string>;
}

export async function retrieveCheckoutSession(opts: {
  secretKey: string;
  sessionId: string;
}): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(
    opts.secretKey,
    `/checkout/sessions/${opts.sessionId}`,
    'retrieve session',
  );
}

// ============================================================================
// Webhook Signature Verification
// ============================================================================

/**
 * Verify Stripe webhook signature using crypto.subtle (Workers-compatible).
 * Implements Stripe's v1 signature scheme: HMAC-SHA256(timestamp.payload).
 */
export async function verifyWebhookSignature(opts: {
  payload: string;
  signature: string;
  secret: string;
  tolerance?: number; // seconds, default 60
}): Promise<{ event: StripeWebhookEvent }> {
  const tolerance = opts.tolerance ?? 60;

  // Parse the Stripe-Signature header
  const parts = opts.signature.split(',');
  let timestamp = '';
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid Stripe signature format');
  }

  // Check timestamp tolerance
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) {
    throw new Error('Webhook timestamp too old');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${opts.payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(opts.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expected = bytesToHex(new Uint8Array(sig));

  // Constant-time comparison
  if (!signatures.some((s) => constantTimeEqual(s, expected))) {
    throw new Error('Invalid webhook signature');
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(opts.payload) as StripeWebhookEvent;
  } catch (err) {
    throw new Error(`Failed to parse webhook payload: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { event };
}

// ============================================================================
// Shared Type Definitions
// ============================================================================

export interface StripeInvoice {
  id: string;
  /** Customer ID string, or expanded customer object when ?expand[]=customer is used. */
  customer: string | { id: string };
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

// ============================================================================
// Webhook Event Types
// ============================================================================

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
  lines?: { data?: StripeInvoiceLineItem[] };
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
    object: T extends StripeWebhookEventType
      ? StripeEventObjectMap[T]
      : Record<string, unknown>;
  };
}

export async function listInvoices(opts: {
  secretKey: string;
  customerId: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}): Promise<{ invoices: StripeInvoice[]; has_more: boolean }> {
  const params = new URLSearchParams();
  params.set('customer', opts.customerId);
  params.set('limit', String(opts.limit ?? 20));
  if (opts.startingAfter) params.set('starting_after', opts.startingAfter);
  if (opts.endingBefore) params.set('ending_before', opts.endingBefore);

  const data = await stripeRequest<{ data: StripeInvoice[]; has_more: boolean }>(
    opts.secretKey,
    `/invoices?${params.toString()}`,
    'list invoices',
  );
  return { invoices: data.data || [], has_more: Boolean(data.has_more) };
}

export async function retrieveInvoice(opts: {
  secretKey: string;
  invoiceId: string;
}): Promise<StripeInvoice> {
  return stripeRequest<StripeInvoice>(
    opts.secretKey,
    `/invoices/${opts.invoiceId}`,
    'retrieve invoice',
  );
}

export async function sendInvoice(opts: {
  secretKey: string;
  invoiceId: string;
}): Promise<StripeInvoice> {
  return stripePost<StripeInvoice>(
    opts.secretKey,
    `/invoices/${opts.invoiceId}/send`,
    'send invoice',
  );
}
