import { parseServiceResponse, ServiceCallError } from "@/utils/service-client";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

Deno.test("ServiceCallError - creates error with mapped status code for 404", () => {
  const err = new ServiceCallError({
    serviceName: "test-service",
    upstreamStatus: 404,
  });
  assertEquals(err.message, "test-service returned 404");
  assertEquals(err.name, "ServiceCallError");
  assertEquals(err.serviceName, "test-service");
  assertEquals(err.upstreamStatus, 404);
  assertEquals(err.statusCode, 404);
  assertEquals(err.code, "NOT_FOUND");
});
Deno.test("ServiceCallError - maps 400 to BAD_REQUEST", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 400 });
  assertEquals(err.code, "BAD_REQUEST");
  assertEquals(err.statusCode, 400);
});
Deno.test("ServiceCallError - maps 401 to UNAUTHORIZED", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 401 });
  assertEquals(err.code, "UNAUTHORIZED");
});
Deno.test("ServiceCallError - maps 403 to FORBIDDEN", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 403 });
  assertEquals(err.code, "FORBIDDEN");
});
Deno.test("ServiceCallError - maps 409 to CONFLICT", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 409 });
  assertEquals(err.code, "CONFLICT");
});
Deno.test("ServiceCallError - maps 429 to RATE_LIMITED", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 429 });
  assertEquals(err.code, "RATE_LIMITED");
});
Deno.test("ServiceCallError - maps 503 to SERVICE_UNAVAILABLE", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 503 });
  assertEquals(err.code, "SERVICE_UNAVAILABLE");
});
Deno.test("ServiceCallError - maps 422 to VALIDATION_ERROR", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 422 });
  assertEquals(err.code, "VALIDATION_ERROR");
  assertEquals(err.statusCode, 422);
});
Deno.test("ServiceCallError - maps 502 to BAD_GATEWAY", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 502 });
  assertEquals(err.code, "BAD_GATEWAY");
  assertEquals(err.statusCode, 502);
});
Deno.test("ServiceCallError - maps 504 to GATEWAY_TIMEOUT", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 504 });
  assertEquals(err.code, "GATEWAY_TIMEOUT");
  assertEquals(err.statusCode, 504);
});
Deno.test("ServiceCallError - maps unknown 4xx to BAD_REQUEST/400", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 418 });
  assertEquals(err.code, "BAD_REQUEST");
  assertEquals(err.statusCode, 400);
});
Deno.test("ServiceCallError - maps unknown 5xx to INTERNAL_ERROR/500", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 599 });
  assertEquals(err.code, "INTERNAL_ERROR");
  assertEquals(err.statusCode, 500);
});
Deno.test("ServiceCallError - uses custom message when provided", () => {
  const err = new ServiceCallError({
    serviceName: "svc",
    upstreamStatus: 500,
    message: "Custom failure message",
  });
  assertEquals(err.message, "Custom failure message");
});
Deno.test("ServiceCallError - stores upstream body and code", () => {
  const err = new ServiceCallError({
    serviceName: "svc",
    upstreamStatus: 400,
    upstreamBody: '{"error":"bad"}',
    upstreamCode: "VALIDATION",
  });
  assertEquals(err.upstreamBody, '{"error":"bad"}');
  assertEquals(err.upstreamCode, "VALIDATION");
});
Deno.test("ServiceCallError - is an instance of Error", () => {
  const err = new ServiceCallError({ serviceName: "svc", upstreamStatus: 500 });
  assert(err instanceof Error);
});

Deno.test("parseServiceResponse - parses JSON from successful response", async () => {
  const res = new Response(JSON.stringify({ data: "ok" }), { status: 200 });
  const result = await parseServiceResponse<{ data: string }>(res, "test-svc");
  assertEquals(result, { data: "ok" });
});
Deno.test("parseServiceResponse - returns undefined for 204 No Content", async () => {
  const res = new Response(null, { status: 204 });
  const result = await parseServiceResponse(res, "test-svc");
  assertEquals(result, undefined);
});
Deno.test("parseServiceResponse - returns undefined for 205 Reset Content", async () => {
  const res = new Response(null, { status: 205 });
  const result = await parseServiceResponse(res, "test-svc");
  assertEquals(result, undefined);
});
Deno.test("parseServiceResponse - returns undefined for empty body on 200", async () => {
  const res = new Response("", { status: 200 });
  const result = await parseServiceResponse(res, "test-svc");
  assertEquals(result, undefined);
});
Deno.test("parseServiceResponse - returns undefined for whitespace-only body on 200", async () => {
  const res = new Response("   ", { status: 200 });
  const result = await parseServiceResponse(res, "test-svc");
  assertEquals(result, undefined);
});
Deno.test("parseServiceResponse - throws ServiceCallError for malformed JSON on success", async () => {
  const res = new Response("not json", { status: 200 });
  await assertRejects(async () => {
    await parseServiceResponse(res, "test-svc");
  }, ServiceCallError);
  try {
    await parseServiceResponse(
      new Response("bad", { status: 200 }),
      "test-svc",
    );
  } catch (e) {
    assertStringIncludes((e as ServiceCallError).message, "malformed JSON");
  }
});
Deno.test("parseServiceResponse - throws ServiceCallError for 4xx responses", async () => {
  const res = new Response(JSON.stringify({ error: { code: "VALIDATION" } }), {
    status: 400,
  });
  try {
    await parseServiceResponse(res, "test-svc");
    assert(false, "Should have thrown");
  } catch (e) {
    const err = e as ServiceCallError;
    assert(err instanceof ServiceCallError);
    assertEquals(err.upstreamStatus, 400);
    assertEquals(err.upstreamCode, "VALIDATION");
  }
});
Deno.test("parseServiceResponse - throws ServiceCallError for 5xx responses", async () => {
  const res = new Response("Internal Server Error", { status: 500 });
  await assertRejects(async () => {
    await parseServiceResponse(res, "test-svc");
  }, ServiceCallError);
});
Deno.test("parseServiceResponse - handles non-JSON error body gracefully", async () => {
  const res = new Response("<html>Error</html>", { status: 500 });
  try {
    await parseServiceResponse(res, "test-svc");
    assert(false, "Should have thrown");
  } catch (e) {
    const err = e as ServiceCallError;
    assertEquals(err.upstreamBody, "<html>Error</html>");
    assertEquals(err.upstreamCode, undefined);
  }
});
