import { expect, test } from "bun:test";

import type { Env } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import {
  createMcpOAuthFetch,
  discoverMcpAuthorization,
  getMcpClientMetadataDocument,
  McpManualRegistrationRequiredError,
  prepareMcpOAuthAuthorization,
  registerMcpOAuthClient,
  resolveMcpOAuthPublicUrls,
  type McpAuthorizationDiscovery,
} from "../mcp/authorization.ts";
import {
  beginMcpAuthorization,
  createMcpOAuthPending,
  refreshMcpToken,
} from "../mcp/oauth.ts";
import { decryptToken, encryptToken, saltFor } from "../mcp/crypto.ts";
import { mapMcpServerRow } from "../mcp/mcp-models.ts";

const strictOptions = {
  allowHttp: false,
  allowLocalhost: false,
  allowPrivateIp: false,
};

function envWithEgress(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): Env {
  return {
    ENVIRONMENT: "production",
    ADMIN_DOMAIN: "takos.example",
    AUTH_PUBLIC_BASE_URL: "https://takos.example",
    ENCRYPTION_KEY: "mcp-authorization-test-key",
    TAKOS_EGRESS: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
        await handler(new URL(input.toString()), init),
    },
  } as unknown as Env;
}

function requestMessage(init?: RequestInit): Record<string, unknown> | null {
  if (typeof init?.body !== "string") return null;
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function protectedDiscoveryEnv(
  metadataOverrides: Record<string, unknown> = {},
): Env {
  return envWithEgress((url, init) => {
    const message = requestMessage(init);
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="https://connector.example/.well-known/oauth-protected-resource/mcp", scope="docs.read"',
        },
      });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://connector.example/mcp",
        authorization_servers: ["https://auth.example/"],
        scopes_supported: ["docs.read", "docs.write"],
      });
    }
    if (
      url.href === "https://auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://auth.example/",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        ...metadataOverrides,
      });
    }
    throw new Error(
      `Unexpected protected-discovery request: ${init?.method ?? "GET"} ${url} ${JSON.stringify(message)}`,
    );
  });
}

test("Client ID Metadata Document is deployment-specific and contains no secret", () => {
  const env = envWithEgress(() => new Response(null, { status: 500 }));
  const urls = resolveMcpOAuthPublicUrls(env);
  const document = getMcpClientMetadataDocument(env);

  expect(urls.clientId).toBe("https://takos.example/api/mcp/client.json");
  expect(document.client_id).toBe(urls.clientId);
  expect(document.redirect_uris).toEqual([
    "https://takos.example/api/mcp/oauth/callback",
  ]);
  expect(document.token_endpoint_auth_method).toBe("none");
  expect(JSON.stringify(document)).not.toContain("secret");
});

test("CIMD is preferred over DCR when the authorization server advertises it", async () => {
  const env = protectedDiscoveryEnv({
    client_id_metadata_document_supported: true,
    registration_endpoint: "https://auth.example/register",
  });
  const discovery = await discoverMcpAuthorization(
    "https://connector.example/mcp",
    env,
    "space_1",
    strictOptions,
  );
  expect(discovery.kind).toBe("oauth");
  const client = await registerMcpOAuthClient(
    "https://connector.example/mcp",
    discovery as Extract<McpAuthorizationDiscovery, { kind: "oauth" }>,
    env,
    "space_1",
    strictOptions,
  );
  expect(client.registrationMode).toBe("client_metadata_document");
  expect(client.clientId).toBe("https://takos.example/api/mcp/client.json");
  expect(client.clientSecret).toBeUndefined();
});

test("operator preregistration is preferred over CIMD and DCR", async () => {
  const env = protectedDiscoveryEnv({
    client_id_metadata_document_supported: true,
    registration_endpoint: "https://auth.example/register",
  });
  env.TAKOS_MCP_OAUTH_PREREGISTRATIONS_JSON = JSON.stringify({
    "https://connector.example/mcp": {
      client_id: "operator-client",
      client_secret: "operator-secret",
      token_endpoint_auth_method: "client_secret_basic",
    },
  });
  const discovery = await discoverMcpAuthorization(
    "https://connector.example/mcp",
    env,
    "space_1",
    strictOptions,
  );
  if (discovery.kind !== "oauth") throw new Error("expected OAuth discovery");
  const client = await registerMcpOAuthClient(
    "https://connector.example/mcp",
    discovery,
    env,
    "space_1",
    strictOptions,
  );
  expect(client).toMatchObject({
    clientId: "operator-client",
    clientSecret: "operator-secret",
    registrationMode: "preregistered",
    tokenEndpointAuthMethod: "client_secret_basic",
  });
});

test("missing CIMD and DCR returns an explicit manual-registration-required error", async () => {
  const env = protectedDiscoveryEnv();
  const discovery = await discoverMcpAuthorization(
    "https://connector.example/mcp",
    env,
    "space_1",
    strictOptions,
  );
  if (discovery.kind !== "oauth") throw new Error("expected OAuth discovery");
  try {
    await registerMcpOAuthClient(
      "https://connector.example/mcp",
      discovery,
      env,
      "space_1",
      strictOptions,
    );
    throw new Error("expected manual registration error");
  } catch (error) {
    expect(error).toBeInstanceOf(McpManualRegistrationRequiredError);
    const typed = error as McpManualRegistrationRequiredError;
    expect(typed.statusCode).toBe(400);
    expect(typed.details).toMatchObject({
      reason: "mcp_oauth_manual_registration_required",
    });
  }
});

test("DCR persists the returned confidential client shape for encryption", async () => {
  let registrationBody: Record<string, unknown> | null = null;
  const env = envWithEgress((url, init) => {
    if (url.href !== "https://auth.example/register") {
      throw new Error(`Unexpected DCR URL: ${url}`);
    }
    expect(new Headers(init?.headers).get("X-Takos-Space-Id")).toBe("space_1");
    registrationBody = requestMessage(init);
    return Response.json({
      client_id: "dynamic-client-123",
      client_secret: "dynamic-secret-456",
      client_id_issued_at: 1_788_825_600,
      client_secret_expires_at: 0,
      redirect_uris: ["https://takos.example/api/mcp/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    });
  });
  const discovery = {
    kind: "oauth" as const,
    authorizationServerUrl: "https://auth.example/",
    metadata: {
      issuer: "https://auth.example/",
      authorization_endpoint: "https://auth.example/authorize",
      token_endpoint: "https://auth.example/token",
      registration_endpoint: "https://auth.example/register",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    },
    resourceMetadata: {
      resource: "https://connector.example/mcp",
      authorization_servers: ["https://auth.example/"],
    },
    resourceMetadataUrl:
      "https://connector.example/.well-known/oauth-protected-resource/mcp",
    resourceUri: "https://connector.example/mcp",
  } satisfies Extract<McpAuthorizationDiscovery, { kind: "oauth" }>;

  const client = await registerMcpOAuthClient(
    "https://connector.example/mcp",
    discovery,
    env,
    "space_1",
    strictOptions,
    "docs.read",
  );
  expect(client).toMatchObject({
    clientId: "dynamic-client-123",
    clientSecret: "dynamic-secret-456",
    registrationMode: "dynamic",
    tokenEndpointAuthMethod: "client_secret_post",
  });
  const capturedRegistration = registrationBody as unknown as Record<
    string,
    unknown
  >;
  expect(capturedRegistration.scope).toBe("docs.read");
  expect(capturedRegistration.redirect_uris).toEqual([
    "https://takos.example/api/mcp/oauth/callback",
  ]);

  let pendingRow: Record<string, unknown> | null = null;
  const db = {
    select: () => ({}),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        pendingRow = value;
      },
    }),
    update: () => ({}),
    delete: () => ({}),
  } as unknown as SqlDatabaseBinding;
  await createMcpOAuthPending(db, env, {
    spaceId: "space_1",
    initiatorUserId: "user-1",
    serverName: "docs",
    serverUrl: "https://connector.example/mcp",
    issuerUrl: "https://auth.example/",
    authorizationEndpoint: "https://auth.example/authorize",
    authorizationUrl:
      "https://auth.example/authorize?state=pending-state&code_challenge=challenge",
    tokenEndpoint: "https://auth.example/token",
    redirectUri: "https://takos.example/api/mcp/oauth/callback",
    resourceUri: "https://connector.example/mcp",
    resourceMetadataUrl:
      "https://connector.example/.well-known/oauth-protected-resource/mcp",
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    registrationMode: client.registrationMode,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    state: "pending-state",
    codeVerifier: "pending-code-verifier",
    browserNonce: "browser-nonce-browser-nonce-browser-nonce-1",
  });
  expect(pendingRow).not.toBeNull();
  expect(pendingRow!.oauthClientSecret).not.toBe("dynamic-secret-456");
  expect(
    await decryptToken(
      String(pendingRow!.oauthClientSecret),
      env.ENCRYPTION_KEY!,
      saltFor(String(pendingRow!.id), "client-secret"),
    ),
  ).toBe("dynamic-secret-456");
});

test("reauthorization never reuses an old DCR secret after issuer change", async () => {
  let pendingRow: Record<string, unknown> | null = null;
  let registrationBody = "";
  const env = envWithEgress((url, init) => {
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, { status: 401 });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://connector.example/mcp",
        authorization_servers: ["https://new-auth.example/"],
      });
    }
    if (
      url.href ===
      "https://new-auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://new-auth.example/",
        authorization_endpoint: "https://new-auth.example/authorize",
        token_endpoint: "https://new-auth.example/token",
        registration_endpoint: "https://new-auth.example/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.href === "https://new-auth.example/register") {
      registrationBody = String(init?.body ?? "");
      return Response.json({
        client_id: "new-client",
        client_secret: "new-client-secret",
        redirect_uris: ["https://takos.example/api/mcp/oauth/callback"],
        token_endpoint_auth_method: "client_secret_post",
      });
    }
    throw new Error(`Unexpected issuer-change request: ${url}`);
  });
  const db = {
    select: () => ({}),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        pendingRow = value;
      },
    }),
    update: () => ({}),
    delete: () => ({}),
  } as unknown as SqlDatabaseBinding;
  const oldSecret = await encryptToken(
    "old-client-secret",
    env.ENCRYPTION_KEY!,
    saltFor("srv_old", "client-secret"),
  );

  const result = await beginMcpAuthorization(db, env, {
    spaceId: "space_1",
    initiatorUserId: "user-1",
    serverName: "docs",
    serverUrl: "https://connector.example/mcp",
    existingClient: {
      serverId: "srv_old",
      issuerUrl: "https://old-auth.example/",
      clientId: "old-client",
      encryptedClientSecret: oldSecret,
      clientIdIssuedAt: null,
      clientSecretExpiresAt: 0,
      registrationMode: "dynamic",
      tokenEndpointAuthMethod: "client_secret_post",
    },
  });
  expect(result.kind).toBe("oauth");
  expect(registrationBody).not.toContain("old-client-secret");
  const capturedPending = pendingRow as unknown as Record<string, unknown>;
  expect(capturedPending.oauthClientId).toBe("new-client");
  expect(
    await decryptToken(
      String(capturedPending.oauthClientSecret),
      env.ENCRYPTION_KEY!,
      saltFor(String(capturedPending.id), "client-secret"),
    ),
  ).toBe("new-client-secret");
});

test("resource indicator is included in the authorization request", async () => {
  const env = protectedDiscoveryEnv({
    client_id_metadata_document_supported: true,
  });
  const discovery = await discoverMcpAuthorization(
    "https://connector.example/mcp",
    env,
    "space_1",
    strictOptions,
  );
  if (discovery.kind !== "oauth") throw new Error("expected OAuth discovery");
  const prepared = await prepareMcpOAuthAuthorization(
    "https://connector.example/mcp",
    discovery,
    {
      clientId: "https://takos.example/api/mcp/client.json",
      registrationMode: "client_metadata_document",
      tokenEndpointAuthMethod: "none",
    },
    env,
    "oauth-state",
  );
  expect(prepared.authorizationUrl.searchParams.get("resource")).toBe(
    "https://connector.example/mcp",
  );
  expect(
    prepared.authorizationUrl.searchParams.get("code_challenge_method"),
  ).toBe("S256");
});

test("PRM discovery falls back from WWW-Authenticate URL to endpoint and root well-known", async () => {
  const metadataRequests: string[] = [];
  const env = envWithEgress((url) => {
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer resource_metadata="https://metadata.example/prm"',
        },
      });
    }
    if (
      url.href === "https://metadata.example/prm" ||
      url.href ===
        "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      metadataRequests.push(url.href);
      return new Response(null, { status: 404 });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource"
    ) {
      metadataRequests.push(url.href);
      return Response.json({
        resource: "https://connector.example/mcp",
        authorization_servers: ["https://auth.example/"],
      });
    }
    if (
      url.href === "https://auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://auth.example/",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
    }
    throw new Error(`Unexpected fallback request: ${url}`);
  });
  const discovery = await discoverMcpAuthorization(
    "https://connector.example/mcp",
    env,
    "space_1",
    strictOptions,
  );
  if (discovery.kind !== "oauth") throw new Error("expected OAuth discovery");
  expect(metadataRequests[0]).toBe("https://metadata.example/prm");
  expect(discovery.resourceMetadataUrl).toBe(
    "https://connector.example/.well-known/oauth-protected-resource",
  );
});

test("resource indicator is included in refresh token requests", async () => {
  let refreshBody: URLSearchParams | null = null;
  let expiresIn: number | undefined;
  const env = envWithEgress((url, init) => {
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, { status: 401 });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://connector.example/mcp",
        authorization_servers: ["https://auth.example/"],
      });
    }
    if (
      url.href === "https://auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://auth.example/",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.href === "https://auth.example/token") {
      refreshBody = new URLSearchParams(String(init?.body ?? ""));
      return Response.json({
        access_token: "refreshed-access",
        refresh_token: "refreshed-refresh",
        token_type: "Bearer",
        ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
      });
    }
    throw new Error(`Unexpected refresh request: ${url}`);
  });
  let updated: Record<string, unknown> | null = null;
  const db = {
    select: () => ({}),
    insert: () => ({}),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updated = value;
          return { meta: { changes: 1 } };
        },
      }),
    }),
    delete: () => ({}),
  } as unknown as SqlDatabaseBinding;
  const encryptedRefresh = await encryptToken(
    "stored-refresh",
    env.ENCRYPTION_KEY!,
    saltFor("srv_refresh", "refresh"),
  );
  const encryptedClientSecret = await encryptToken(
    "stored-client-secret",
    env.ENCRYPTION_KEY!,
    saltFor("srv_refresh", "client-secret"),
  );
  await refreshMcpToken(db, env, {
    id: "srv_refresh",
    accountId: "space_1",
    url: "https://connector.example/mcp",
    oauthRefreshToken: encryptedRefresh,
    oauthIssuerUrl: "https://auth.example/",
    oauthClientId: "stored-client",
    oauthClientSecret: encryptedClientSecret,
    oauthTokenEndpointAuthMethod: "client_secret_post",
    oauthResourceUri: "https://connector.example/mcp",
  });
  const capturedRefresh = refreshBody as unknown as URLSearchParams;
  expect(capturedRefresh.get("grant_type")).toBe("refresh_token");
  expect(capturedRefresh.get("resource")).toBe("https://connector.example/mcp");
  expect(capturedRefresh.get("client_secret")).toBe("stored-client-secret");
  const capturedUpdate = updated as unknown as Record<string, unknown>;
  expect(capturedUpdate.oauthAccessToken).not.toBe("refreshed-access");
  expect(capturedUpdate.oauthTokenExpiresAt).toBeNull();

  expiresIn = 0;
  updated = null;
  const now = 1_788_825_600_000;
  await refreshMcpToken(
    db,
    env,
    {
      id: "srv_refresh",
      accountId: "space_1",
      url: "https://connector.example/mcp",
      oauthRefreshToken: encryptedRefresh,
      oauthIssuerUrl: "https://auth.example/",
      oauthClientId: "stored-client",
      oauthClientSecret: encryptedClientSecret,
      oauthTokenEndpointAuthMethod: "client_secret_post",
      oauthResourceUri: "https://connector.example/mcp",
    },
    { now: () => now },
  );
  expect(updated).toMatchObject({
    oauthTokenExpiresAt: new Date(now).toISOString(),
  });
});

test("refresh fails closed when the discovered resource audience changes", async () => {
  let tokenCalls = 0;
  let updated: Record<string, unknown> | null = null;
  const env = envWithEgress((url) => {
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, { status: 401 });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://connector.example/",
        authorization_servers: ["https://auth.example/"],
      });
    }
    if (
      url.href === "https://auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://auth.example/",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.href === "https://auth.example/token") {
      tokenCalls += 1;
      return Response.json({
        access_token: "must-not-be-used",
        token_type: "Bearer",
      });
    }
    throw new Error(`Unexpected resource-change request: ${url}`);
  });
  const db = {
    select: () => ({}),
    insert: () => ({}),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updated = value;
          return { meta: { changes: 1 } };
        },
      }),
    }),
    delete: () => ({}),
  } as unknown as SqlDatabaseBinding;
  const encryptedRefresh = await encryptToken(
    "stored-refresh",
    env.ENCRYPTION_KEY!,
    saltFor("srv_resource_change", "refresh"),
  );

  await refreshMcpToken(db, env, {
    id: "srv_resource_change",
    accountId: "space_1",
    url: "https://connector.example/mcp",
    oauthRefreshToken: encryptedRefresh,
    oauthIssuerUrl: "https://auth.example/",
    oauthClientId: "stored-client",
    oauthClientSecret: null,
    oauthTokenEndpointAuthMethod: "none",
    oauthResourceUri: "https://connector.example/mcp",
  });

  expect(tokenCalls).toBe(0);
  expect(updated).toMatchObject({
    oauthAccessToken: null,
    oauthRefreshToken: null,
    oauthTokenExpiresAt: null,
  });
});

test("refresh fails closed when the authorization issuer changes", async () => {
  let tokenCalls = 0;
  let updated: Record<string, unknown> | null = null;
  const env = envWithEgress((url) => {
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, { status: 401 });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://connector.example/mcp",
        authorization_servers: ["https://new-auth.example/"],
      });
    }
    if (
      url.href ===
      "https://new-auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://new-auth.example/",
        authorization_endpoint: "https://new-auth.example/authorize",
        token_endpoint: "https://new-auth.example/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.href === "https://new-auth.example/token") {
      tokenCalls += 1;
      return Response.json({
        access_token: "must-not-be-used",
        token_type: "Bearer",
      });
    }
    throw new Error(`Unexpected issuer-change refresh request: ${url}`);
  });
  const db = {
    select: () => ({}),
    insert: () => ({}),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updated = value;
          return { meta: { changes: 1 } };
        },
      }),
    }),
    delete: () => ({}),
  } as unknown as SqlDatabaseBinding;
  const encryptedRefresh = await encryptToken(
    "stored-refresh",
    env.ENCRYPTION_KEY!,
    saltFor("srv_issuer_change", "refresh"),
  );

  await refreshMcpToken(db, env, {
    id: "srv_issuer_change",
    accountId: "space_1",
    url: "https://connector.example/mcp",
    oauthRefreshToken: encryptedRefresh,
    oauthIssuerUrl: "https://old-auth.example/",
    oauthClientId: "stored-client",
    oauthClientSecret: null,
    oauthTokenEndpointAuthMethod: "none",
    oauthResourceUri: "https://connector.example/mcp",
  });

  expect(tokenCalls).toBe(0);
  expect(updated).toMatchObject({
    oauthAccessToken: null,
    oauthRefreshToken: null,
    oauthTokenExpiresAt: null,
  });
});

test("valid initialize without tools capability is classified as public no-auth", async () => {
  let toolsListCalls = 0;
  const env = envWithEgress((url, init) => {
    if (url.href === "https://public.example/mcp") {
      const message = requestMessage(init);
      if (message?.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: "takos-oauth-discovery",
          result: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            serverInfo: { name: "public", version: "1" },
          },
        });
      }
      if (message?.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message?.method === "tools/list") toolsListCalls += 1;
    }
    if (url.pathname.includes(".well-known/oauth-protected-resource")) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected public discovery request: ${url}`);
  });
  const discovery = await discoverMcpAuthorization(
    "https://public.example/mcp",
    env,
    "space_1",
    strictOptions,
  );
  expect(discovery).toEqual({ kind: "public" });
  expect(toolsListCalls).toBe(0);
});

test("public probe rejects a non-JSON MCP initialize response", async () => {
  const env = envWithEgress((url) => {
    if (url.href === "https://invalid-content.example/mcp") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "takos-oauth-discovery",
          result: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            serverInfo: { name: "invalid", version: "1" },
          },
        }),
        { headers: { "Content-Type": "text/plain" } },
      );
    }
    if (url.pathname.includes(".well-known/oauth-protected-resource")) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected invalid-content request: ${url}`);
  });
  try {
    await discoverMcpAuthorization(
      "https://invalid-content.example/mcp",
      env,
      "space_1",
      strictOptions,
    );
    throw new Error("expected discovery failure");
  } catch (error) {
    expect(String((error as Error).cause)).toContain("application/json");
  }
});

test("public probe accepts a protocol version supported by the SDK", async () => {
  const env = envWithEgress((url) => {
    if (url.href === "https://old-protocol.example/mcp") {
      return Response.json({
        jsonrpc: "2.0",
        id: "takos-oauth-discovery",
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          serverInfo: { name: "old", version: "1" },
        },
      });
    }
    if (url.pathname.includes(".well-known/oauth-protected-resource")) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected old-protocol request: ${url}`);
  });
  await expect(
    discoverMcpAuthorization(
      "https://old-protocol.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).resolves.toEqual({ kind: "public" });
});

test("public probe rejects an invalid initialize result shape", async () => {
  const env = envWithEgress((url, init) => {
    if (url.href === "https://invalid-initialize.example/mcp") {
      const message = requestMessage(init);
      if (message?.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: "takos-oauth-discovery",
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: false },
            serverInfo: {},
          },
        });
      }
    }
    if (url.pathname.includes(".well-known/oauth-protected-resource")) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected invalid initialize request: ${url}`);
  });
  await expect(
    discoverMcpAuthorization(
      "https://invalid-initialize.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).rejects.toThrow("did not complete a public MCP handshake");
});

test("PRM resource indicators with fragments are refused", async () => {
  const env = envWithEgress((url) => {
    if (url.href === "https://fragment-resource.example/mcp") {
      return new Response(null, { status: 401 });
    }
    if (
      url.href ===
      "https://fragment-resource.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://fragment-resource.example/mcp#not-an-audience",
        authorization_servers: ["https://auth.example/"],
      });
    }
    if (
      url.href === "https://auth.example/.well-known/oauth-authorization-server"
    ) {
      return Response.json({
        issuer: "https://auth.example/",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    throw new Error(`Unexpected fragment resource request: ${url}`);
  });
  await expect(
    discoverMcpAuthorization(
      "https://fragment-resource.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).rejects.toThrow("must not include a fragment");
});

test("missing PKCE S256 advertisement is refused", async () => {
  const env = protectedDiscoveryEnv({
    code_challenge_methods_supported: [],
    client_id_metadata_document_supported: true,
  });
  await expect(
    discoverMcpAuthorization(
      "https://connector.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).rejects.toThrow("required PKCE S256");
});

test("authorization servers without RFC 9207 issuer responses are refused", async () => {
  const env = protectedDiscoveryEnv({
    authorization_response_iss_parameter_supported: false,
    client_id_metadata_document_supported: true,
  });
  await expect(
    discoverMcpAuthorization(
      "https://connector.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).rejects.toThrow("RFC 9207");
});

test("OIDC discovery preserves advertised RFC 9207 issuer-response support", async () => {
  const env = envWithEgress((url) => {
    if (url.href === "https://connector.example/mcp") {
      return new Response(null, { status: 401 });
    }
    if (
      url.href ===
      "https://connector.example/.well-known/oauth-protected-resource/mcp"
    ) {
      return Response.json({
        resource: "https://connector.example/mcp",
        authorization_servers: ["https://oidc.example/"],
      });
    }
    if (
      url.href === "https://oidc.example/.well-known/oauth-authorization-server"
    ) {
      return new Response(null, { status: 404 });
    }
    if (url.href === "https://oidc.example/.well-known/openid-configuration") {
      return Response.json({
        issuer: "https://oidc.example/",
        authorization_endpoint: "https://oidc.example/authorize",
        token_endpoint: "https://oidc.example/token",
        jwks_uri: "https://oidc.example/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
    }
    throw new Error(`Unexpected OIDC discovery request: ${url}`);
  });

  await expect(
    discoverMcpAuthorization(
      "https://connector.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).resolves.toMatchObject({
    kind: "oauth",
    authorizationServerUrl: "https://oidc.example/",
  });
});

test("production OAuth fetch fails closed without TAKOS_EGRESS", async () => {
  const env = {
    ENVIRONMENT: "production",
  } as unknown as Env;
  const guardedFetch = createMcpOAuthFetch(env, "space_1", strictOptions);
  await expect(guardedFetch("https://connector.example/mcp")).rejects.toThrow(
    "TAKOS_EGRESS binding is required",
  );
});

test("an oversized application/json initialize response is never classified public", async () => {
  const oversized = JSON.stringify({
    jsonrpc: "2.0",
    id: "takos-oauth-discovery",
    result: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      serverInfo: { name: "oversized", version: "1" },
      padding: "x".repeat(1024 * 1024),
    },
  });
  const env = envWithEgress((url) => {
    if (url.href === "https://oversized.example/mcp") {
      return new Response(oversized, {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname.includes(".well-known/oauth-protected-resource")) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected oversized response request: ${url}`);
  });
  await expect(
    discoverMcpAuthorization(
      "https://oversized.example/mcp",
      env,
      "space_1",
      strictOptions,
    ),
  ).rejects.toThrow("did not complete a public MCP handshake");
});

test("server list model exposes status but never tokens, client IDs, or secrets", () => {
  const record = mapMcpServerRow({
    id: "srv_1",
    accountId: "space_1",
    name: "docs",
    url: "https://connector.example/mcp",
    transport: "streamable-http",
    sourceType: "external",
    authMode: "oauth_pkce",
    serviceId: null,
    bundleDeploymentId: null,
    oauthAccessToken: "encrypted-access-secret",
    oauthRefreshToken: "encrypted-refresh-secret",
    oauthTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    oauthScope: "docs.read",
    oauthIssuerUrl: "https://auth.example/",
    oauthResourceUri: "https://connector.example/mcp",
    oauthResourceMetadataUrl:
      "https://connector.example/.well-known/oauth-protected-resource/mcp",
    oauthClientId: "confidential-client-id",
    oauthClientSecret: "encrypted-client-secret",
    oauthClientIdIssuedAt: 1,
    oauthClientSecretExpiresAt: 0,
    oauthRegistrationMode: "dynamic",
    oauthTokenEndpointAuthMethod: "client_secret_post",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  const serialized = JSON.stringify(record);
  expect(record.authorizationStatus).toBe("authorized");
  expect(record.oauthRegistrationMode).toBe("dynamic");
  expect(serialized).not.toContain("confidential-client-id");
  expect(serialized).not.toContain("encrypted-client-secret");
  expect(serialized).not.toContain("encrypted-access-secret");
  expect(serialized).not.toContain("encrypted-refresh-secret");
});
