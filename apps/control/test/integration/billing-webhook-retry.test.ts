import type { Env } from '@/shared/types';
import { createMockEnv } from './setup.ts';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const billingMocks = ({
  getOrCreateBillingAccount: ((..._args: any[]) => undefined) as any,
  addCredits: ((..._args: any[]) => undefined) as any,
  assignPlanToUser: ((..._args: any[]) => undefined) as any,
});

const stripeMocks = ({
  createCheckoutSession: ((..._args: any[]) => undefined) as any,
  createPortalSession: ((..._args: any[]) => undefined) as any,
  verifyWebhookSignature: ((..._args: any[]) => undefined) as any,
  retrieveCheckoutSession: ((..._args: any[]) => undefined) as any,
  listInvoices: ((..._args: any[]) => undefined) as any,
  retrieveInvoice: ((..._args: any[]) => undefined) as any,
  sendInvoice: ((..._args: any[]) => undefined) as any,
});

const dbMocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/application/services/billing/billing'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/billing/stripe'
// [Deno] vi.mock removed - manually stub imports from '@/infra/db'
import { billingWebhookHandler } from '@/server/routes/billing';

/**
 * Build a Drizzle-chainable mock for the billing webhook handler.
 * Production code uses: db.update(table).set({...}).where(...) and db.select().from(table).where(...).get()
 */
function makeDrizzleDb(overrides?: { updateFn?: ReturnType<typeof vi.fn> }) {
  const updateFn = overrides?.updateFn ?? async () => ({});
  const selectGetFn = async () => null;
  return {
    update: () => ({
      set: () => ({
        where: updateFn,
        run: updateFn,
      }),
    }),
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        get: selectGetFn,
        all: async () => [],
      };
      return chain;
    },
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


  Deno.test('billing webhook retry behavior - returns non-2xx when internal processing fails after signature verification', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    dbMocks.getDb = (() => makeDrizzleDb()) as any;
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

    stripeMocks.verifyWebhookSignature = (async () => ({
      event: JSON.parse(payload),
    })) as any;
    stripeMocks.retrieveCheckoutSession = (async () => ({
      id: 'cs_test_1',
      customer: 'cus_123',
      subscription: 'sub_123',
      metadata: { user_id: 'user-1', purchase_kind: 'plus_subscription' },
    })) as any;
    billingMocks.getOrCreateBillingAccount = (async () => ({
      id: 'account-1',
    })) as any;

    const failingUpdate = (async () => { throw new Error('db write failed'); });
    const dbLocal = makeDrizzleDb({ updateFn: failingUpdate });
    dbMocks.getDb = (() => dbLocal) as any;

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

    assertEquals(response.status, 500);
    await assertEquals(await response.json(), ({ error: 'Webhook processing failed' }));
    assertSpyCallArgs(stripeMocks.verifyWebhookSignature, 0, [{
      payload,
      signature: 't=1,v1=test',
      secret: 'whsec_test',
    }]);
    assertSpyCalls(failingUpdate, 1);
    assertSpyCalls(billingMocks.addCredits, 0);
})
  Deno.test('billing webhook retry behavior - keeps invalid signature responses as 400', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    dbMocks.getDb = (() => makeDrizzleDb()) as any;
  const payload = JSON.stringify({
      id: 'evt_invalid_sig',
      type: 'invoice.paid',
      data: { object: {} },
    });
    stripeMocks.verifyWebhookSignature = (async () => { throw new Error('Invalid webhook signature'); }) as any;

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

    assertEquals(response.status, 400);
    await assertEquals(await response.json(), ({ error: 'Invalid signature' }));
    assertSpyCalls(dbMocks.getDb, 0);
})