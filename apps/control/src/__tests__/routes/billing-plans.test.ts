import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const billingMocks = vi.hoisted(() => ({
  getOrCreateBillingAccount: vi.fn(),
  addCredits: vi.fn(),
  WEEKLY_RUNTIME_LIMIT_SECONDS: 18_000,
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

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/services/billing/billing', () => ({
  getOrCreateBillingAccount: billingMocks.getOrCreateBillingAccount,
  addCredits: billingMocks.addCredits,
  WEEKLY_RUNTIME_LIMIT_SECONDS: billingMocks.WEEKLY_RUNTIME_LIMIT_SECONDS,
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

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: dbMocks.getDb,
}));

import billingRoutes, {
  billingWebhookHandler,
  getConfiguredProTopupPacks,
  resolveConfiguredProTopupPack,
} from '@/routes/billing';

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

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('/api/billing/*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/billing', billingRoutes);
  app.route('/api/billing/webhook', billingWebhookHandler);
  return app;
}

describe('billing plan management routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getDb.mockReturnValue({
      billingAccount: {
        update: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/billing returns billing mode and available actions', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      id: 'acct-1',
      planId: 'plan_payg',
      billingPlan: { id: 'plan_payg', name: 'payg', displayName: 'Pay As You Go', billingPlanQuotas: [], billingPlanRates: [], billingPlanFeatures: [] },
      balanceCents: 420,
      status: 'active',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      subscriptionPeriodEnd: null,
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_starter',
          credits_cents: 2500,
          featured: true,
          badge: 'Popular',
        },
      ]),
    }) as unknown as Env;
    const res = await app.fetch(new Request('http://localhost/api/billing'), env, {} as ExecutionContext);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      plan_tier: 'pro',
      billing_mode: 'pro_prepaid',
      available_actions: {
        subscribe_plus: true,
        top_up_pro: true,
        manage_subscription: false,
      },
      topup_packs: [
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_starter',
          credits_cents: 2500,
          featured: true,
          badge: 'Popular',
        },
      ],
      balance_cents: 420,
    }));
  });

  it('POST /api/billing/subscribe uses the plus subscription price', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
    });
    stripeMocks.createCheckoutSession.mockResolvedValue({ url: 'https://stripe.test/checkout', sessionId: 'cs_1' });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PLUS_PRICE_ID: 'price_plus',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/subscribe', { method: 'POST' }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceId: 'price_plus',
      mode: 'subscription',
      metadata: { purchase_kind: 'plus_subscription' },
    }));
  });

  it('POST /api/billing/credits/checkout rejects when plus is active', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      planId: 'plan_plus',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_topup',
          credits_cents: 2500,
          featured: true,
        },
      ]),
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/credits/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_id: 'starter' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Plus subscription is active; cancel it before switching to Pro',
      code: 'CONFLICT',
    });
  });

  it('POST /api/billing/credits/checkout uses the selected top-up pack', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      planId: 'plan_free',
      stripeSubscriptionId: null,
      stripeCustomerId: 'cus_1',
    });
    stripeMocks.createCheckoutSession.mockResolvedValue({ url: 'https://stripe.test/topup', sessionId: 'cs_topup' });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_starter',
          credits_cents: 2500,
          featured: true,
        },
        {
          id: 'team',
          label: 'Team',
          price_id: 'price_team',
          credits_cents: 10000,
          featured: false,
        },
      ]),
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/credits/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_id: 'team' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    expect(stripeMocks.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceId: 'price_team',
      mode: 'payment',
      metadata: {
        purchase_kind: 'pro_topup',
        pack_id: 'team',
      },
    }));
  });

  it('POST /api/billing/credits/checkout rejects unknown pack ids', async () => {
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      planId: 'plan_free',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_starter',
          credits_cents: 2500,
          featured: true,
        },
      ]),
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/credits/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_id: 'missing' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'Top-up pack not found',
      code: 'NOT_FOUND',
    });
  });

  it('webhook checkout.session.completed upgrades plus subscriptions without credits', async () => {
    const setCalls: unknown[] = [];
    function createDrizzleDbMock() {
      return {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => null),
            })),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn((data: unknown) => {
            setCalls.push(data);
            return {
              where: vi.fn(async () => undefined),
            };
          }),
        })),
      };
    }
    dbMocks.getDb.mockReturnValue(createDrizzleDbMock());
    stripeMocks.verifyWebhookSignature.mockResolvedValue({
      event: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            customer: 'cus_1',
            subscription: 'sub_1',
            metadata: {
              user_id: 'user-1',
              purchase_kind: 'plus_subscription',
            },
          },
        },
      },
    });
    stripeMocks.retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      mode: 'subscription',
      metadata: {
        user_id: 'user-1',
        purchase_kind: 'plus_subscription',
      },
    });
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      id: 'acct-1',
      planId: 'plan_free',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: '{}',
      }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual(expect.objectContaining({
      planId: 'plan_plus',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    }));
    expect(billingMocks.addCredits).not.toHaveBeenCalled();
  });

  it('webhook checkout.session.completed tops up pro credits and switches to payg', async () => {
    const setCalls: unknown[] = [];
    function createDrizzleDbMock() {
      return {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => null),
            })),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn((data: unknown) => {
            setCalls.push(data);
            return {
              where: vi.fn(async () => undefined),
            };
          }),
        })),
      };
    }
    dbMocks.getDb.mockReturnValue(createDrizzleDbMock());
    stripeMocks.verifyWebhookSignature.mockResolvedValue({
      event: {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_2',
            customer: 'cus_1',
            subscription: null,
            payment_status: 'paid',
            metadata: {
              user_id: 'user-1',
              purchase_kind: 'pro_topup',
              pack_id: 'starter',
            },
          },
        },
      },
    });
    stripeMocks.retrieveCheckoutSession.mockResolvedValue({
      id: 'cs_2',
      customer: 'cus_1',
      subscription: null,
      payment_status: 'paid',
      mode: 'payment',
      metadata: {
        user_id: 'user-1',
        purchase_kind: 'pro_topup',
        pack_id: 'starter',
      },
    });
    billingMocks.getOrCreateBillingAccount.mockResolvedValue({
      id: 'acct-1',
      planId: 'plan_free',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_starter',
          credits_cents: 2500,
          featured: true,
        },
      ]),
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: '{}',
      }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual(expect.objectContaining({
      planId: 'plan_payg',
      stripeCustomerId: 'cus_1',
    }));
    expect(billingMocks.addCredits).toHaveBeenCalledWith(expect.anything(), 'acct-1', 2500, 'Pro top-up credit (starter, 2500¢)');
  });

  it('subscription deletion falls back to payg when balance remains', async () => {
    const setCalls: unknown[] = [];
    function createDrizzleDbMock() {
      return {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn(async () => ({
                id: 'acct-1',
                balanceCents: 120,
                stripeCustomerId: 'cus_1',
              })),
            })),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn((data: unknown) => {
            setCalls.push(data);
            return {
              where: vi.fn(async () => undefined),
            };
          }),
        })),
      };
    }
    dbMocks.getDb.mockReturnValue(createDrizzleDbMock());
    stripeMocks.verifyWebhookSignature.mockResolvedValue({
      event: {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_1',
            customer: 'cus_1',
            status: 'canceled',
          },
        },
      },
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
    }) as unknown as Env;

    const res = await app.fetch(
      new Request('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: '{}',
      }),
      env,
      {} as ExecutionContext
    );

    expect(res.status).toBe(200);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual(expect.objectContaining({
      planId: 'plan_payg',
      stripeSubscriptionId: null,
    }));
  });

  it('parses configured top-up packs from JSON config', () => {
    const packs = getConfiguredProTopupPacks(createMockEnv({
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: 'price_starter',
          credits_cents: 2500,
          featured: true,
          badge: 'Popular',
        },
      ]),
    }) as unknown as Env);

    expect(packs).toEqual([
      {
        id: 'starter',
        label: 'Starter',
        priceId: 'price_starter',
        creditsCents: 2500,
        featured: true,
        badge: 'Popular',
      },
    ]);
  });

  it('rejects invalid pack catalogs', () => {
    expect(() => getConfiguredProTopupPacks(createMockEnv({
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([]),
    }) as unknown as Env)).toThrow('STRIPE_PRO_TOPUP_PACKS_JSON must be a non-empty array');

    expect(() => getConfiguredProTopupPacks(createMockEnv({
      STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
        {
          id: 'starter',
          label: 'Starter',
          price_id: '',
          credits_cents: 2500,
          featured: true,
        },
      ]),
    }) as unknown as Env)).toThrow('Top-up pack "starter" is missing price_id');
  });
});
