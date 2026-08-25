import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { validateWebEnv } from "../validate-env.ts";

function completeWebEnv(): Record<string, unknown> {
  return {
    DB: {},
    HOSTNAME_ROUTING: {},
    SESSION_DO: {},
    RUN_NOTIFIER: {},
    RUN_QUEUE: {},
    OIDC_ISSUER_URL: "https://accounts.example",
    OIDC_CLIENT_ID: "takos-public-client",
    ADMIN_DOMAIN: "takos.example",
    TENANT_BASE_DOMAIN: "tenant.example",
    PLATFORM_PRIVATE_KEY: "private-key",
    PLATFORM_PUBLIC_KEY: "public-key",
    TAKOS_AGENT_START_TOKEN: "agent-start-token",
    ENCRYPTION_KEY: "encryption-key",
  };
}

test("public PKCE OIDC clients do not require a client secret", () => {
  assertEquals(validateWebEnv(completeWebEnv()), null);
});

test("confidential OIDC clients remain valid when a client secret is present", () => {
  const env = completeWebEnv();
  env.OIDC_CLIENT_SECRET = "confidential-client-secret";

  assertEquals(validateWebEnv(env), null);
});
