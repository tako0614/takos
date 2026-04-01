import {
  CF_API_BASE,
  type CFAPIResponse,
  classifyAPIError,
  type CloudflareAPIError,
  createTimeoutError,
  createWfpConfig,
  resolveWfpConfig,
  sanitizeErrorMessage,
  WfpClient,
  type WFPConfig,
} from "@/services/wfp/client";

// ---------------------------------------------------------------------------
// resolveWfpConfig
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test("resolveWfpConfig - returns config when all values are present", () => {
  const config = resolveWfpConfig({
    CF_ACCOUNT_ID: "acc-1",
    CF_API_TOKEN: "tok-1",
    WFP_DISPATCH_NAMESPACE: "ns-1",
  });
  assertEquals(config, {
    accountId: "acc-1",
    apiToken: "tok-1",
    dispatchNamespace: "ns-1",
  });
});
Deno.test("resolveWfpConfig - returns null when CF_ACCOUNT_ID is missing", () => {
  const config = resolveWfpConfig({
    CF_ACCOUNT_ID: undefined,
    CF_API_TOKEN: "tok",
    WFP_DISPATCH_NAMESPACE: "ns",
  } as never);
  assertEquals(config, null);
});
Deno.test("resolveWfpConfig - returns null when CF_API_TOKEN is empty string", () => {
  const config = resolveWfpConfig({
    CF_ACCOUNT_ID: "acc",
    CF_API_TOKEN: "  ",
    WFP_DISPATCH_NAMESPACE: "ns",
  });
  assertEquals(config, null);
});
Deno.test("resolveWfpConfig - returns null when WFP_DISPATCH_NAMESPACE is missing", () => {
  const config = resolveWfpConfig({
    CF_ACCOUNT_ID: "acc",
    CF_API_TOKEN: "tok",
    WFP_DISPATCH_NAMESPACE: undefined,
  } as never);
  assertEquals(config, null);
});
Deno.test("resolveWfpConfig - trims whitespace from values", () => {
  const config = resolveWfpConfig({
    CF_ACCOUNT_ID: "  acc  ",
    CF_API_TOKEN: " tok ",
    WFP_DISPATCH_NAMESPACE: " ns ",
  });
  assertEquals(config, {
    accountId: "acc",
    apiToken: "tok",
    dispatchNamespace: "ns",
  });
});
// ---------------------------------------------------------------------------
// createWfpConfig
// ---------------------------------------------------------------------------

Deno.test("createWfpConfig - returns config for valid env", () => {
  const config = createWfpConfig({
    CF_ACCOUNT_ID: "acc",
    CF_API_TOKEN: "tok",
    WFP_DISPATCH_NAMESPACE: "ns",
  });
  assertEquals(config.accountId, "acc");
});
Deno.test("createWfpConfig - throws when config cannot be resolved", () => {
  assertThrows(() => createWfpConfig({} as never), "not configured");
});
// ---------------------------------------------------------------------------
// sanitizeErrorMessage
// ---------------------------------------------------------------------------

Deno.test("sanitizeErrorMessage - redacts Bearer tokens", () => {
  const msg = "Error: Bearer abc123def";
  assertStringIncludes(sanitizeErrorMessage(msg), "[REDACTED]");
  assert(!(sanitizeErrorMessage(msg)).includes("abc123def"));
});
Deno.test("sanitizeErrorMessage - redacts api_token values", () => {
  const msg = "api_token=my_secret_key";
  assertStringIncludes(sanitizeErrorMessage(msg), "[REDACTED]");
  assert(!(sanitizeErrorMessage(msg)).includes("my_secret_key"));
});
Deno.test("sanitizeErrorMessage - redacts authorization values", () => {
  const msg = "authorization=secret";
  assertStringIncludes(sanitizeErrorMessage(msg), "[REDACTED]");
});
Deno.test("sanitizeErrorMessage - redacts secret_key values", () => {
  const msg = "secret_key=mysecret";
  assertStringIncludes(sanitizeErrorMessage(msg), "[REDACTED]");
});
Deno.test("sanitizeErrorMessage - redacts password values", () => {
  const msg = "password=hunter2";
  assertStringIncludes(sanitizeErrorMessage(msg), "[REDACTED]");
});
Deno.test("sanitizeErrorMessage - redacts account IDs in paths", () => {
  const msg = "accounts/abcdef1234567890abcdef1234567890/workers";
  assertStringIncludes(sanitizeErrorMessage(msg), "[REDACTED]");
});
Deno.test("sanitizeErrorMessage - leaves normal messages unchanged", () => {
  const msg = "Worker deployment failed with status 404";
  assertEquals(sanitizeErrorMessage(msg), msg);
});
// ---------------------------------------------------------------------------
// classifyAPIError
// ---------------------------------------------------------------------------

Deno.test("classifyAPIError - creates error with status code and message from CF errors", () => {
  const response = new Response(null, { status: 400 });
  const data: CFAPIResponse = {
    success: false,
    errors: [{ code: 1001, message: "Bad request" }],
    messages: [],
    result: null,
  };

  const err = classifyAPIError(response, data);
  assertEquals(err.statusCode, 400);
  assertStringIncludes(err.message, "Bad request");
  assertEquals(err.code, 1001);
  assertEquals(err.isRetryable, false);
});
Deno.test("classifyAPIError - uses status text when no CF errors in data", () => {
  const response = new Response(null, { status: 403, statusText: "Forbidden" });
  const err = classifyAPIError(response);
  assertStringIncludes(err.message, "403");
  assertStringIncludes(err.message, "Forbidden");
  assertEquals(err.isRetryable, false);
});
Deno.test("classifyAPIError - classifies 429 as rate limited and retryable", () => {
  const headers = new Headers({ "Retry-After": "30" });
  const response = new Response(null, { status: 429, headers });
  const err = classifyAPIError(response);

  assertEquals(err.isRateLimited, true);
  assertEquals(err.isRetryable, true);
  assertEquals(err.retryAfter, 30);
});
Deno.test("classifyAPIError - defaults retryAfter to 60 when Retry-After header is missing", () => {
  const response = new Response(null, { status: 429 });
  const err = classifyAPIError(response);
  assertEquals(err.retryAfter, 60);
});
Deno.test("classifyAPIError - defaults retryAfter to 60 when Retry-After header is non-numeric", () => {
  const headers = new Headers({
    "Retry-After": "Wed, 21 Oct 2025 07:28:00 GMT",
  });
  const response = new Response(null, { status: 429, headers });
  const err = classifyAPIError(response);
  assertEquals(err.retryAfter, 60);
});
Deno.test("classifyAPIError - classifies 5xx as retryable", () => {
  const response = new Response(null, { status: 502 });
  const err = classifyAPIError(response);
  assertEquals(err.isRetryable, true);
});
Deno.test("classifyAPIError - sanitizes error messages from CF API", () => {
  const response = new Response(null, { status: 400 });
  const data: CFAPIResponse = {
    success: false,
    errors: [{ code: 1, message: "Bearer mysecrettoken leaked" }],
    messages: [],
    result: null,
  };
  const err = classifyAPIError(response, data);
  assert(!err.message.includes("mysecrettoken"));
  assertStringIncludes(err.message, "[REDACTED]");
});
// ---------------------------------------------------------------------------
// createTimeoutError
// ---------------------------------------------------------------------------

Deno.test("createTimeoutError - creates an error with timeout message and isRetryable flag", () => {
  const err = createTimeoutError(30000);
  assertStringIncludes(err.message, "30 seconds");
  assertEquals(err.isRetryable, true);
});
// ---------------------------------------------------------------------------
// WfpClient
// ---------------------------------------------------------------------------

const config: WFPConfig = {
  accountId: "acc-1",
  apiToken: "test-token",
  dispatchNamespace: "ns-1",
};

Deno.test("WfpClient - sends Authorization header and parses successful JSON response", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { data: "ok" },
          errors: [],
          messages: [],
        }),
        { status: 200 },
      )
    );
    (globalThis as any).fetch = fetchMock;

    const client = new WfpClient(config);
    const response = await client.fetch<{ data: string }>("/test/path");

    assertEquals(response.result.data, "ok");
    assertSpyCalls(fetchMock, 1);

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    assertEquals(url, `${CF_API_BASE}/test/path`);
    assertEquals(headers.Authorization, "Bearer test-token");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("WfpClient - throws classified error on non-ok response", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 404, message: "Not found" }],
          messages: [],
          result: null,
        }),
        { status: 404 },
      )
    );
    (globalThis as any).fetch = fetchMock;

    const client = new WfpClient(config);
    try {
      await client.fetch("/missing");
      throw new Error("unreachable");
    } catch (err) {
      const cfErr = err as CloudflareAPIError;
      assertEquals(cfErr.statusCode, 404);
      assertStringIncludes(cfErr.message, "Not found");
    }
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("WfpClient - throws classified error when success is false in response body", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 100, message: "fail" }],
          messages: [],
          result: null,
        }),
        { status: 200 },
      )
    );
    (globalThis as any).fetch = fetchMock;

    const client = new WfpClient(config);
    await assertRejects(async () => {
      await client.fetch("/bad");
    });
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("WfpClient - throws timeout error on AbortError", async () => {
  try {
    const fetchMock = spy(() => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    (globalThis as any).fetch = fetchMock;

    const client = new WfpClient(config);
    await assertRejects(async () => {
      await client.fetch("/slow", {}, 1000);
    }, "timeout");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("WfpClient - merges custom headers with auth header", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: {},
          errors: [],
          messages: [],
        }),
        { status: 200 },
      )
    );
    (globalThis as any).fetch = fetchMock;

    const client = new WfpClient(config);
    await client.fetch("/test", { headers: { "X-Custom": "value" } });

    const init = (fetchMock.calls[0] as any).args[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    assertEquals(headers.Authorization, "Bearer test-token");
    assertEquals(headers["X-Custom"], "value");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
