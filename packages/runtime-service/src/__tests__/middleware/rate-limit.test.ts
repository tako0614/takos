import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import { createRateLimiter } from "../../middleware/rate-limit.ts";

type RateLimitMiddleware = ReturnType<typeof createRateLimiter> & {
  dispose?: () => void;
};

Deno.test(
  "createRateLimiter maxKeys saturation - fails closed when the key store is saturated",
  async () => {
    const limiter = createRateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
      maxKeys: 1,
      keyFn: (c) => c.req.header("x-rate-key") || "unknown",
    }) as RateLimitMiddleware;

    const app = new Hono();
    app.use(limiter);
    app.get("/", (c) => c.json({ ok: true }));

    try {
      const first = await app.request("/", {
        headers: { "x-rate-key": "key-1" },
      });
      assertEquals(first.status, 200);

      const second = await app.request("/", {
        headers: { "x-rate-key": "key-2" },
      });
      assertEquals(second.status, 429);
      assertEquals(await second.json(), {
        error: "Rate limiter capacity reached. Please try again later.",
        retry_after_seconds: 60,
      });
      assertEquals(second.headers.get("retry-after"), "60");
    } finally {
      limiter.dispose?.();
    }
  },
);
