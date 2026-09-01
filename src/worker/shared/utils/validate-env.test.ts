import { describe, expect, test } from "bun:test";
import { validateWebEnv } from "./validate-env.ts";

function validWebEnv(): Record<string, unknown> {
  return {
    DB: {},
    HOSTNAME_ROUTING: {},
    SESSION_DO: {},
    RUN_NOTIFIER: {},
    RUN_QUEUE: {},
    TAKOSUMI_ACCOUNTS_URL: "https://accounts.takosumi.test",
    OIDC_ISSUER_URL: "https://accounts.takosumi.test",
    OIDC_CLIENT_ID: "takos-public-client",
    OIDC_REDIRECT_URI: "https://takos.test/auth/oidc/callback",
    ADMIN_DOMAIN: "takos.test",
    TENANT_BASE_DOMAIN: "apps.takos.test",
    PLATFORM_PRIVATE_KEY: "private-key",
    PLATFORM_PUBLIC_KEY: "public-key",
    TAKOS_AGENT_START_TOKEN: "agent-start-token",
    ENCRYPTION_KEY: "encryption-key",
  };
}

describe("Takos Web environment contract", () => {
  test("does not require a Takosumi control URL for standalone operation", () => {
    const env = validWebEnv();
    delete env.TAKOSUMI_ACCOUNTS_URL;

    expect(validateWebEnv(env)).toBeNull();
  });

  test("requires the configured OIDC client callback independently", () => {
    const env = validWebEnv();
    delete env.OIDC_REDIRECT_URI;

    expect(validateWebEnv(env)).toBe(
      "[takos] Missing required environment bindings: " +
        "OIDC_REDIRECT_URI",
    );
  });

  test("accepts a public PKCE client without a client secret", () => {
    expect(validateWebEnv(validWebEnv())).toBeNull();
  });
});
