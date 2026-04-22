import type { Env } from "@/types";

import { assertEquals } from "jsr:@std/assert";
import { Hono } from "hono";
import { isAppError } from "takos-common/errors";

import { billingWebhookHandler } from "@/server/routes/billing/routes.ts";
import { createMockEnv } from "./setup.ts";

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    ...overrides,
  }) as unknown as Env;
}

Deno.test("billing webhook returns 500 when webhook configuration is missing", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.route("/", billingWebhookHandler);

  const response = await app.fetch(
    new Request("https://takos.jp/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt_1" }),
    }),
    createEnv({
      STRIPE_SECRET_KEY: undefined,
      STRIPE_WEBHOOK_SECRET: undefined,
    }),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Webhook not configured",
    },
  });
});

Deno.test("billing webhook returns 400 when the Stripe signature is missing", async () => {
  const app = new Hono<{ Bindings: Env }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.route("/", billingWebhookHandler);

  const response = await app.fetch(
    new Request("https://takos.jp/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt_1" }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: {
      code: "BAD_REQUEST",
      message: "Missing signature",
    },
  });
});
