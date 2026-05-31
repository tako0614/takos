import { assertEquals } from "@std/assert";
import { csrfMiddleware, evaluateCsrf, parseAllowedOrigins } from "./csrf.ts";

Deno.test("parseAllowedOrigins normalizes and drops invalid entries", () => {
  assertEquals(
    parseAllowedOrigins(
      " https://takos.test, https://takos.jp/, invalid, https://x.com/path",
    ),
    ["https://takos.test", "https://takos.jp", "https://x.com"],
  );
  assertEquals(parseAllowedOrigins(""), []);
  assertEquals(parseAllowedOrigins(undefined), []);
});

Deno.test("evaluateCsrf bypasses GET requests regardless of origin", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "GET",
    headers: { cookie: "__Host-tp_session=abc" },
  });
  assertEquals(evaluateCsrf(request, ["https://other.test"]).ok, true);
});

Deno.test("evaluateCsrf bypasses Bearer-auth POSTs (header not auto-sent)", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      authorization: "Bearer takpat_abc",
    },
    body: "{}",
  });
  assertEquals(evaluateCsrf(request, ["https://takos.test"]).ok, true);
});

Deno.test("evaluateCsrf bypasses no-credential POSTs (auth layer will reject)", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    body: "{}",
  });
  assertEquals(evaluateCsrf(request, ["https://takos.test"]).ok, true);
});

Deno.test("evaluateCsrf permits cookie POST when allowlist is empty", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      origin: "https://attacker.test",
    },
    body: "{}",
  });
  assertEquals(evaluateCsrf(request, []).ok, true);
});

Deno.test("evaluateCsrf permits cookie POST matching the allowlist", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      origin: "https://takos.test",
    },
    body: "{}",
  });
  assertEquals(evaluateCsrf(request, ["https://takos.test"]).ok, true);
});

Deno.test("evaluateCsrf rejects cookie POST with foreign Origin", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      origin: "https://attacker.test",
    },
    body: "{}",
  });
  const decision = evaluateCsrf(request, ["https://takos.test"]);
  assertEquals(decision.ok, false);
  if (decision.ok) throw new Error("unreachable");
  assertEquals(decision.reason, "csrf_origin_mismatch");
});

Deno.test("evaluateCsrf falls back to Referer when Origin is absent", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      referer: "https://takos.test/profile",
    },
    body: "{}",
  });
  assertEquals(evaluateCsrf(request, ["https://takos.test"]).ok, true);
});

Deno.test("evaluateCsrf rejects cookie POST with missing Origin and Referer", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
    },
    body: "{}",
  });
  const decision = evaluateCsrf(request, ["https://takos.test"]);
  assertEquals(decision.ok, false);
  if (decision.ok) throw new Error("unreachable");
  assertEquals(decision.reason, "csrf_origin_missing");
});

Deno.test("evaluateCsrf treats Origin: null as missing", () => {
  const request = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      origin: "null",
    },
    body: "{}",
  });
  const decision = evaluateCsrf(request, ["https://takos.test"]);
  assertEquals(decision.ok, false);
  if (decision.ok) throw new Error("unreachable");
  assertEquals(decision.reason, "csrf_origin_missing");
});

Deno.test("csrfMiddleware integrates with a Hono-like context", async () => {
  const middleware = csrfMiddleware({
    read: () => "https://takos.test",
  });
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
    return Promise.resolve();
  };
  const allowedRequest = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      origin: "https://takos.test",
    },
    body: "{}",
  });
  let capturedResponse: Response | undefined;
  const allowedContext = {
    req: { raw: allowedRequest },
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status }),
  };
  // @ts-expect-error simplified context for unit test
  const allowedResult = await middleware(allowedContext, next);
  assertEquals(nextCalled, true);
  assertEquals(allowedResult, undefined);

  nextCalled = false;
  const blockedRequest = new Request("https://example.test/api/spaces", {
    method: "POST",
    headers: {
      cookie: "__Host-tp_session=abc",
      origin: "https://attacker.test",
    },
    body: "{}",
  });
  const blockedContext = {
    req: { raw: blockedRequest },
    json: (body: unknown, status: number) => {
      capturedResponse = new Response(JSON.stringify(body), { status });
      return capturedResponse;
    },
  };
  // @ts-expect-error simplified context for unit test
  const blockedResult = await middleware(blockedContext, next);
  assertEquals(nextCalled, false);
  assertEquals(blockedResult instanceof Response, true);
  if (!(blockedResult instanceof Response)) {
    throw new Error("expected Response");
  }
  assertEquals(blockedResult.status, 403);
  const body = await blockedResult.json() as {
    error: { code: string; message: string };
  };
  assertEquals(body.error.code, "csrf_origin_mismatch");
});
