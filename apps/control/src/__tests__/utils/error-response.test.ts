// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { type Context, Hono } from "hono";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
} from "../../../../../packages/common/src/middleware/hono.ts";
import { oauth2Error } from "../../../../../packages/control/src/shared/utils/error-response.ts";

import { assertEquals } from "jsr:@std/assert";

type CommonErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type OAuth2Body = {
  error: string;
  error_description?: string;
};

async function runWithContext(
  handler: (c: Context) => Response | Promise<Response>,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const app = new Hono();
  app.get("/test", (c) => handler(c));
  const res = await app.request("/test");
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

Deno.test("badRequest - returns 400 with BAD_REQUEST code", async () => {
  const { status, body } = await runWithContext((c) =>
    badRequest(c, "Invalid field")
  );
  const parsed = body as CommonErrorBody;
  assertEquals(status, 400);
  assertEquals(parsed.error.code, "BAD_REQUEST");
  assertEquals(parsed.error.message, "Invalid field");
});

Deno.test("notFound - returns 404 with resource name", async () => {
  const { status, body } = await runWithContext((c) => notFound(c, "User"));
  const parsed = body as CommonErrorBody;
  assertEquals(status, 404);
  assertEquals(parsed.error.code, "NOT_FOUND");
  assertEquals(parsed.error.message, "User");
});

Deno.test("forbidden - returns 403 with default message", async () => {
  const { status, body } = await runWithContext((c) => forbidden(c));
  const parsed = body as CommonErrorBody;
  assertEquals(status, 403);
  assertEquals(parsed.error.code, "FORBIDDEN");
  assertEquals(parsed.error.message, "Access denied");
});

Deno.test("internalError - returns 500 with default message", async () => {
  const { status, body } = await runWithContext((c) => internalError(c));
  const parsed = body as CommonErrorBody;
  assertEquals(status, 500);
  assertEquals(parsed.error.code, "INTERNAL_ERROR");
  assertEquals(parsed.error.message, "Internal server error");
});

Deno.test("oauth2Error - returns error in OAuth2 format", async () => {
  const { status, body } = await runWithContext((c) =>
    oauth2Error(c, 400, "invalid_grant", "Grant expired")
  );
  const parsed = body as OAuth2Body;
  assertEquals(status, 400);
  assertEquals(parsed.error, "invalid_grant");
  assertEquals(parsed.error_description, "Grant expired");
});

Deno.test("oauth2Error - omits description when not provided", async () => {
  const { body } = await runWithContext((c) =>
    oauth2Error(c, 401, "invalid_client")
  );
  const parsed = body as OAuth2Body;
  assertEquals(parsed.error, "invalid_client");
  assertEquals(parsed.error_description, undefined);
});
