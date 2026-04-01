import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

import type { Env } from "@/types";
import { authSessionRouter } from "@/server/routes/auth/session.ts";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    PLATFORM: {
      config: {
        adminDomain: "test.takos.jp",
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      },
      services: {
        sql: { binding: undefined },
        notifications: { sessionStore: undefined },
      },
    },
    ...overrides,
  } as unknown as Env;
}

Deno.test("auth session login returns OAuth configuration error when bindings are unavailable", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/login"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 500);
  assertStringIncludes(
    await response.text(),
    "Google OAuth is not configured.",
  );
});

Deno.test("auth session callback returns OAuth error page when provider reports an error", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/callback?error=access_denied"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertStringIncludes(await response.text(), "access_denied");
});

Deno.test("auth session callback rejects requests without an OAuth code", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/callback?state=oauth-state"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertStringIncludes(await response.text(), "Missing OAuth code.");
});

Deno.test("auth session callback rejects requests without an OAuth state", async () => {
  const response = await authSessionRouter.fetch(
    new Request("https://test.takos.jp/callback?code=oauth-code"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertStringIncludes(await response.text(), "Missing OAuth state.");
});

Deno.test("auth session callback returns configuration error when session dependencies are unavailable", async () => {
  const response = await authSessionRouter.fetch(
    new Request(
      "https://test.takos.jp/callback?code=oauth-code&state=oauth-state",
    ),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 500);
  assertStringIncludes(
    await response.text(),
    "Google OAuth is not configured.",
  );
});
