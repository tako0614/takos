import { Hono } from "hono";
import type { Env } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import { isAppError } from "takos-common/errors";

const mocks = {
  verifyThreadShareAccess: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-shares'
import publicShareRoute from "@/routes/public-share";
import { publicShareRouteDeps } from "@/routes/public-share";

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.route("/api/public", publicShareRoute);
  return app;
}

Deno.test("public-share routes - GET /api/public/thread-shares/:token - returns shared thread for public share", async () => {
  mocks.verifyThreadShareAccess = (async () => ({
    threadId: "t-1",
    share: {
      mode: "public",
      expires_at: null,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;
  publicShareRouteDeps.buildSharedThreadPayload = async (
    _env,
    _threadId,
    token,
  ) =>
    ({
      token,
      thread: {
        id: "t-1",
        title: "Shared Thread",
        created_at: "2026-03-01",
        updated_at: "2026-03-01",
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          sequence: 1,
          created_at: "2026-03-01",
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Hi there",
          sequence: 2,
          created_at: "2026-03-01",
        },
      ],
    }) as any;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/abc123"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("share" in json);
  assert("thread" in json);
  assert("messages" in json);
});
Deno.test("public-share routes - GET /api/public/thread-shares/:token - returns 401 when password is required", async () => {
  mocks.verifyThreadShareAccess =
    (async () => ({ error: "password_required" })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/abc123"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 401);
});
Deno.test("public-share routes - GET /api/public/thread-shares/:token - returns 404 when share not found", async () => {
  mocks.verifyThreadShareAccess = (async () => ({ error: "not_found" })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/invalid-token"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("public-share routes - GET /api/public/thread-shares/:token - returns 404 when thread is deleted", async () => {
  mocks.verifyThreadShareAccess = (async () => ({
    threadId: "t-1",
    share: {
      mode: "public",
      expires_at: null,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;
  publicShareRouteDeps.buildSharedThreadPayload = async () => null as any;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/abc123"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("public-share routes - POST /api/public/thread-shares/:token/access - returns shared thread with correct password", async () => {
  mocks.verifyThreadShareAccess = (async () => ({
    threadId: "t-1",
    share: {
      mode: "password",
      expires_at: null,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;
  publicShareRouteDeps.buildSharedThreadPayload = async (
    _env,
    _threadId,
    token,
  ) =>
    ({
      token,
      thread: {
        id: "t-1",
        title: "Thread",
        created_at: "2026-03-01",
        updated_at: "2026-03-01",
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "Hi",
          sequence: 1,
          created_at: "2026-03-01",
        },
      ],
    }) as any;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/abc123/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct-password" }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("public-share routes - POST /api/public/thread-shares/:token/access - returns 401 when password is required but not provided", async () => {
  mocks.verifyThreadShareAccess =
    (async () => ({ error: "password_required" })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/abc123/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 401);
});
Deno.test("public-share routes - POST /api/public/thread-shares/:token/access - returns 403 when password is incorrect", async () => {
  mocks.verifyThreadShareAccess = (async () => ({ error: "forbidden" })) as any;
  publicShareRouteDeps.verifyThreadShareAccess = mocks.verifyThreadShareAccess;

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/public/thread-shares/abc123/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});
