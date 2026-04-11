import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type {
  BillingWebhookEvent,
  CheckoutSessionResult,
  CompletedCheckoutSession,
  CreateCheckoutInput,
  ListInvoicesInput,
  NormalizedInvoice,
  PaymentProvider,
} from "@/services/billing/billing";

const billingMocks = {
  getOrCreateBillingAccount: ((..._args: any[]) => undefined) as any,
  addCredits: spy((..._args: any[]) => undefined) as any,
  WEEKLY_RUNTIME_LIMIT_SECONDS: 18_000,
  assertBillingPlanId: (planId: string) => {
    if (
      planId === "plan_free" || planId === "plan_plus" || planId === "plan_payg"
    ) {
      return planId;
    }
    throw new Error(`Unknown billing plan: ${planId}`);
  },
  resolveBillingMode: (planId: string) => (
    planId === "plan_plus"
      ? "plus_subscription"
      : planId === "plan_payg"
      ? "pro_prepaid"
      : "free"
  ),
  resolveBillingPlanTier: (planId: string) => (
    planId === "plan_plus" ? "plus" : planId === "plan_payg" ? "pro" : "free"
  ),
};

interface ProviderMock {
  createCheckoutSession: (input: CreateCheckoutInput) => Promise<CheckoutSessionResult>;
  createPortalSession: (input: unknown) => Promise<{ url: string }>;
  retrieveCheckoutSession: (sessionId: string) => Promise<CompletedCheckoutSession>;
  listInvoices: (input: ListInvoicesInput) => Promise<{ invoices: NormalizedInvoice[]; hasMore: boolean }>;
  retrieveInvoice: (invoiceId: string) => Promise<NormalizedInvoice>;
  sendInvoice: (invoiceId: string) => Promise<void>;
  parseWebhook: (payload: string, signature: string) => Promise<BillingWebhookEvent>;
  isTrustedPdfUrl: (url: URL) => boolean;
}

let providerMock: ProviderMock;

function newProviderMock(): ProviderMock {
  return {
    createCheckoutSession: ((..._a: any[]) => undefined) as any,
    createPortalSession: ((..._a: any[]) => undefined) as any,
    retrieveCheckoutSession: ((..._a: any[]) => undefined) as any,
    listInvoices: ((..._a: any[]) => undefined) as any,
    retrieveInvoice: ((..._a: any[]) => undefined) as any,
    sendInvoice: ((..._a: any[]) => undefined) as any,
    parseWebhook: ((..._a: any[]) => undefined) as any,
    isTrustedPdfUrl: (url: URL) => url.hostname.endsWith(".stripe.com"),
  };
}

const dbMocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

import billingRoutes, {
  billingRouteDeps,
  billingWebhookHandler,
  getConfiguredProTopupPacks,
} from "@/routes/billing/routes";

const TEST_TIMESTAMP = "2026-02-11T00:00:00.000Z";

function createUser(): User {
  return {
    id: "user-1",
    email: "user1@example.com",
    name: "User 1",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use("/api/billing/*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.onError((err, c) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const code = (err as { code?: string }).code ?? "INTERNAL_ERROR";
    return c.json({
      error: err instanceof Error ? err.message : String(err),
      code,
    }, status as never);
  });
  app.route("/api/billing", billingRoutes);
  app.route("/api/billing/webhook", billingWebhookHandler);
  return app;
}

function syncBillingRouteDeps() {
  billingRouteDeps.getDb = dbMocks.getDb;
  billingRouteDeps.getOrCreateBillingAccount =
    billingMocks.getOrCreateBillingAccount;
  billingRouteDeps.addCredits = billingMocks.addCredits;
  billingRouteDeps.assertBillingPlanId = billingMocks
    .assertBillingPlanId as any;
  billingRouteDeps.resolveBillingMode = billingMocks.resolveBillingMode as any;
  billingRouteDeps.resolveBillingPlanTier = billingMocks
    .resolveBillingPlanTier as any;
  billingRouteDeps.WEEKLY_RUNTIME_LIMIT_SECONDS =
    billingMocks.WEEKLY_RUNTIME_LIMIT_SECONDS;
  billingRouteDeps.resolvePaymentProvider = (() =>
    ({ name: "stripe", ...providerMock }) as PaymentProvider) as any;
}

Deno.test("billing plan management routes - GET /api/billing returns billing mode and available actions", async () => {
  providerMock = newProviderMock();
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    id: "acct-1",
    planId: "plan_payg",
    billingPlan: {
      id: "plan_payg",
      name: "payg",
      displayName: "Pay As You Go",
      billingPlanQuotas: [],
      billingPlanRates: [],
      billingPlanFeatures: [],
    },
    balanceCents: 420,
    status: "active",
    providerName: "stripe",
    providerCustomerId: "cus_1",
    providerSubscriptionId: null,
    subscriptionPeriodEnd: null,
  })) as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
      {
        id: "starter",
        label: "Starter",
        price_id: "price_starter",
        credits_cents: 2500,
        featured: true,
        badge: "Popular",
      },
    ]),
  }) as unknown as Env;
  const res = await app.fetch(
    new Request("http://localhost/api/billing"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    plan: {
      id: "plan_payg",
      name: "payg",
      display_name: "Pay As You Go",
    },
    plan_tier: "pro",
    billing_mode: "pro_prepaid",
    available_actions: {
      subscribe_plus: true,
      top_up_pro: true,
      manage_subscription: false,
    },
    topup_packs: [
      {
        id: "starter",
        label: "Starter",
        credits_cents: 2500,
        featured: true,
        badge: "Popular",
      },
    ],
    balance_cents: 420,
    status: "active",
    has_payment_account: true,
    has_subscription: false,
    subscription_period_end: null,
    runtime_limit_7d_seconds: 18_000,
  });
});

Deno.test("billing plan management routes - POST /api/billing/subscribe uses the plus subscription price", async () => {
  providerMock = newProviderMock();
  dbMocks.getDb = (() => ({})) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    providerCustomerId: "cus_1",
    providerSubscriptionId: null,
  })) as any;
  const checkoutSpy = spy(async (_input: CreateCheckoutInput) => ({
    url: "https://stripe.test/checkout",
    sessionId: "cs_1",
  }));
  providerMock.createCheckoutSession = checkoutSpy as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_PLUS_PRICE_ID: "price_plus",
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/subscribe", { method: "POST" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const checkoutCall = checkoutSpy.calls[0]?.args[0];
  assertEquals(checkoutCall?.providerPriceId, "price_plus");
  assertEquals(checkoutCall?.mode, "subscription");
  assertEquals(checkoutCall?.metadata, { purchase_kind: "plus_subscription" });
});

Deno.test("billing plan management routes - POST /api/billing/credits/checkout rejects when plus is active", async () => {
  providerMock = newProviderMock();
  dbMocks.getDb = (() => ({})) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    planId: "plan_plus",
    providerSubscriptionId: "sub_1",
    providerCustomerId: "cus_1",
  })) as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
      {
        id: "starter",
        label: "Starter",
        price_id: "price_topup",
        credits_cents: 2500,
        featured: true,
      },
    ]),
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/credits/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pack_id: "starter" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 409);
  assertEquals(await res.json(), {
    error: "Plus subscription is active; cancel it before switching to Pro",
    code: "CONFLICT",
  });
});

Deno.test("billing plan management routes - POST /api/billing/credits/checkout uses the selected top-up pack", async () => {
  providerMock = newProviderMock();
  dbMocks.getDb = (() => ({})) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    planId: "plan_free",
    providerSubscriptionId: null,
    providerCustomerId: "cus_1",
  })) as any;
  const topupSpy = spy(async (_input: CreateCheckoutInput) => ({
    url: "https://stripe.test/topup",
    sessionId: "cs_topup",
  }));
  providerMock.createCheckoutSession = topupSpy as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
      {
        id: "starter",
        label: "Starter",
        price_id: "price_starter",
        credits_cents: 2500,
        featured: true,
      },
      {
        id: "team",
        label: "Team",
        price_id: "price_team",
        credits_cents: 10000,
        featured: false,
      },
    ]),
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/credits/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pack_id: "team" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const topupCall = topupSpy.calls[0]?.args[0];
  assertEquals(topupCall?.providerPriceId, "price_team");
  assertEquals(topupCall?.mode, "one_time");
  assertEquals(topupCall?.metadata, {
    purchase_kind: "pro_topup",
    pack_id: "team",
  });
});

Deno.test("billing plan management routes - POST /api/billing/credits/checkout rejects unknown pack ids", async () => {
  providerMock = newProviderMock();
  dbMocks.getDb = (() => ({})) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    planId: "plan_free",
    providerSubscriptionId: null,
    providerCustomerId: null,
  })) as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
      {
        id: "starter",
        label: "Starter",
        price_id: "price_starter",
        credits_cents: 2500,
        featured: true,
      },
    ]),
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/credits/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pack_id: "missing" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
  assertEquals(await res.json(), {
    error: "Top-up pack not found",
    code: "NOT_FOUND",
  });
});

Deno.test("billing plan management routes - webhook checkout_completed upgrades plus subscriptions without credits", async () => {
  providerMock = newProviderMock();
  const setCalls: unknown[] = [];
  const createDrizzleDbMock = () => {
    let firstSelect = true;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            // First select: stripe_webhook_events idempotency lookup → row.status = 'received'
            // Subsequent selects: billing_accounts lookup → null (account looked up by user id elsewhere)
            get: async () => {
              if (firstSelect) {
                firstSelect = false;
                return { status: "received" };
              }
              return null;
            },
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => undefined,
        }),
      }),
      update: () => ({
        set: (data: unknown) => {
          // Capture the billing_accounts update; ignore the
          // stripe_webhook_events status update.
          if ((data as Record<string, unknown>).planId !== undefined) {
            setCalls.push(data);
          }
          return {
            where: async () => undefined,
          };
        },
      }),
    };
  };
  dbMocks.getDb = (() => createDrizzleDbMock()) as any;

  providerMock.parseWebhook = (async () => ({
    kind: "checkout_completed",
    eventId: "evt_plus_1",
    session: {
      sessionId: "cs_1",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      mode: "subscription",
      paymentStatus: null,
      metadata: {
        user_id: "user-1",
        purchase_kind: "plus_subscription",
      },
    },
  } as BillingWebhookEvent)) as any;
  providerMock.retrieveCheckoutSession = (async () => ({
    sessionId: "cs_1",
    customerId: "cus_1",
    subscriptionId: "sub_1",
    mode: "subscription",
    paymentStatus: null,
    metadata: {
      user_id: "user-1",
      purchase_kind: "plus_subscription",
    },
  } as CompletedCheckoutSession)) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    id: "acct-1",
    planId: "plan_free",
    providerName: "stripe",
    providerCustomerId: null,
    providerSubscriptionId: null,
  })) as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(setCalls.length, 1);
  const plusUpdate = setCalls[0] as Record<string, unknown>;
  assertEquals(plusUpdate.planId, "plan_plus");
  assertEquals(plusUpdate.providerCustomerId, "cus_1");
  assertEquals(plusUpdate.providerSubscriptionId, "sub_1");
  assertEquals(plusUpdate.providerName, "stripe");
  assertEquals(typeof plusUpdate.subscriptionStartedAt, "string");
  assertEquals(plusUpdate.subscriptionPeriodEnd, null);
  assertEquals(typeof plusUpdate.updatedAt, "string");
  assertSpyCalls(billingMocks.addCredits, 0);
});

Deno.test("billing plan management routes - webhook checkout_completed tops up pro credits and switches to payg", async () => {
  providerMock = newProviderMock();
  const setCalls: unknown[] = [];
  const createDrizzleDbMock = () => {
    let firstSelect = true;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => {
              if (firstSelect) {
                firstSelect = false;
                return { status: "received" };
              }
              return null;
            },
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => undefined,
        }),
      }),
      update: () => ({
        set: (data: unknown) => {
          if ((data as Record<string, unknown>).planId !== undefined) {
            setCalls.push(data);
          }
          return {
            where: async () => undefined,
          };
        },
      }),
    };
  };
  dbMocks.getDb = (() => createDrizzleDbMock()) as any;

  providerMock.parseWebhook = (async () => ({
    kind: "checkout_completed",
    eventId: "evt_topup_1",
    session: {
      sessionId: "cs_2",
      customerId: "cus_1",
      subscriptionId: null,
      mode: "one_time",
      paymentStatus: "paid",
      metadata: {
        user_id: "user-1",
        purchase_kind: "pro_topup",
        pack_id: "starter",
      },
    },
  } as BillingWebhookEvent)) as any;
  providerMock.retrieveCheckoutSession = (async () => ({
    sessionId: "cs_2",
    customerId: "cus_1",
    subscriptionId: null,
    mode: "one_time",
    paymentStatus: "paid",
    metadata: {
      user_id: "user-1",
      purchase_kind: "pro_topup",
      pack_id: "starter",
    },
  } as CompletedCheckoutSession)) as any;
  billingMocks.getOrCreateBillingAccount = (async () => ({
    id: "acct-1",
    planId: "plan_free",
    providerName: "stripe",
    providerCustomerId: null,
    providerSubscriptionId: null,
  })) as any;
  // Reset addCredits spy
  billingMocks.addCredits = spy((..._args: any[]) => undefined) as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
      {
        id: "starter",
        label: "Starter",
        price_id: "price_starter",
        credits_cents: 2500,
        featured: true,
      },
    ]),
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(setCalls.length, 1);
  const topupUpdate = setCalls[0] as Record<string, unknown>;
  assertEquals(topupUpdate.planId, "plan_payg");
  assertEquals(topupUpdate.providerCustomerId, "cus_1");
  assertEquals(topupUpdate.providerName, "stripe");
  assertEquals(typeof topupUpdate.updatedAt, "string");
  assertEquals(
    billingMocks.addCredits.calls[0]?.args.slice(1),
    [
      "acct-1",
      2500,
      "Pro top-up credit (starter, 2500¢)",
    ],
  );
});

Deno.test("billing plan management routes - subscription cancellation falls back to payg when balance remains", async () => {
  providerMock = newProviderMock();
  const setCalls: unknown[] = [];
  // The webhook handler calls getDb twice (once for idempotency dedup, once
  // for the account lookup). The mock must persist `selectCount` across both
  // calls, so we instantiate it once and reuse it.
  let selectCount = 0;
  const drizzleMock = {
    select: () => ({
      from: () => ({
        where: () => ({
          get: async () => {
            selectCount++;
            // First select hits stripe_webhook_events for idempotency dedup.
            if (selectCount === 1) return { status: "received" };
            // Subsequent selects hit billing_accounts.
            return {
              id: "acct-1",
              balanceCents: 120,
              providerCustomerId: "cus_1",
            };
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
      }),
    }),
    update: () => ({
      set: (data: unknown) => {
        if ((data as Record<string, unknown>).planId !== undefined) {
          setCalls.push(data);
        }
        return {
          where: async () => undefined,
        };
      },
    }),
  };
  dbMocks.getDb = (() => drizzleMock) as any;

  providerMock.parseWebhook = (async () => ({
    kind: "subscription_canceled",
    eventId: "evt_cancel_1",
    customerId: "cus_1",
  } as BillingWebhookEvent)) as any;
  syncBillingRouteDeps();

  const app = createApp(createUser());
  const env = createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  }) as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(setCalls.length, 1);
  const deletionUpdate = setCalls[0] as Record<string, unknown>;
  assertEquals(deletionUpdate.planId, "plan_payg");
  assertEquals(deletionUpdate.providerSubscriptionId, null);
  assertEquals(deletionUpdate.subscriptionStartedAt, null);
  assertEquals(deletionUpdate.subscriptionPeriodEnd, null);
  assertEquals(typeof deletionUpdate.updatedAt, "string");
});

Deno.test("billing plan management routes - parses configured top-up packs from JSON config", () => {
  const packs = getConfiguredProTopupPacks(createMockEnv({
    STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
      {
        id: "starter",
        label: "Starter",
        price_id: "price_starter",
        credits_cents: 2500,
        featured: true,
        badge: "Popular",
      },
    ]),
  }) as unknown as Env);

  assertEquals(packs, [
    {
      id: "starter",
      label: "Starter",
      priceId: "price_starter",
      creditsCents: 2500,
      featured: true,
      badge: "Popular",
    },
  ]);
});

Deno.test("billing plan management routes - rejects invalid pack catalogs", () => {
  assertThrows(
    () =>
      getConfiguredProTopupPacks(createMockEnv({
        STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([]),
      }) as unknown as Env),
    Error,
    "STRIPE_PRO_TOPUP_PACKS_JSON must be a non-empty array",
  );

  assertThrows(
    () =>
      getConfiguredProTopupPacks(createMockEnv({
        STRIPE_PRO_TOPUP_PACKS_JSON: JSON.stringify([
          {
            id: "starter",
            label: "Starter",
            price_id: "",
            credits_cents: 2500,
            featured: true,
          },
        ]),
      }) as unknown as Env),
    Error,
    'Top-up pack "starter" is missing price_id',
  );
});
