import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type {
  BillingWebhookEvent,
  CheckoutSessionResult,
  CompletedCheckoutSession,
  ListInvoicesInput,
  NormalizedInvoice,
  PaymentProvider,
} from "@/services/billing/billing";

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

interface ProviderMock {
  createCheckoutSession: (input: unknown) => Promise<CheckoutSessionResult>;
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
  billingRouteDeps.resolvePaymentProvider = (() =>
    ({ name: "stripe", ...providerMock }) as PaymentProvider) as any;
}

Deno.test("billing invoices API - GET /api/billing/invoices returns 500 when Stripe is not configured", async () => {
  providerMock = newProviderMock();
  // Simulate provider factory failing because STRIPE_SECRET_KEY is missing.
  billingRouteDeps.resolvePaymentProvider = (() => {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }) as any;

  const user = createUser();
  const app = createBillingApp(user);
  const env = createMockEnv() as unknown as Env;

  const res = await app.fetch(
    new Request("http://localhost/api/billing/invoices"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals((body as { code: string }).code, "INTERNAL_ERROR");
});

Deno.test("billing invoices API - GET /api/billing/invoices returns 400 when user has no payment account", async () => {
  providerMock = newProviderMock();
  billingMocks.getOrCreateBillingAccount = (async () => ({
    providerCustomerId: null,
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
    error: "No payment account found",
    code: "BAD_REQUEST",
  });
});

Deno.test("billing invoices API - GET /api/billing/invoices returns invoices list", async () => {
  providerMock = newProviderMock();
  billingMocks.getOrCreateBillingAccount = (async () => ({
    providerCustomerId: "cus_123",
  })) as any;
  const listInvoicesSpy = spy(async (_input: ListInvoicesInput) => ({
    invoices: [
      {
        id: "in_1",
        customerId: "cus_123",
        number: "A-1",
        status: "paid",
        currency: "jpy",
        amountDueCents: 100,
        amountPaidCents: 100,
        totalCents: 100,
        createdUnix: 123,
        periodStartUnix: 1,
        periodEndUnix: 2,
        hostedUrl: "https://example.com/hosted",
        pdfUrl: "https://example.com/pdf",
      } as NormalizedInvoice,
    ],
    hasMore: false,
  }));
  providerMock.listInvoices = listInvoicesSpy as any;
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
  const listCall = listInvoicesSpy.calls[0]?.args[0];
  assertEquals(listCall?.customerId, "cus_123");
  assertEquals(listCall?.limit, 10);
});

Deno.test("billing invoices API - GET /api/billing/invoices/:id/pdf returns 404 when invoice is not owned by customer", async () => {
  providerMock = newProviderMock();
  billingMocks.getOrCreateBillingAccount = (async () => ({
    providerCustomerId: "cus_123",
  })) as any;
  providerMock.retrieveInvoice = (async () => ({
    id: "in_1",
    customerId: "cus_other",
    number: null,
    status: null,
    currency: null,
    amountDueCents: null,
    amountPaidCents: null,
    totalCents: null,
    createdUnix: null,
    periodStartUnix: null,
    periodEndUnix: null,
    hostedUrl: null,
    pdfUrl: "https://example.com/pdf",
  } as NormalizedInvoice)) as any;
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
});

Deno.test("billing invoices API - GET /api/billing/invoices/:id/pdf streams the invoice PDF", async () => {
  providerMock = newProviderMock();
  billingMocks.getOrCreateBillingAccount = (async () => ({
    providerCustomerId: "cus_123",
  })) as any;
  providerMock.retrieveInvoice = (async () => ({
    id: "in_1",
    customerId: "cus_123",
    number: null,
    status: null,
    currency: null,
    amountDueCents: null,
    amountPaidCents: null,
    totalCents: null,
    createdUnix: null,
    periodStartUnix: null,
    periodEndUnix: null,
    hostedUrl: null,
    pdfUrl: "https://files.stripe.com/pdf/in_1",
  } as NormalizedInvoice)) as any;
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
    'attachment; filename="invoice-in_1.pdf"',
  );
  assertEquals(await res.text(), "PDFDATA");
});

Deno.test("billing invoices API - POST /api/billing/invoices/:id/send returns success", async () => {
  providerMock = newProviderMock();
  billingMocks.getOrCreateBillingAccount = (async () => ({
    providerCustomerId: "cus_123",
  })) as any;
  providerMock.retrieveInvoice = (async () => ({
    id: "in_1",
    customerId: "cus_123",
    number: null,
    status: null,
    currency: null,
    amountDueCents: null,
    amountPaidCents: null,
    totalCents: null,
    createdUnix: null,
    periodStartUnix: null,
    periodEndUnix: null,
    hostedUrl: null,
    pdfUrl: "https://files.stripe.com/pdf/in_1",
  } as NormalizedInvoice)) as any;
  const sendInvoiceSpy = spy(async (_invoiceId: string) => undefined);
  providerMock.sendInvoice = sendInvoiceSpy as any;
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
  assertEquals(sendInvoiceSpy.calls[0]?.args[0], "in_1");
});
