import { assertEquals } from "@std/assert";
import { getWebApp } from "../../../web.ts";
import { authDeps } from "../../../server/middleware/auth.ts";
import type {
  Env,
  User,
} from "../../../shared/types/index.ts";
import { createMockEnv } from "../../../test/integration/setup.ts";

const originalAuthDeps = { ...authDeps };

const user = {
  id: "acct_verified",
  username: "verified",
  email: "verified@example.com",
  name: "Verified User",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-05-06T00:00:00.000Z",
  updated_at: "2026-05-06T00:00:00.000Z",
  principal_kind: "user",
} as User & { principal_kind: "user" };

Deno.test("/internal/auth/verify returns actor for verified Takosumi Accounts bearer", async () => {
  let validatePatCalls = 0;
  const validatePat = async () => {
    validatePatCalls += 1;
    return {
      userId: user.id,
      scopes: ["read"],
      tokenKind: "takosumi_accounts" as const,
      issuer: "https://accounts.example.test",
      subject: "acct_subject",
    };
  };
  authDeps.validateTakosumiAccountsBearer =
    validatePat as typeof authDeps.validateTakosumiAccountsBearer;
  authDeps.isValidUserId =
    ((value: unknown): value is string =>
      typeof value === "string") as typeof authDeps.isValidUserId;
  authDeps.getCachedUser = (async () => user) as typeof authDeps.getCachedUser;

  try {
    const response = await getWebApp().request(
      "https://takos.jp/internal/auth/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-takos-auth-proxy-secret": "trusted-proxy-secret",
          authorization: "Bearer takpat_verified",
        },
        body: JSON.stringify({ requestId: "req_1", spaceId: "space_1" }),
      },
      makeEnv(),
    );
    const body = await response.json() as {
      actor: { actorAccountId: string; requestId: string; spaceId: string };
      user: { id: string; principal_kind: string };
    };

    assertEquals(response.status, 200);
    assertEquals(body.actor.actorAccountId, user.id);
    assertEquals(body.actor.requestId, "req_1");
    assertEquals(body.actor.spaceId, "space_1");
    assertEquals(body.user.id, user.id);
    assertEquals(body.user.principal_kind, "user");
    assertEquals(validatePatCalls, 1);
  } finally {
    Object.assign(authDeps, originalAuthDeps);
  }
});

Deno.test("/internal/auth/verify rejects missing proxy secret before auth", async () => {
  let validatePatCalls = 0;
  const validatePat = async () => {
    validatePatCalls += 1;
    return {
      userId: user.id,
      scopes: ["read"],
      tokenKind: "takosumi_accounts" as const,
      issuer: "https://accounts.example.test",
      subject: "acct_subject",
    };
  };
  authDeps.validateTakosumiAccountsBearer =
    validatePat as typeof authDeps.validateTakosumiAccountsBearer;

  try {
    const response = await getWebApp().request(
      "https://takos.jp/internal/auth/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer takpat_verified",
        },
        body: JSON.stringify({ requestId: "req_1" }),
      },
      makeEnv(),
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    assertEquals(response.status, 403);
    assertEquals(body.error.code, "FORBIDDEN");
    assertEquals(body.error.message, "forbidden");
    assertEquals(validatePatCalls, 0);
  } finally {
    Object.assign(authDeps, originalAuthDeps);
  }
});

function makeEnv(): Env {
  const platform = {
    source: "workers",
    bindings: {},
    config: {
      adminDomain: "takos.jp",
      tenantBaseDomain: "apps.takos.jp",
      environment: "development",
      oidcIssuerUrl: "https://accounts.example.test",
    },
    services: {
      sql: { binding: {} },
      routing: {
        resolveHostname: async () => ({ kind: "not_found" }),
        selectDeploymentTarget: () => null,
        selectRouteRef: () => null,
      },
      queues: {},
      objects: {},
      notifications: {},
      locks: {},
      hosts: {},
      ai: {},
      assets: {},
      documents: {},
    },
  };
  return createMockEnv({
    ENVIRONMENT: "development",
    ADMIN_DOMAIN: "takos.jp",
    TAKOS_INTERNAL_API_SECRET: "trusted-proxy-secret",
    OIDC_ISSUER_URL: "https://accounts.example.test",
    PLATFORM: platform,
  });
}
