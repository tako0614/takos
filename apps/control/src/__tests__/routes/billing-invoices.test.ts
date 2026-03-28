import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const billingMocks = vi.hoisted(() => ({
  getOrCreateBillingAccount: vi.fn(),
  addCredits: vi.fn(),
  assignPlanToUser: vi.fn(),
  assertBillingPlanId: vi.fn((planId: string) => {
    if (planId === 'plan_free' || planId === 'plan_plus' || planId === 'plan_payg') {
      return planId;
    }
    throw new Error(`Unknown billing plan: ${planId}`);
  }),
  resolveBillingMode: vi.fn((planId: string) => (
    planId === 'plan_plus'
      ? 'plus_subscription'
      : planId === 'plan_payg'
        ? 'pro_prepaid'
        : 'free'
  )),
  resolveBillingPlanTier: vi.fn((planId: string) => (
    planId === 'plan_plus'
      ? 'plus'
      : planId === 'plan_payg'
        ? 'pro'
        : 'free'
  )),
}));

const stripeMocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  listInvoices: vi.fn(),
  retrieveInvoice: vi.fn(),
  sendInvoice: vi.fn(),
}));

vi.mock('@/services/billing/billing', () => ({
  getOrCreateBillingAccount: billingMocks.getOrCreateBillingAccount,
  addCredits: billingMocks.addCredits,
  assignPlanToUser: billingMocks.assignPlanToUser,
  assertBillingPlanId: billingMocks.assertBillingPlanId,
  resolveBillingMode: billingMocks.resolveBillingMode,
  resolveBillingPlanTier: billingMocks.resolveBillingPlanTier,
}));

vi.mock('@/services/billing/stripe', () => ({
  createCheckoutSession: stripeMocks.createCheckoutSession,
  createPortalSession: stripeMocks.createPortalSession,
  verifyWebhookSignature: stripeMocks.verifyWebhookSignature,
  retrieveCheckoutSession: stripeMocks.retrieveCheckoutSession,
  listInvoices: stripeMocks.listInvoices,
  retrieveInvoice: stripeMocks.retrieveInvoice,
  sendInvoice: stripeMocks.sendInvoice,
}));

import billingRoutes from '@/routes/billing/routes';

const TEST_TIMESTAMP = '2026-02-11T00:00:00.000Z';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User 1',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
  };
}

function createBillingApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/billing', billingRoutes);
  return app;
}

describe('billing invoices API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/billing/invoices returns 500 when Stripe is not configured', async () => {
    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv() as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/invoices'),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Billing not configured', code: 'INTERNAL_ERROR' });
  });

  it('GET /api/billing/invoices returns 400 when user has no Stripe customer', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      stripeCustomerId: null,
    });
    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/invoices'),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'No Stripe customer found', code: 'BAD_REQUEST' });
  });

  it('GET /api/billing/invoices returns invoices list', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      stripeCustomerId: 'cus_123',
    });
    stripeMocks.listInvoices.mockResolvedValue({
      invoices: [
        {
          id: 'in_1',
          number: 'A-1',
          status: 'paid',
          currency: 'jpy',
          amount_due: 100,
          amount_paid: 100,
          total: 100,
          created: 123,
          period_start: 1,
          period_end: 2,
          hosted_invoice_url: 'https://example.com/hosted',
          invoice_pdf: 'https://example.com/pdf',
        },
      ],
      has_more: false,
    });
    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/invoices?limit=10'),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      invoices: [
        {
          id: 'in_1',
          number: 'A-1',
          status: 'paid',
          currency: 'jpy',
          amount_due: 100,
          amount_paid: 100,
          total: 100,
          created: 123,
          period_start: 1,
          period_end: 2,
          hosted_invoice_url: 'https://example.com/hosted',
          invoice_pdf: 'https://example.com/pdf',
        },
      ],
      has_more: false,
    });
    expect(stripeMocks.listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_123', limit: 10 })
    );
  });

  it('GET /api/billing/invoices/:id/pdf returns 404 when invoice is not owned by customer', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      stripeCustomerId: 'cus_123',
    });
    stripeMocks.retrieveInvoice.mockResolvedValue({
      id: 'in_1',
      customer: 'cus_other',
      invoice_pdf: 'https://example.com/pdf',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response('PDF', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/invoices/in_1/pdf'),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Invoice not found', code: 'NOT_FOUND' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET /api/billing/invoices/:id/pdf streams the invoice PDF', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      stripeCustomerId: 'cus_123',
    });
    stripeMocks.retrieveInvoice.mockResolvedValue({
      id: 'in_1',
      customer: 'cus_123',
      invoice_pdf: 'https://files.stripe.com/pdf/in_1',
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('PDFDATA', { status: 200, headers: { 'content-length': '7' } })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/invoices/in_1/pdf'),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="stripe-invoice-in_1.pdf"');
    expect(await res.text()).toBe('PDFDATA');
  });

  it('POST /api/billing/invoices/:id/send returns success', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      stripeCustomerId: 'cus_123',
    });
    stripeMocks.retrieveInvoice.mockResolvedValue({
      id: 'in_1',
      customer: 'cus_123',
      invoice_pdf: 'https://files.stripe.com/pdf/in_1',
    });
    stripeMocks.sendInvoice.mockResolvedValue({ id: 'in_1', customer: 'cus_123' });

    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/invoices/in_1/send', { method: 'POST' }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(stripeMocks.sendInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'in_1' })
    );
  });
});
