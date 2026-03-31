import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

import type { Env } from "@/types";
import { authSessionRouter } from "../../../../../packages/control/src/server/routes/auth/session.ts";

function createEnv(
  overrides: {
    adminDomain?: string;
    googleClientId?: string;
    googleClientSecret?: string;
    dbBinding?: unknown;
    sessionStore?: unknown;
  } = {},
): Env {
  return {
    PLATFORM: {
      config: {
        adminDomain: overrides.adminDomain ?? "test.takos.jp",
        googleClientId: overrides.googleClientId,
        googleClientSecret: overrides.googleClientSecret,
      },
      services: {
        sql: { binding: overrides.dbBinding },
        notifications: { sessionStore: overrides.sessionStore },
      },
    },
  } as unknown as Env;
}

Deno.test("auth session callback returns 400 when OAuth provider returns an error", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/auth/callback?error=access_denied"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertStringIncludes(await response.text(), "OAuth Error");
});

Deno.test("auth session callback returns 400 when code is missing", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/auth/callback?state=oauth-state"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertStringIncludes(await response.text(), "Missing OAuth code.");
});

Deno.test("auth session login returns 500 when Google OAuth is not configured", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/auth/login"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 500);
  assertStringIncludes(
    await response.text(),
    "Google OAuth is not configured.",
  );
});
