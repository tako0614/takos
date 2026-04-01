import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

const billingMocks = {
  getOrCreateBillingAccount: ((..._args: any[]) => undefined) as any,
  addCredits: ((..._args: any[]) => undefined) as any,
  assignPlanToUser: ((..._args: any[]) => undefined) as any,
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

// [Deno] vi.mock removed - manually stub imports from '@/services/billing/billing'
// [Deno] vi.mock removed - manually stub imports from '@/services/billing/stripe'
import billingRoutes, { billingRouteDeps } from "@/routes/billing/routes";

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

function createBillingApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use("*", async (c, next) => {
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
  return app;
}

function syncBillingRouteDeps() {
  billingRouteDeps.getOrCreateBillingAccount =
    billingMocks.getOrCreateBillingAccount;
  billingRouteDeps.addCredits = billingMocks.addCredits;
  billingRouteDeps.assertBillingPlanId = billingMocks
    .assertBillingPlanId as any;
  billingRouteDeps.resolveBillingMode = billingMocks.resolveBillingMode as any;
  billingRouteDeps.resolveBillingPlanTier = billingMocks
    .resolveBillingPlanTier as any;
  billingRouteDeps.createCheckoutSession = stripeMocks.createCheckoutSession;
  billingRouteDeps.createPortalSession = stripeMocks.createPortalSession;
  billingRouteDeps.verifyWebhookSignature = stripeMocks.verifyWebhookSignature;
  billingRouteDeps.retrieveCheckoutSession =
    stripeMocks.retrieveCheckoutSession;
  billingRouteDeps.listInvoices = stripeMocks.listInvoices;
  billingRouteDeps.retrieveInvoice = stripeMocks.retrieveInvoice;
  billingRouteDeps.sendInvoice = stripeMocks.sendInvoice;
}

Deno.test("billing invoices API - GET /api/billing/invoices returns 500 when Stripe is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
    syncBillingRouteDeps();
    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv() as unknown as Env;

    const res = await app.fetch(
      new Request("http://localhost/api/billing/invoices"),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 500);
    assertEquals(await res.json(), {
      error: "Billing not configured",
      code: "INTERNAL_ERROR",
    });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing invoices API - GET /api/billing/invoices returns 400 when user has no Stripe customer", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      stripeCustomerId: null,
    })) as any;
    syncBillingRouteDeps();
    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: "sk_test",
    }) as unknown as Env;

    const res = await app.fetch(
      new Request("http://localhost/api/billing/invoices"),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 400);
    assertEquals(await res.json(), {
      error: "No Stripe customer found",
      code: "BAD_REQUEST",
    });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing invoices API - GET /api/billing/invoices returns invoices list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      stripeCustomerId: "cus_123",
    })) as any;
    stripeMocks.listInvoices = spy(async () => ({
      invoices: [
        {
          id: "in_1",
          number: "A-1",
          status: "paid",
          currency: "jpy",
          amount_due: 100,
          amount_paid: 100,
          total: 100,
          created: 123,
          period_start: 1,
          period_end: 2,
          hosted_invoice_url: "https://example.com/hosted",
          invoice_pdf: "https://example.com/pdf",
        },
      ],
      has_more: false,
    })) as any;
    syncBillingRouteDeps();
    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: "sk_test",
    }) as unknown as Env;

    const res = await app.fetch(
      new Request("http://localhost/api/billing/invoices?limit=10"),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      invoices: [
        {
          id: "in_1",
          number: "A-1",
          status: "paid",
          currency: "jpy",
          amount_due: 100,
          amount_paid: 100,
          total: 100,
          created: 123,
          period_start: 1,
          period_end: 2,
          hosted_invoice_url: "https://example.com/hosted",
          invoice_pdf: "https://example.com/pdf",
        },
      ],
      has_more: false,
    });
    const listInvoicesCall = stripeMocks.listInvoices.calls[0]?.args[0];
    assertEquals(listInvoicesCall.customerId, "cus_123");
    assertEquals(listInvoicesCall.limit, 10);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing invoices API - GET /api/billing/invoices/:id/pdf returns 404 when invoice is not owned by customer", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      stripeCustomerId: "cus_123",
    })) as any;
    stripeMocks.retrieveInvoice = (async () => ({
      id: "in_1",
      customer: "cus_other",
      invoice_pdf: "https://example.com/pdf",
    })) as any;
    syncBillingRouteDeps();
    const fetchMock = spy(async () => new Response("PDF", { status: 200 }));
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: "sk_test",
    }) as unknown as Env;

    const res = await app.fetch(
      new Request("http://localhost/api/billing/invoices/in_1/pdf"),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 404);
    assertEquals(await res.json(), {
      error: "Invoice not found",
      code: "NOT_FOUND",
    });
    assertSpyCalls(fetchMock, 0);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing invoices API - GET /api/billing/invoices/:id/pdf streams the invoice PDF", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      stripeCustomerId: "cus_123",
    })) as any;
    stripeMocks.retrieveInvoice = (async () => ({
      id: "in_1",
      customer: "cus_123",
      invoice_pdf: "https://files.stripe.com/pdf/in_1",
    })) as any;
    syncBillingRouteDeps();
    const fetchMock = spy(async () =>
      new Response("PDFDATA", {
        status: 200,
        headers: { "content-length": "7" },
      })
    );
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: "sk_test",
    }) as unknown as Env;

    const res = await app.fetch(
      new Request("http://localhost/api/billing/invoices/in_1/pdf"),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/pdf");
    assertEquals(
      res.headers.get("content-disposition"),
      'attachment; filename="stripe-invoice-in_1.pdf"',
    );
    assertEquals(await res.text(), "PDFDATA");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("billing invoices API - POST /api/billing/invoices/:id/send returns success", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
    billingMocks.getOrCreateBillingAccount = (async () => ({
      stripeCustomerId: "cus_123",
    })) as any;
    stripeMocks.retrieveInvoice = (async () => ({
      id: "in_1",
      customer: "cus_123",
      invoice_pdf: "https://files.stripe.com/pdf/in_1",
    })) as any;
    stripeMocks.sendInvoice = spy(async () => ({
      id: "in_1",
      customer: "cus_123",
    })) as any;
    syncBillingRouteDeps();

    const user = createUser();
    const app = createBillingApp(user);
    const env = createMockEnv({
      STRIPE_SECRET_KEY: "sk_test",
    }) as unknown as Env;

    const res = await app.fetch(
      new Request("http://localhost/api/billing/invoices/in_1/send", {
        method: "POST",
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), { success: true });
    assertEquals(stripeMocks.sendInvoice.calls[0]?.args[0], {
      secretKey: "sk_test",
      invoiceId: "in_1",
    });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
