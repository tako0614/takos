import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/shared/types';
import { createMockEnv } from './setup';

const billingMocks = vi.hoisted(() => ({
  getOrCreateBillingAccount: vi.fn(),
  addCredits: vi.fn(),
  assignPlanToUser: vi.fn(),
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

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/application/services/billing/billing', () => ({
  getOrCreateBillingAccount: billingMocks.getOrCreateBillingAccount,
  addCredits: billingMocks.addCredits,
  assignPlanToUser: billingMocks.assignPlanToUser,
}));

vi.mock('@/application/services/billing/stripe', () => ({
  createCheckoutSession: stripeMocks.createCheckoutSession,
  createPortalSession: stripeMocks.createPortalSession,
  verifyWebhookSignature: stripeMocks.verifyWebhookSignature,
  retrieveCheckoutSession: stripeMocks.retrieveCheckoutSession,
  listInvoices: stripeMocks.listInvoices,
  retrieveInvoice: stripeMocks.retrieveInvoice,
  sendInvoice: stripeMocks.sendInvoice,
}));

vi.mock('@/infra/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/infra/db')>()),
  getDb: dbMocks.getDb,
}));

import { billingWebhookHandler } from '@/server/routes/billing';

/**
 * Build a Drizzle-chainable mock for the billing webhook handler.
 * Production code uses: db.update(table).set({...}).where(...) and db.select().from(table).where(...).get()
 */
function makeDrizzleDb(overrides?: { updateFn?: ReturnType<typeof vi.fn> }) {
  const updateFn = overrides?.updateFn ?? vi.fn(async () => ({}));
  const selectGetFn = vi.fn(async () => null);
  return {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: updateFn,
        run: updateFn,
      })),
    })),
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        get: selectGetFn,
        all: vi.fn(async () => []),
      };
      return chain;
    }),
    _updateFn: updateFn,
    _selectGetFn: selectGetFn,
  };
}

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    ...overrides,
  }) as unknown as Env;
}

describe('billing webhook retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getDb.mockReturnValue(makeDrizzleDb());
  });

  it('returns non-2xx when internal processing fails after signature verification', async () => {
    const payload = JSON.stringify({
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { user_id: 'user-1', purchase_kind: 'plus_subscription' },
        },
      },
    });

    stripeMocks.verifyWebhookSignature.mockResolvedValue({
      event: JSON.parse(payload),
    });
    stripeMocks.retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_test_1',
      customer: 'cus_123',
      subscription: 'sub_123',
      metadata: { user_id: 'user-1', purchase_kind: 'plus_subscription' },
    });
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      id: 'account-1',
    });

    const failingUpdate = vi.fn().mockRejectedValue(new Error('db write failed'));
    const dbLocal = makeDrizzleDb({ updateFn: failingUpdate });
    dbMocks.getDb.mockReturnValue(dbLocal);

    const response = await billingWebhookHandler.fetch(
      new Request('https://takos.jp/', {
        method: 'POST',
        headers: {
          'stripe-signature': 't=1,v1=test',
          'content-type': 'application/json',
        },
        body: payload,
      }),
      createEnv(),
      {} as ExecutionContext
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: 'Webhook processing failed' }));
    expect(stripeMocks.verifyWebhookSignature).toHaveBeenCalledWith({
      payload,
      signature: 't=1,v1=test',
      secret: 'whsec_test',
    });
    expect(failingUpdate).toHaveBeenCalledTimes(1);
    expect(billingMocks.addCredits).not.toHaveBeenCalled();
  });

  it('keeps invalid signature responses as 400', async () => {
    const payload = JSON.stringify({
      id: 'evt_invalid_sig',
      type: 'invoice.paid',
      data: { object: {} },
    });
    stripeMocks.verifyWebhookSignature.mockRejectedValue(new Error('Invalid webhook signature'));

    const response = await billingWebhookHandler.fetch(
      new Request('https://takos.jp/', {
        method: 'POST',
        headers: {
          'stripe-signature': 't=1,v1=bad',
          'content-type': 'application/json',
        },
        body: payload,
      }),
      createEnv(),
      {} as ExecutionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: 'Invalid signature' }));
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });
});
