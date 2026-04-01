import { assertEquals } from "jsr:@std/assert";

import type { Env } from "@/types";
import oauthAuthorize from "@/server/routes/oauth/authorize.ts";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    PLATFORM: {
      services: {
        sql: { binding: undefined },
        notifications: { sessionStore: undefined },
      },
    },
    ...overrides,
  } as unknown as Env;
}

async function callAuthorize(
  body: Partial<Record<string, string>>,
  cookie = "",
  env: Env = createEnv(),
): Promise<Response> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }

  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  });
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return oauthAuthorize.fetch(
    new Request("http://localhost/authorize", {
      method: "POST",
      headers,
      body: params.toString(),
    }),
    env,
    {} as ExecutionContext,
  );
}

Deno.test("oauth authorize POST rejects mismatched CSRF tokens", async () => {
  const response = await callAuthorize(
    {
      client_id: "client-1",
      redirect_uri: "https://client.example/callback",
      scope: "openid profile",
      state: "raw-state",
      code_challenge: "raw-challenge",
      code_challenge_method: "S256",
      csrf_token: "body-token",
      action: "allow",
    },
    "__Host-csrf=cookie-token; __Host-tp_session=session-cookie",
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "CSRF token mismatch" });
});

Deno.test("oauth authorize POST returns 401 when the user is not authenticated", async () => {
  const response = await callAuthorize(
    {
      client_id: "client-1",
      redirect_uri: "https://client.example/callback",
      scope: "openid profile",
      state: "raw-state",
      code_challenge: "raw-challenge",
      code_challenge_method: "S256",
      csrf_token: "shared-token",
      action: "allow",
    },
    "__Host-csrf=shared-token",
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Not authenticated" });
});
