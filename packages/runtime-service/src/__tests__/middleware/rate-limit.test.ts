import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import {
  createRateLimiter,
  RUNTIME_REMOTE_ADDR_BINDING,
} from "../../middleware/rate-limit.ts";

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
      // Common error envelope: { error: { code, message, details } }
      assertEquals(await second.json(), {
        error: {
          code: "RATE_LIMITED",
          message: "Rate limiter capacity reached. Please try again later.",
          details: { retryAfter: 60 },
        },
      });
      assertEquals(second.headers.get("retry-after"), "60");
    } finally {
      limiter.dispose?.();
    }
  },
);

Deno.test(
  "createRateLimiter default key ignores spoofed forwarding headers",
  async () => {
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
    }) as RateLimitMiddleware;

    const app = new Hono();
    app.use(limiter);
    app.get("/", (c) => c.json({ ok: true }));

    try {
      const env = { [RUNTIME_REMOTE_ADDR_BINDING]: "10.0.0.2" };
      const first = await app.request("/", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      }, env);
      assertEquals(first.status, 200);

      const second = await app.request("/", {
        headers: { "x-forwarded-for": "198.51.100.2" },
      }, env);
      assertEquals(second.status, 429);
    } finally {
      limiter.dispose?.();
    }
  },
);

Deno.test(
  "createRateLimiter uses forwarding headers only when trusted proxy headers are enabled",
  async () => {
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      trustProxyHeaders: true,
    }) as RateLimitMiddleware;

    const app = new Hono();
    app.use(limiter);
    app.get("/", (c) => c.json({ ok: true }));

    try {
      const env = { [RUNTIME_REMOTE_ADDR_BINDING]: "10.0.0.2" };
      const first = await app.request("/", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      }, env);
      assertEquals(first.status, 200);

      const second = await app.request("/", {
        headers: { "x-forwarded-for": "198.51.100.2" },
      }, env);
      assertEquals(second.status, 200);

      const repeated = await app.request("/", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      }, env);
      assertEquals(repeated.status, 429);
    } finally {
      limiter.dispose?.();
    }
  },
);
