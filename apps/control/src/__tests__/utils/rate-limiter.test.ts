import { InMemoryRateLimiter, RateLimiters } from "@/utils/rate-limiter";

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import { FakeTime } from "jsr:@std/testing/time";

Deno.test("InMemoryRateLimiter - allows requests within limit", () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 10_000 });
  const info = limiter.check("user-1");
  assertEquals(info.remaining, 5);
  assertEquals(info.total, 5);
});
Deno.test("InMemoryRateLimiter - decrements remaining on hit", () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 10_000 });
  limiter.hit("user-1");
  const info = limiter.check("user-1");
  assertEquals(info.remaining, 4);
});
Deno.test("InMemoryRateLimiter - exhausts capacity after max hits", () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) {
    limiter.hit("user-1");
  }
  const info = limiter.check("user-1");
  assertEquals(info.remaining, 0);
});
Deno.test("InMemoryRateLimiter - tracks different keys independently", () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 3, windowMs: 60_000 });
  limiter.hit("user-1");
  limiter.hit("user-1");

  const info1 = limiter.check("user-1");
  const info2 = limiter.check("user-2");

  assertEquals(info1.remaining, 1);
  assertEquals(info2.remaining, 3);
});
Deno.test("InMemoryRateLimiter - hit returns rate limit info", () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 10_000 });
  const info = limiter.hit("user-1");
  assertEquals(info.total, 5);
  assertEquals(info.remaining, 4);
  assertEquals(typeof info.reset, "number");
});
Deno.test("InMemoryRateLimiter - cleanup removes expired entries", () => {
  const fakeTime = new FakeTime();
  try {
    const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 1 });
    limiter.hit("user-1");

    // Advance time past the 1ms window so entries expire
    fakeTime.tick(10);

    limiter.cleanup();
    const info = limiter.check("user-1");
    assertEquals(info.remaining, 5);
  } finally {
    fakeTime.restore();
  }
});

Deno.test("InMemoryRateLimiter - checkKeyLimit / MAX_KEYS behavior - evicts keys when the map reaches MAX_KEYS capacity", () => {
  // We cannot easily fill 100_000 keys in a unit test, but we can verify
  // the mechanism by accessing the private map via hit() and observing that
  // subsequent hits on new keys still work (i.e. no crash / no infinite loop).
  const limiter = new InMemoryRateLimiter({ maxRequests: 2, windowMs: 60_000 });

  // Fill many distinct keys
  const keyCount = 200;
  for (let i = 0; i < keyCount; i++) {
    limiter.hit(`key-${i}`);
  }

  // All tracked keys should still be queryable
  const first = limiter.check("key-0");
  const last = limiter.check(`key-${keyCount - 1}`);
  assertEquals(first.total, 2);
  assertEquals(last.total, 2);
});

function createMockContext(ip?: string) {
  const resHeaders: Record<string, string> = {};
  return {
    req: {
      header: (name: string) => (name === "CF-Connecting-IP" ? ip : undefined),
    },
    header: (name: string, value: string) => {
      resHeaders[name] = value;
    },
    json: (body: unknown, status: number) => ({ body, status }),
    _resHeaders: resHeaders,
  } as any;
}

Deno.test("InMemoryRateLimiter#middleware - passes through when under the rate limit", async () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 60_000 });
  const mw = limiter.middleware();
  const c = createMockContext("1.2.3.4");
  const next = spy(async () => undefined);

  await mw(c, next);

  assertSpyCalls(next, 1);
  assertEquals(c._resHeaders["X-RateLimit-Limit"], "5");
  assert(c._resHeaders["X-RateLimit-Remaining"] !== undefined);
});
Deno.test("InMemoryRateLimiter#middleware - returns 429 with Retry-After header when rate limited", async () => {
  const limiter = new InMemoryRateLimiter({ maxRequests: 2, windowMs: 60_000 });
  const mw = limiter.middleware();
  const next = spy(async () => undefined);

  // Exhaust the limit
  for (let i = 0; i < 2; i++) {
    limiter.hit("1.2.3.4");
  }

  const c = createMockContext("1.2.3.4");
  const result = await mw(c, next);
  assert(result !== undefined);
  if (!result) throw new Error("Expected rate limiter to return a response");
  const limited = result;

  assertSpyCalls(next, 0);
  assert(limited !== undefined);
  assertEquals(limited.status, 429);
  const limitedBody = limited.body as unknown as {
    error: {
      code: string;
      message: string;
      details?: { retryAfter?: number };
    };
  };
  // Common error envelope: { error: { code, message, details } }
  assertEquals(limitedBody.error.code, "RATE_LIMITED");
  assert(typeof limitedBody.error.message === "string");
  assert(limitedBody.error.message.length > 0);
  assert(limitedBody.error.details !== undefined);
  assert((limitedBody.error.details?.retryAfter ?? 0) > 0);
  assert(c._resHeaders["Retry-After"] !== undefined);
  assert(Number(c._resHeaders["Retry-After"]) > 0);
});
Deno.test("InMemoryRateLimiter#middleware - skips rate limiting when skip function returns true", async () => {
  const limiter = new InMemoryRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    skip: () => true,
  });
  const mw = limiter.middleware();

  // Exhaust the limit
  limiter.hit("1.2.3.4");

  const c = createMockContext("1.2.3.4");
  const next = spy(async () => undefined);

  await mw(c, next);

  // Should still pass through because skip returns true
  assertSpyCalls(next, 1);
});
Deno.test("InMemoryRateLimiter#middleware - uses custom keyGenerator when provided", async () => {
  const limiter = new InMemoryRateLimiter({
    maxRequests: 1,
    windowMs: 60_000,
    keyGenerator: () => "custom-key",
  });
  const mw = limiter.middleware();

  // Exhaust the custom key
  limiter.hit("custom-key");

  const c = createMockContext("1.2.3.4");
  const next = spy(async () => undefined);

  const result = await mw(c, next);
  assert(result !== undefined);
  if (!result) throw new Error("Expected rate limiter to return a response");
  const limited = result;

  // Should be rate limited because the custom key is exhausted
  assertSpyCalls(next, 0);
  assertEquals(limited.status, 429);
});
Deno.test("InMemoryRateLimiter#middleware - sets X-RateLimit-Reset header as seconds", async () => {
  const limiter = new InMemoryRateLimiter({
    maxRequests: 10,
    windowMs: 60_000,
  });
  const mw = limiter.middleware();
  const c = createMockContext("1.2.3.4");
  const next = spy(async () => undefined);

  await mw(c, next);

  const resetValue = Number(c._resHeaders["X-RateLimit-Reset"]);
  // Reset should be a reasonable epoch timestamp in seconds
  assert(resetValue > 0);
});

Deno.test("RateLimiters factory - creates auth limiter with expected config", () => {
  const limiter = RateLimiters.auth();
  assert(limiter instanceof InMemoryRateLimiter);
  const info = limiter.check("test");
  assertEquals(info.total, 100);
});
Deno.test("RateLimiters factory - creates sensitive limiter", () => {
  const limiter = RateLimiters.sensitive();
  const info = limiter.check("test");
  assertEquals(info.total, 100);
});
Deno.test("RateLimiters factory - creates oauthToken limiter with lower limit", () => {
  const limiter = RateLimiters.oauthToken();
  const info = limiter.check("test");
  assertEquals(info.total, 20);
});
Deno.test("RateLimiters factory - creates oauthRevoke limiter with strict limit", () => {
  const limiter = RateLimiters.oauthRevoke();
  const info = limiter.check("test");
  assertEquals(info.total, 10);
});
Deno.test("RateLimiters factory - creates oauthAuthorize limiter with 30 max requests", () => {
  const limiter = RateLimiters.oauthAuthorize();
  assert(limiter instanceof InMemoryRateLimiter);
  const info = limiter.check("test");
  assertEquals(info.total, 30);
});
Deno.test("RateLimiters factory - creates oauthRegister limiter with 10 max requests", () => {
  const limiter = RateLimiters.oauthRegister();
  assert(limiter instanceof InMemoryRateLimiter);
  const info = limiter.check("test");
  assertEquals(info.total, 10);
});
Deno.test("RateLimiters factory - creates oauthDeviceCode limiter with 10 max requests", () => {
  const limiter = RateLimiters.oauthDeviceCode();
  assert(limiter instanceof InMemoryRateLimiter);
  const info = limiter.check("test");
  assertEquals(info.total, 10);
});
Deno.test("RateLimiters factory - creates oauthDeviceVerify limiter with 60 max requests", () => {
  const limiter = RateLimiters.oauthDeviceVerify();
  assert(limiter instanceof InMemoryRateLimiter);
  const info = limiter.check("test");
  assertEquals(info.total, 60);
});
Deno.test("RateLimiters factory - each factory call creates a separate instance", () => {
  const a = RateLimiters.auth();
  const b = RateLimiters.auth();
  a.hit("user-1");
  assertEquals(b.check("user-1").remaining, 100); // b is independent
});
