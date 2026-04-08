import { rpcJson } from "../../lib/rpc.ts";
import { assertEquals, assertRejects } from "jsr:@std/assert";

/**
 * Round 11 Frontend #10: `rpcJson` must decode error bodies in three
 * shapes — takos common envelope, OAuth 2.0 flat format (RFC 6749 §5.2),
 * and legacy plain-string `{ error: 'message' }`. Before this round the
 * parser always called `data.error` and coerced it to a string, which
 * produced literal "[object Object]" for envelope errors and dropped
 * `error_description` entirely for OAuth.
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

Deno.test("rpcJson - uses legacy plain-string { error: 'msg' }", async () => {
  const res = makeResponse({ error: "Something went wrong" }, 500);
  const err = await assertRejects(() => rpcJson(res), Error);
  assertEquals(err.message, "Something went wrong");
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
