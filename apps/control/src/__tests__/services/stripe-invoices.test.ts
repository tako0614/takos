import {
  listInvoices,
  retrieveInvoice,
  sendInvoice,
} from "@/services/billing/stripe";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, spy } from "jsr:@std/testing/mock";

Deno.test("stripe invoice helpers - listInvoices calls Stripe API with customer and limit", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "in_1", customer: "cus_1" }],
          has_more: false,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    );
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    const result = await listInvoices({
      secretKey: "sk_test",
      customerId: "cus_1",
      limit: 10,
    });

    assertEquals(result, {
      invoices: [{ id: "in_1", customer: "cus_1" }],
      has_more: false,
    });
    assertSpyCallArgs(fetchMock, 0, [
      "https://api.stripe.com/v1/invoices?customer=cus_1&limit=10",
      {
        headers: {
          Authorization: "Bearer sk_test",
        },
      },
    ]);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("stripe invoice helpers - retrieveInvoice calls Stripe API", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(JSON.stringify({ id: "in_1", customer: "cus_1" }), {
        status: 200,
      })
    );
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    await assertEquals(
      await retrieveInvoice({ secretKey: "sk_test", invoiceId: "in_1" }),
      { id: "in_1", customer: "cus_1" },
    );

    assertSpyCallArgs(fetchMock, 0, [
      "https://api.stripe.com/v1/invoices/in_1",
      {
        headers: {
          Authorization: "Bearer sk_test",
        },
      },
    ]);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("stripe invoice helpers - sendInvoice posts to Stripe send endpoint", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(JSON.stringify({ id: "in_1", customer: "cus_1" }), {
        status: 200,
      })
    );
    (globalThis as any).fetch = fetchMock as unknown as typeof fetch;

    await assertEquals(
      await sendInvoice({ secretKey: "sk_test", invoiceId: "in_1" }),
      { id: "in_1", customer: "cus_1" },
    );

    assertSpyCallArgs(fetchMock, 0, [
      "https://api.stripe.com/v1/invoices/in_1/send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer sk_test",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "",
      },
    ]);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
