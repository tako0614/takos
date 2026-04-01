import { Buffer } from "node:buffer";
import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

// [Deno] vi.mock removed - manually stub imports from '@/utils/user-cache'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/takos-access-tokens'
import {
  gitAuthDeps,
  optionalGitAuth,
  requireGitAuth,
} from "@/middleware/git-auth";

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };
const originalGitAuthDeps = { ...gitAuthDeps };

function encodeBasicAuth(password: string): string {
  return `Basic ${Buffer.from(`x-token-auth:${password}`).toString("base64")}`;
}

function createProtectedApp() {
  const app = new Hono<TestEnv>();
  app.use("*", requireGitAuth);
  app.get(
    "/git/repo.git/git-receive-pack",
    (c) => c.text(c.get("user")?.id ?? "missing"),
  );
  return app;
}

function createOptionalApp() {
  const app = new Hono<TestEnv>();
  app.use("*", optionalGitAuth);
  app.get(
    "/git/repo.git/info/refs",
    (c) => c.text(c.get("user")?.id ?? "anonymous"),
  );
  return app;
}

Deno.test("git auth PAT hardening - accepts personal access tokens", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosPersonalAccessToken = spy(async () => ({
    userId: "user-1",
    scopes: ["repos:write"],
    tokenKind: "personal",
  })) as any;
  const getCachedUser = spy(async () => ({
    id: "user-1",
    email: "user1@example.com",
    name: "User1",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-02-13T00:00:00.000Z",
    updated_at: "2026-02-13T00:00:00.000Z",
  } satisfies User)) as any;
  const isValidUserId = spy(() => true) as any;
  gitAuthDeps.getCachedUser = getCachedUser;
  gitAuthDeps.isValidUserId = isValidUserId;
  gitAuthDeps.validateTakosPersonalAccessToken =
    validateTakosPersonalAccessToken;
  const env = createMockEnv();
  const app = createProtectedApp();

  try {
    const response = await app.fetch(
      new Request("https://takos.jp/git/repo.git/git-receive-pack", {
        headers: {
          Authorization: encodeBasicAuth("tak_pat_personal_1234567890"),
        },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), "user-1");
    assertSpyCallArgs(validateTakosPersonalAccessToken, 0, [
      env.DB,
      "tak_pat_personal_1234567890",
    ]);
  } finally {
    Object.assign(gitAuthDeps, originalGitAuthDeps);
  }
});
Deno.test("git auth PAT hardening - rejects managed built-in tokens", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosPersonalAccessToken = spy(async () => null) as any;
  const getCachedUser = spy(async () => null) as any;
  const isValidUserId = spy(() => true) as any;
  gitAuthDeps.getCachedUser = getCachedUser;
  gitAuthDeps.isValidUserId = isValidUserId;
  gitAuthDeps.validateTakosPersonalAccessToken =
    validateTakosPersonalAccessToken;
  const env = createMockEnv();
  const app = createProtectedApp();

  try {
    const response = await app.fetch(
      new Request("https://takos.jp/git/repo.git/git-receive-pack", {
        headers: {
          Authorization: encodeBasicAuth("tak_pat_managed_token_1234567890"),
        },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 403);
    await assertEquals(await response.text(), "Access denied\n");
    assertSpyCallArgs(validateTakosPersonalAccessToken, 0, [
      env.DB,
      "tak_pat_managed_token_1234567890",
    ]);
    assertSpyCalls(getCachedUser, 0);
  } finally {
    Object.assign(gitAuthDeps, originalGitAuthDeps);
  }
});
Deno.test("git auth PAT hardening - optional git auth keeps anonymous when only managed token is presented", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosPersonalAccessToken = spy(async () => null) as any;
  const getCachedUser = spy(async () => null) as any;
  const isValidUserId = spy(() => true) as any;
  gitAuthDeps.getCachedUser = getCachedUser;
  gitAuthDeps.isValidUserId = isValidUserId;
  gitAuthDeps.validateTakosPersonalAccessToken =
    validateTakosPersonalAccessToken;
  const env = createMockEnv();
  const app = createOptionalApp();

  try {
    const response = await app.fetch(
      new Request("https://takos.jp/git/repo.git/info/refs", {
        headers: {
          Authorization: encodeBasicAuth("tak_pat_managed_token_1234567890"),
        },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), "anonymous");
    assertSpyCallArgs(validateTakosPersonalAccessToken, 0, [
      env.DB,
      "tak_pat_managed_token_1234567890",
    ]);
    assertSpyCalls(getCachedUser, 0);
  } finally {
    Object.assign(gitAuthDeps, originalGitAuthDeps);
  }
});
