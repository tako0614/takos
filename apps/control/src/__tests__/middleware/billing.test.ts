import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assertEquals } from "jsr:@std/assert";
import { billingGate, billingMiddlewareDeps } from "@/middleware/billing";

const originalBillingDeps = { ...billingMiddlewareDeps };

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
    created_at: "2026-02-11T00:00:00.000Z",
    updated_at: "2026-02-11T00:00:00.000Z",
  };
}

Deno.test("billingGate - fails closed with 503 when quota check throws", async () => {
  billingMiddlewareDeps.checkBillingQuota = (async () => {
    throw new Error("db unavailable");
  }) as typeof billingMiddlewareDeps.checkBillingQuota;

  try {
    const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
    installAppErrorHandler(app);
    app.use("/metered", async (c, next) => {
      c.set("user", createUser());
      await next();
    });
    app.use("/metered", billingGate("llm_tokens_input", 1));
    app.post("/metered", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/metered", { method: "POST" }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 503);
    // Common error envelope: { error: { code, message } }
    await assertEquals(await res.json(), {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Billing unavailable",
      },
    });
  } finally {
    Object.assign(billingMiddlewareDeps, originalBillingDeps);
  }
});
