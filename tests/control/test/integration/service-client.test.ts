import { ErrorCodes } from "@takos/worker-platform-utils/errors";
import {
  parseServiceResponse,
  ServiceCallError,
} from "@/shared/utils/service-client.ts";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

test("ServiceCallError - keeps BAD_REQUEST/400 fallback for unmapped upstream 4xx statuses", () => {
  const error = new ServiceCallError({
    serviceName: "profile-service",
    upstreamStatus: 418,
  });

  assert.deepStrictEqual(error.code, ErrorCodes.BAD_REQUEST);
  assert.deepStrictEqual(error.statusCode, 400);
});

test("ServiceCallError - keeps INTERNAL_ERROR/500 fallback for unmapped upstream 5xx statuses", () => {
  const error = new ServiceCallError({
    serviceName: "profile-service",
    upstreamStatus: 500,
  });

  assert.deepStrictEqual(error.code, ErrorCodes.INTERNAL_ERROR);
  assert.deepStrictEqual(error.statusCode, 500);
});

test("parseServiceResponse - returns parsed JSON for 200 success responses", async () => {
  const res = new Response(JSON.stringify({ ok: true, value: 42 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  assert.deepStrictEqual(
    await parseServiceResponse<{ ok: boolean; value: number }>(
      res,
      "profile-service",
    ),
    { ok: true, value: 42 },
  );
});

test("parseServiceResponse - returns undefined for 204 empty success responses", async () => {
  const res = new Response(null, { status: 204 });

  assert.deepStrictEqual(
    await parseServiceResponse<undefined>(res, "profile-service"),
    undefined,
  );
});

test("parseServiceResponse - throws ServiceCallError for malformed JSON on 2xx responses", async () => {
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
    assert.ok(error instanceof ServiceCallError);
    assert.deepStrictEqual(error.upstreamStatus, 200);
    assert.deepStrictEqual(error.upstreamBody, '{"ok":');
    assert.ok(error.message.includes("malformed JSON"));
  }
});

test("parseServiceResponse - extracts upstream error code for non-2xx responses", async () => {
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
    assert.ok(error instanceof ServiceCallError);
    assert.deepStrictEqual(error.upstreamStatus, 503);
    assert.deepStrictEqual(error.upstreamCode, "UPSTREAM_TIMEOUT");
    assert.deepStrictEqual(error.code, ErrorCodes.SERVICE_UNAVAILABLE);
  }
});
