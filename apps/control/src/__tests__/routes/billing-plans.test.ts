import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

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

const stripeMocks = {
  createCheckoutSession: ((..._args: any[]) => undefined) as any,
  createPortalSession: ((..._args: any[]) => undefined) as any,
  verifyWebhookSignature: ((..._args: any[]) => undefined) as any,
  retrieveCheckoutSession: ((..._args: any[]) => undefined) as any,
  listInvoices: ((..._args: any[]) => undefined) as any,
  retrieveInvoice: ((..._args: any[]) => undefined) as any,
  sendInvoice: ((..._args: any[]) => undefined) as any,
};

const dbMocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/billing/billing'
// [Deno] vi.mock removed - manually stub imports from '@/services/billing/stripe'
// [Deno] vi.mock removed - manually stub imports from '@/db'
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
  billingRouteDeps.createCheckoutSession = stripeMocks.createCheckoutSession;
  billingRouteDeps.createPortalSession = stripeMocks.createPortalSession;
  billingRouteDeps.verifyWebhookSignature = stripeMocks.verifyWebhookSignature;
  billingRouteDeps.retrieveCheckoutSession =
    stripeMocks.retrieveCheckoutSession;
  billingRouteDeps.listInvoices = stripeMocks.listInvoices;
  billingRouteDeps.retrieveInvoice = stripeMocks.retrieveInvoice;
  billingRouteDeps.sendInvoice = stripeMocks.sendInvoice;
}

Deno.test("billing plan management routes - GET /api/billing returns billing mode and available actions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
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
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: null,
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
          price_id: "price_starter",
          credits_cents: 2500,
          featured: true,
          badge: "Popular",
        },
      ],
      balance_cents: 420,
      status: "active",
      has_stripe_customer: true,
      has_subscription: false,
      subscription_period_end: null,
      runtime_limit_7d_seconds: 18_000,
    });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - POST /api/billing/subscribe uses the plus subscription price", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: null,
    })) as any;
    stripeMocks.createCheckoutSession = spy(async () => ({
      url: "https://stripe.test/checkout",
      sessionId: "cs_1",
    })) as any;
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
    const checkoutCall = stripeMocks.createCheckoutSession.calls[0]?.args[0];
    assertEquals(checkoutCall.priceId, "price_plus");
    assertEquals(checkoutCall.mode, "subscription");
    assertEquals(checkoutCall.metadata, { purchase_kind: "plus_subscription" });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - POST /api/billing/credits/checkout rejects when plus is active", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      planId: "plan_plus",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
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
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - POST /api/billing/credits/checkout uses the selected top-up pack", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      planId: "plan_free",
      stripeSubscriptionId: null,
      stripeCustomerId: "cus_1",
    })) as any;
    stripeMocks.createCheckoutSession = spy(async () => ({
      url: "https://stripe.test/topup",
      sessionId: "cs_topup",
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
    const topupCall = stripeMocks.createCheckoutSession.calls[0]?.args[0];
    assertEquals(topupCall.priceId, "price_team");
    assertEquals(topupCall.mode, "payment");
    assertEquals(topupCall.metadata, {
      purchase_kind: "pro_topup",
      pack_id: "team",
    });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - POST /api/billing/credits/checkout rejects unknown pack ids", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      planId: "plan_free",
      stripeSubscriptionId: null,
      stripeCustomerId: null,
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
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - webhook checkout.session.completed upgrades plus subscriptions without credits", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    const setCalls: unknown[] = [];
    const createDrizzleDbMock = () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => null,
          }),
        }),
      }),
      update: () => ({
        set: (data: unknown) => {
          setCalls.push(data);
          return {
            where: async () => undefined,
          };
        },
      }),
    });
    dbMocks.getDb = (() => createDrizzleDbMock()) as any;
    stripeMocks.verifyWebhookSignature = (async () => ({
      event: {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            customer: "cus_1",
            subscription: "sub_1",
            metadata: {
              user_id: "user-1",
              purchase_kind: "plus_subscription",
            },
          },
        },
      },
    })) as any;
    stripeMocks.retrieveCheckoutSession = (async () => ({
      id: "cs_1",
      customer: "cus_1",
      subscription: "sub_1",
      mode: "subscription",
      metadata: {
        user_id: "user-1",
        purchase_kind: "plus_subscription",
      },
    })) as any;
    billingMocks.getOrCreateBillingAccount = (async () => ({
      id: "acct-1",
      planId: "plan_free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
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
    assertEquals(plusUpdate.stripeCustomerId, "cus_1");
    assertEquals(plusUpdate.stripeSubscriptionId, "sub_1");
    assertEquals(typeof plusUpdate.subscriptionStartedAt, "string");
    assertEquals(plusUpdate.subscriptionPeriodEnd, null);
    assertEquals(typeof plusUpdate.updatedAt, "string");
    assertSpyCalls(billingMocks.addCredits, 0);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - webhook checkout.session.completed tops up pro credits and switches to payg", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    const setCalls: unknown[] = [];
    const createDrizzleDbMock = () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => null,
          }),
        }),
      }),
      update: () => ({
        set: (data: unknown) => {
          setCalls.push(data);
          return {
            where: async () => undefined,
          };
        },
      }),
    });
    dbMocks.getDb = (() => createDrizzleDbMock()) as any;
    stripeMocks.verifyWebhookSignature = (async () => ({
      event: {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_2",
            customer: "cus_1",
            subscription: null,
            payment_status: "paid",
            metadata: {
              user_id: "user-1",
              purchase_kind: "pro_topup",
              pack_id: "starter",
            },
          },
        },
      },
    })) as any;
    stripeMocks.retrieveCheckoutSession = (async () => ({
      id: "cs_2",
      customer: "cus_1",
      subscription: null,
      payment_status: "paid",
      mode: "payment",
      metadata: {
        user_id: "user-1",
        purchase_kind: "pro_topup",
        pack_id: "starter",
      },
    })) as any;
    billingMocks.getOrCreateBillingAccount = (async () => ({
      id: "acct-1",
      planId: "plan_free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })) as any;
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
    assertEquals(topupUpdate.stripeCustomerId, "cus_1");
    assertEquals(typeof topupUpdate.updatedAt, "string");
    assertEquals(
      billingMocks.addCredits.calls[0]?.args.slice(1),
      [
        "acct-1",
        2500,
        "Pro top-up credit (starter, 2500¢)",
      ],
    );
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - subscription deletion falls back to payg when balance remains", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  try {
    const setCalls: unknown[] = [];
    const createDrizzleDbMock = () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => ({
              id: "acct-1",
              balanceCents: 120,
              stripeCustomerId: "cus_1",
            }),
          }),
        }),
      }),
      update: () => ({
        set: (data: unknown) => {
          setCalls.push(data);
          return {
            where: async () => undefined,
          };
        },
      }),
    });
    dbMocks.getDb = (() => createDrizzleDbMock()) as any;
    stripeMocks.verifyWebhookSignature = (async () => ({
      event: {
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "canceled",
          },
        },
      },
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
    const deletionUpdate = setCalls[0] as Record<string, unknown>;
    assertEquals(deletionUpdate.planId, "plan_payg");
    assertEquals(deletionUpdate.stripeSubscriptionId, null);
    assertEquals(deletionUpdate.subscriptionStartedAt, null);
    assertEquals(deletionUpdate.subscriptionPeriodEnd, null);
    assertEquals(typeof deletionUpdate.updatedAt, "string");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - parses configured top-up packs from JSON config", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  syncBillingRouteDeps();
  try {
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
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing plan management routes - rejects invalid pack catalogs", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  dbMocks.getDb = (() => ({
    billingAccount: {
      update: async () => undefined,
      findFirst: async () => null,
    },
  })) as any;
  syncBillingRouteDeps();
  try {
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
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
