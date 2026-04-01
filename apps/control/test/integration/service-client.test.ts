import { ErrorCodes } from "takos-common/errors";
import {
  parseServiceResponse,
  ServiceCallError,
} from "@/shared/utils/service-client.ts";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

Deno.test("ServiceCallError - keeps BAD_REQUEST/400 fallback for unmapped upstream 4xx statuses", () => {
  const error = new ServiceCallError({
    serviceName: "profile-service",
    upstreamStatus: 418,
  });

  assertEquals(error.code, ErrorCodes.BAD_REQUEST);
  assertEquals(error.statusCode, 400);
});

Deno.test("ServiceCallError - keeps INTERNAL_ERROR/500 fallback for unmapped upstream 5xx statuses", () => {
  const error = new ServiceCallError({
    serviceName: "profile-service",
    upstreamStatus: 500,
  });

  assertEquals(error.code, ErrorCodes.INTERNAL_ERROR);
  assertEquals(error.statusCode, 500);
});

Deno.test("parseServiceResponse - returns parsed JSON for 200 success responses", async () => {
  const res = new Response(JSON.stringify({ ok: true, value: 42 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  assertEquals(
    await parseServiceResponse<{ ok: boolean; value: number }>(
      res,
      "profile-service",
    ),
    { ok: true, value: 42 },
  );
});

Deno.test("parseServiceResponse - returns undefined for 204 empty success responses", async () => {
  const res = new Response(null, { status: 204 });

  assertEquals(
    await parseServiceResponse<undefined>(res, "profile-service"),
    undefined,
  );
});

Deno.test("parseServiceResponse - throws ServiceCallError for malformed JSON on 2xx responses", async () => {
  const res = new Response('{"ok":', {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    await parseServiceResponse(res, "profile-service");
    throw new Error(
      "Expected parseServiceResponse to throw for malformed JSON",
    );
  } catch (error) {
    assert(error instanceof ServiceCallError);
    assertEquals(error.upstreamStatus, 200);
    assertEquals(error.upstreamBody, '{"ok":');
    assertStringIncludes(error.message, "malformed JSON");
  }
});

Deno.test("parseServiceResponse - extracts upstream error code for non-2xx responses", async () => {
  const res = new Response(
    JSON.stringify({
      error: {
        code: "UPSTREAM_TIMEOUT",
        message: "Timeout while processing request",
      },
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );

  try {
    await parseServiceResponse(res, "payments-service");
    throw new Error(
      "Expected parseServiceResponse to throw for non-2xx response",
    );
  } catch (error) {
    assert(error instanceof ServiceCallError);
    assertEquals(error.upstreamStatus, 503);
    assertEquals(error.upstreamCode, "UPSTREAM_TIMEOUT");
    assertEquals(error.code, ErrorCodes.SERVICE_UNAVAILABLE);
  }
});
