import { expect, test } from "bun:test";
import { Hono } from "hono";
import * as jose from "jose";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  deleteEnv,
  getEnv,
  setEnv,
} from "@takos/worker-platform-utils/runtime-env";
import { createLocalExecutionContext } from "../../../../local-platform/execution-context.ts";
import {
  createNodeWebEnv,
  disposeNodePlatformState,
} from "../../../../node-platform/env-builder.ts";
import { buildNodeWebPlatform } from "../../../../platform/adapters/node.ts";
import {
  generateCodeChallenge,
} from "../../../../application/services/identity/oidc-pkce.ts";
import {
  getOIDCState,
  getSession,
  getSessionIdFromCookie,
  OIDC_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../../../../application/services/identity/session.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { authOidcRouter } from "../oidc.ts";

const ENV_KEYS = [
  "ADMIN_DOMAIN",
  "TENANT_BASE_DOMAIN",
  "ENVIRONMENT",
  "NODE_ENV",
  "OIDC_ISSUER_URL",
  "OIDC_DISCOVERY_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "TAKOS_LOCAL_DATA_DIR",
  "TAKOS_DISABLE_REDIS_EXTERNALS",
  "REDIS_URL",
] as const;

function readCookieValue(setCookie: string, name: string): string | null {
  const prefix = `${name}=`;
  const value = setCookie
    .split(";", 1)[0]
    ?.trim();
  return value?.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/auth", authOidcRouter);
  return app;
}

test("Node resolver drives the complete OIDC login and callback session flow", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "takos-node-oidc-"));
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, getEnv(key)]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  const originalFetch = globalThis.fetch;
  const tokenRequests: URLSearchParams[] = [];

  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", {
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  const jwk = { ...publicJwk, alg: "ES256", kid: "node-resolver-test" };
  let idToken: string | null = null;

  try {
    setEnv("ADMIN_DOMAIN", "admin.local");
    setEnv("TENANT_BASE_DOMAIN", "tenant.local");
    setEnv("ENVIRONMENT", "development");
    deleteEnv("NODE_ENV");
    setEnv("OIDC_ISSUER_URL", "https://accounts.example.test");
    setEnv("OIDC_DISCOVERY_URL", "http://accounts.internal:8787");
    setEnv("OIDC_CLIENT_ID", "node-resolver-client");
    setEnv("OIDC_CLIENT_SECRET", "node-resolver-secret");
    setEnv(
      "OIDC_REDIRECT_URI",
      "https://admin.local/auth/oidc/callback",
    );
    setEnv("TAKOS_LOCAL_DATA_DIR", dataDir);
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    deleteEnv("REDIS_URL");
    await disposeNodePlatformState({ clearData: true });

    globalThis.fetch = (async (input, init) => {
      const request = new Request(
        input,
        init as globalThis.RequestInit | undefined,
      );
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer: "https://accounts.example.test",
          authorization_endpoint:
            "https://accounts.example.test/oauth/authorize",
          token_endpoint: "https://accounts.example.test/oauth/token",
          jwks_uri: "https://accounts.example.test/oauth/jwks",
          userinfo_endpoint: "https://accounts.example.test/oauth/userinfo",
        });
      }
      if (url.pathname === "/oauth/token") {
        tokenRequests.push(new URLSearchParams(await request.text()));
        return Response.json({
          access_token: "node-resolver-access-token",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 300,
          scope: "openid profile email capsules:read capsules:write",
        });
      }
      if (url.pathname === "/oauth/jwks") {
        return Response.json({ keys: [jwk] });
      }
      if (url.pathname === "/oauth/userinfo") {
        expect(request.headers.get("authorization")).toBe(
          "Bearer node-resolver-access-token",
        );
        return Response.json({
          sub: "node-resolver-subject",
          email: "node-resolver@example.test",
          name: "Node Resolver User",
          takosumi: { workspace_id: "node-resolver-workspace" },
          workspace_memberships: ["node-resolver-workspace"],
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    // Build the route's platform from the real Node env. This deliberately
    // avoids the hand-written in-memory session store used by unit tests.
    const env = await createNodeWebEnv();
    const platform = await buildNodeWebPlatform(env);
    const requestEnv = {
      ...env,
      PLATFORM: platform,
    } as Env;
    const app = createApp();
    const fetchRoute = (request: Request) =>
      app.fetch(request, requestEnv, createLocalExecutionContext());

    const loginResponse = await fetchRoute(
      new Request("https://admin.local/auth/oidc/login?return_to=/workspace"),
    );
    expect(loginResponse.status).toBe(302);
    const authorizationUrl = new URL(
      loginResponse.headers.get("location") ?? "",
    );
    const state = authorizationUrl.searchParams.get("state");
    expect(state).not.toBeNull();
    const stateCookie = loginResponse.headers
      .getSetCookie()
      .map((cookie) => readCookieValue(cookie, OIDC_STATE_COOKIE_NAME))
      .find((value): value is string => value !== null);
    expect(stateCookie).toBe(state);
    const storedState = await getOIDCState(env.SESSION_DO!, state!);
    expect(storedState).not.toBeNull();
    idToken = await new jose.SignJWT({
      sub: "node-resolver-subject",
      nonce: storedState!.nonce,
      email: "node-resolver@example.test",
      email_verified: true,
      name: "Node Resolver User",
    })
      .setProtectedHeader({ alg: "ES256", kid: "node-resolver-test" })
      .setIssuer("https://accounts.example.test")
      .setAudience("node-resolver-client")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const callbackResponse = await fetchRoute(
      new Request(
        `https://admin.local/auth/oidc/callback?code=node-resolver-code&state=${encodeURIComponent(
          state!,
        )}`,
        {
          headers: {
            Cookie: `${OIDC_STATE_COOKIE_NAME}=${stateCookie}`,
          },
        },
      ),
    );
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe("/setup");

    const setCookies = callbackResponse.headers.getSetCookie();
    const sessionCookie = setCookies.find((cookie) =>
      cookie.startsWith(`${SESSION_COOKIE_NAME}=`)
    );
    expect(sessionCookie).toBeDefined();
    const sessionId = getSessionIdFromCookie(sessionCookie);
    expect(sessionId).not.toBeNull();
    expect(
      setCookies.some((cookie) =>
        cookie.startsWith(`${OIDC_STATE_COOKIE_NAME}=;`) &&
        cookie.includes("Max-Age=0")
      ),
    ).toBe(true);

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code");
    expect(tokenRequests[0]?.get("code")).toBe("node-resolver-code");
    expect(tokenRequests[0]?.get("client_id")).toBe("node-resolver-client");
    expect(tokenRequests[0]?.get("client_secret")).toBe("node-resolver-secret");
    const codeVerifier = tokenRequests[0]?.get("code_verifier");
    expect(codeVerifier).not.toBeNull();
    expect(
      await generateCodeChallenge(codeVerifier!, "S256"),
    ).toBe(authorizationUrl.searchParams.get("code_challenge"));

    // Callback consumes the one-time server-side state before exchanging the
    // code, and the issued session is immediately readable through the same
    // resolver-backed namespace.
    expect(await getOIDCState(env.SESSION_DO!, state!)).toBeNull();
    expect(await getSession(env.SESSION_DO!, sessionId!)).toMatchObject({
      user_id: expect.any(String),
    });
  } finally {
    globalThis.fetch = originalFetch;
    await disposeNodePlatformState({ clearData: true });
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
