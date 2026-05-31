import { apiJson, rpcJson } from "../../lib/rpc.ts";
import { assertEquals, assertRejects } from "@std/assert";

/**
 * `rpcJson` decodes the current Takos common envelope plus protocol flat
 * errors such as OAuth 2.0 (RFC 6749 §5.2). Arbitrary plain-string error
 * messages are not a current UI contract.
 */

function makeResponse(body: unknown, status: number): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

Deno.test("rpcJson - flattens takos common envelope { error: { code, message } }", async () => {
  const res = makeResponse(
    { error: { code: "NOT_FOUND", message: "Repository not found" } },
    404,
  );
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "Repository not found");
});

Deno.test("rpcJson - falls back to envelope code when message is absent", async () => {
  const res = makeResponse({ error: { code: "INTERNAL_ERROR" } }, 500);
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "INTERNAL_ERROR");
});

Deno.test("rpcJson - reads OAuth error_description (RFC 6749)", async () => {
  // Use 400 (RFC 6749 returns 400 for most invalid_* errors) so we exercise
  // the error-decoding path without also triggering the 401 login redirect.
  const res = makeResponse(
    { error: "invalid_client", error_description: "Client not found" },
    400,
  );
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "Client not found");
});

Deno.test("rpcJson - falls back to OAuth error code when description is absent", async () => {
  const res = makeResponse({ error: "invalid_grant" }, 400);
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "invalid_grant");
});

Deno.test("rpcJson - rejects arbitrary plain-string error messages", async () => {
  const res = makeResponse({ error: "Something went wrong" }, 500);
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "Request failed");
});

Deno.test("rpcJson - returns 'Request failed' when body is empty", async () => {
  const res = makeResponse({}, 500);
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "Request failed");
});

Deno.test("rpcJson - returns parsed JSON on 2xx", async () => {
  const res = makeResponse({ hello: "world" }, 200);
  const data = await rpcJson<{ hello: string }>(res);
  assertEquals(data.hello, "world");
});

Deno.test("apiJson - fetches JSON with an Accept header", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPath = "";
  let acceptHeader = "";
  try {
    globalThis.fetch = ((input, init) => {
      requestedPath = String(input);
      acceptHeader = new Headers(init?.headers).get("Accept") ?? "";
      return Promise.resolve(
        new Response(JSON.stringify({ hello: "world" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const data = await apiJson<{ hello: string }>("/api/example");
    assertEquals(requestedPath, "/api/example");
    assertEquals(acceptHeader, "application/json");
    assertEquals(data.hello, "world");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("apiJson - times out hung requests", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  try {
    globalThis.fetch = ((_input, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    const err = await assertRejects(
      () => apiJson("/api/hangs", { timeoutMs: 10 }),
      Error,
    );
    assertEquals(err.message, "Request timed out");
    assertEquals(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
