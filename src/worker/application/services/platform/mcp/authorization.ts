/**
 * MCP 2025-11-25 authorization discovery and OAuth client registration.
 *
 * Network I/O in this module is always routed through the same SSRF-gated
 * egress boundary as MCP tool calls. The official SDK owns protocol metadata
 * parsing, OAuth/OIDC fallback order, DCR response validation, resource URL
 * validation, and authorization URL construction; Takos supplies the stricter
 * URL/redirect/timeout boundary and durable client-registration policy.
 */

import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
  isHttpsUrl,
  registerClient,
  selectClientAuthMethod,
  selectResourceURL,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  InitializeResultSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsResultSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import {
  BadGatewayError,
  BadRequestError,
} from "@takos/worker-platform-utils/errors";
import type { Env } from "../../../../shared/types/index.ts";
import type {
  McpEndpointUrlOptions,
  McpOAuthRegistrationMode,
} from "./mcp-models.ts";
import { assertAllowedMcpEndpointUrl } from "./validation.ts";

const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_HANDSHAKE_MESSAGE_BYTES = 1024 * 1024;
const MAX_OAUTH_RESPONSE_BYTES = 1024 * 1024;
const CLIENT_METADATA_PATH = "/api/mcp/client.json";
const OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";

export type McpOAuthClientRegistration = {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  registrationMode: McpOAuthRegistrationMode;
  tokenEndpointAuthMethod:
    "none" | "client_secret_basic" | "client_secret_post";
};

export type McpAuthorizationDiscovery =
  | { kind: "public" }
  | {
      kind: "oauth";
      authorizationServerUrl: string;
      metadata: AuthorizationServerMetadata;
      resourceMetadata: OAuthProtectedResourceMetadata;
      resourceMetadataUrl: string;
      resourceUri: string;
      scope?: string;
    };

export type PreparedMcpOAuthAuthorization = {
  authorizationServerUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  resourceMetadataUrl: string;
  resourceUri: string;
  scope?: string;
  client: McpOAuthClientRegistration;
  authorizationUrl: URL;
  codeVerifier: string;
};

export class McpAuthorizationDiscoveryError extends BadGatewayError {
  readonly reason = "mcp_authorization_discovery_failed";

  constructor(message: string, options?: ErrorOptions) {
    super(message, { reason: "mcp_authorization_discovery_failed" });
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export class McpManualRegistrationRequiredError extends BadRequestError {
  readonly reason = "mcp_oauth_manual_registration_required";

  constructor(authorizationServerUrl: string) {
    super(
      `OAuth client registration is required for ${authorizationServerUrl}; configure an operator preregistration because the server advertises neither Client ID Metadata Documents nor Dynamic Client Registration.`,
      {
        reason: "mcp_oauth_manual_registration_required",
        authorizationServerUrl,
      },
    );
  }
}

export function resolveMcpOAuthPublicUrls(
  env: Pick<Env, "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">,
): { origin: string; clientId: string; redirectUri: string } {
  const configured = env.AUTH_PUBLIC_BASE_URL?.trim();
  const adminDomain = env.ADMIN_DOMAIN?.trim();
  const raw = configured || (adminDomain ? `https://${adminDomain}` : "");
  if (!raw) throw new Error("Takos public OAuth origin is not configured");

  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error("Takos MCP OAuth public origin must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Takos MCP OAuth public origin cannot contain credentials");
  }

  const origin = parsed.origin;
  return {
    origin,
    clientId: new URL(CLIENT_METADATA_PATH, origin).href,
    redirectUri: new URL(OAUTH_CALLBACK_PATH, origin).href,
  };
}

export function getMcpClientMetadataDocument(
  env: Pick<Env, "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">,
): OAuthClientMetadata & { client_id: string } {
  const urls = resolveMcpOAuthPublicUrls(env);
  return {
    client_id: urls.clientId,
    client_name: "Takos",
    client_uri: urls.origin,
    redirect_uris: [urls.redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

function getDcrClientMetadata(
  env: Pick<Env, "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">,
  scope?: string,
): OAuthClientMetadata {
  const urls = resolveMcpOAuthPublicUrls(env);
  return {
    client_name: "Takos",
    client_uri: urls.origin,
    redirect_uris: [urls.redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...(scope ? { scope } : {}),
  };
}

function withTimeout(init?: RequestInit): RequestInit {
  return {
    ...init,
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  };
}

export function createMcpOAuthFetch(
  env: Env,
  spaceId: string,
  options: McpEndpointUrlOptions,
): FetchLike {
  return async (input, init) => {
    const allowed = assertAllowedMcpEndpointUrl(
      input.toString(),
      options,
      "MCP OAuth endpoint",
    );
    const finalInit = withTimeout(init);
    if (env.TAKOS_EGRESS) {
      const headers = new Headers(finalInit.headers);
      headers.set("X-Takos-Space-Id", spaceId);
      headers.set("X-Takos-Egress-Mode", "mcp-oauth");
      const response = await env.TAKOS_EGRESS.fetch(allowed, {
        ...finalInit,
        headers,
      });
      return boundMcpOAuthResponse(response);
    }
    if (env.ENVIRONMENT !== "development") {
      throw new Error(
        "TAKOS_EGRESS binding is required for MCP OAuth in production",
      );
    }
    return boundMcpOAuthResponse(await fetch(allowed, finalInit));
  };
}

function boundMcpOAuthResponse(response: Response): Response {
  if (!response.body) return response;
  let bytes = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > MAX_OAUTH_RESPONSE_BYTES) {
          controller.error(new Error("MCP OAuth response is too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: unknown;
};

async function readHandshakeMessage(
  response: Response,
): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) {
    if (!response.body)
      throw new Error("MCP initialize SSE response has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_HANDSHAKE_MESSAGE_BYTES) {
          throw new Error("MCP initialize response is too large");
        }
        buffered += decoder.decode(value, { stream: true });
        const boundary = buffered.search(/\r?\n\r?\n/);
        if (boundary >= 0) {
          const event = buffered.slice(0, boundary);
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) return JSON.parse(data) as JsonRpcResponse;
          buffered = buffered.slice(boundary).replace(/^\r?\n\r?\n/, "");
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    throw new Error("MCP initialize SSE response contained no JSON-RPC event");
  }

  if (!contentType.includes("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      "MCP non-SSE response must use the application/json content type",
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_HANDSHAKE_MESSAGE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("MCP initialize response is too large");
  }
  if (!response.body) throw new Error("MCP JSON response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HANDSHAKE_MESSAGE_BYTES) {
        throw new Error("MCP initialize response is too large");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(body) as JsonRpcResponse;
}

function assertInitializeResponse(message: JsonRpcResponse): {
  capabilities: Record<string, unknown>;
  protocolVersion: string;
} {
  if (
    message.jsonrpc !== "2.0" ||
    message.id !== "takos-oauth-discovery" ||
    !message.result ||
    typeof message.result !== "object"
  ) {
    throw new Error(
      "MCP initialize response is not a matching JSON-RPC result",
    );
  }
  const result = InitializeResultSchema.parse(message.result);
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
    throw new Error(
      `MCP initialize result negotiated unsupported protocol version ${result.protocolVersion}`,
    );
  }
  return {
    capabilities: result.capabilities as Record<string, unknown>,
    protocolVersion: result.protocolVersion,
  };
}

async function postJsonRpc(
  fetchFn: FetchLike,
  serverUrl: string,
  message: Record<string, unknown>,
  sessionId?: string,
  protocolVersion = LATEST_PROTOCOL_VERSION,
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": protocolVersion,
  });
  if (sessionId) headers.set("Mcp-Session-Id", sessionId);
  return await fetchFn(serverUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
}

async function probeMcpServer(
  serverUrl: string,
  fetchFn: FetchLike,
): Promise<{
  authenticated: boolean;
  resourceMetadataUrl?: URL;
  scope?: string;
  failure?: Error;
}> {
  let initializeResponse: Response;
  try {
    initializeResponse = await postJsonRpc(fetchFn, serverUrl, {
      jsonrpc: "2.0",
      id: "takos-oauth-discovery",
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Takos", version: "0.1" },
      },
    });
  } catch (error) {
    return {
      authenticated: false,
      failure: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const challenge = extractWWWAuthenticateParams(initializeResponse);
  if (initializeResponse.status === 401) {
    await initializeResponse.body?.cancel().catch(() => undefined);
    return {
      authenticated: true,
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      scope: challenge.scope,
    };
  }
  if (!initializeResponse.ok) {
    await initializeResponse.body?.cancel().catch(() => undefined);
    return {
      authenticated: false,
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      scope: challenge.scope,
      failure: new Error(
        `MCP initialize failed: ${initializeResponse.status} ${initializeResponse.statusText}`,
      ),
    };
  }

  const sessionId =
    initializeResponse.headers.get("Mcp-Session-Id") ?? undefined;
  let negotiatedProtocolVersion = LATEST_PROTOCOL_VERSION;
  try {
    const initialize = assertInitializeResponse(
      await readHandshakeMessage(initializeResponse),
    );
    negotiatedProtocolVersion = initialize.protocolVersion;
    const initializedResponse = await postJsonRpc(
      fetchFn,
      serverUrl,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      sessionId,
      negotiatedProtocolVersion,
    );
    if (!initializedResponse.ok) {
      throw new Error(
        `MCP initialized notification failed: ${initializedResponse.status}`,
      );
    }
    await initializedResponse.body?.cancel().catch(() => undefined);

    // tools/list is side-effect free and proves that a server advertising the
    // tools capability completed an MCP request after initialization.
    if (initialize.capabilities.tools) {
      const toolsResponse = await postJsonRpc(
        fetchFn,
        serverUrl,
        {
          jsonrpc: "2.0",
          id: "takos-oauth-discovery-tools",
          method: "tools/list",
          params: {},
        },
        sessionId,
        negotiatedProtocolVersion,
      );
      if (!toolsResponse.ok) {
        throw new Error(`MCP tools/list probe failed: ${toolsResponse.status}`);
      }
      const toolsMessage = await readHandshakeMessage(toolsResponse);
      if (
        toolsMessage.jsonrpc !== "2.0" ||
        toolsMessage.id !== "takos-oauth-discovery-tools"
      ) {
        throw new Error(
          "MCP tools/list probe returned an invalid JSON-RPC result",
        );
      }
      ListToolsResultSchema.parse(toolsMessage.result);
    }

    return { authenticated: false };
  } catch (error) {
    return {
      authenticated: false,
      failure: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    if (sessionId) {
      const headers = new Headers({
        "MCP-Protocol-Version": negotiatedProtocolVersion,
        "Mcp-Session-Id": sessionId,
      });
      await fetchFn(serverUrl, { method: "DELETE", headers })
        .then((response) => response.body?.cancel())
        .catch(() => undefined);
    }
  }
}

function validateAuthorizationMetadata(
  authorizationServerUrl: string,
  metadata: AuthorizationServerMetadata,
  options: McpEndpointUrlOptions,
  authorizationResponseIssuerSupported: boolean,
): void {
  assertAllowedMcpEndpointUrl(metadata.issuer, options, "OAuth issuer");
  if (metadata.issuer !== authorizationServerUrl) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth metadata issuer does not match the advertised authorization server",
    );
  }
  if (!authorizationResponseIssuerSupported) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth authorization server must advertise RFC 9207 authorization response issuer support",
    );
  }
  assertAllowedMcpEndpointUrl(
    metadata.authorization_endpoint,
    options,
    "OAuth authorization endpoint",
  );
  assertAllowedMcpEndpointUrl(
    metadata.token_endpoint,
    options,
    "OAuth token endpoint",
  );
  if (metadata.registration_endpoint) {
    assertAllowedMcpEndpointUrl(
      metadata.registration_endpoint,
      options,
      "OAuth registration endpoint",
    );
  }
  if (!metadata.response_types_supported.includes("code")) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth authorization server does not support the authorization-code response type",
    );
  }
  if (!metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth authorization server does not advertise required PKCE S256 support",
    );
  }
}

export async function discoverMcpAuthorization(
  serverUrl: string,
  env: Env,
  spaceId: string,
  options: McpEndpointUrlOptions,
): Promise<McpAuthorizationDiscovery> {
  const server = assertAllowedMcpEndpointUrl(serverUrl, options, "MCP server");
  const fetchFn = createMcpOAuthFetch(env, spaceId, options);
  const probe = await probeMcpServer(server.href, fetchFn);

  let discoveredResourceMetadataUrl: string | undefined;
  const prmFetch: FetchLike = async (url, init) => {
    const response = await fetchFn(url, init);
    if (response.ok) discoveredResourceMetadataUrl = new URL(url).href;
    return response;
  };

  let resourceMetadata: OAuthProtectedResourceMetadata | undefined;
  let resourceMetadataError: unknown;
  if (probe.resourceMetadataUrl) {
    try {
      resourceMetadata = await discoverOAuthProtectedResourceMetadata(
        server,
        {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          resourceMetadataUrl: probe.resourceMetadataUrl,
        },
        prmFetch,
      );
    } catch (error) {
      resourceMetadataError = error;
    }
  }
  if (!resourceMetadata) {
    try {
      resourceMetadata = await discoverOAuthProtectedResourceMetadata(
        server,
        { protocolVersion: LATEST_PROTOCOL_VERSION },
        prmFetch,
      );
    } catch (error) {
      resourceMetadataError = error;
    }
  }
  if (!resourceMetadata) {
    if (!probe.authenticated && !probe.failure) return { kind: "public" };
    throw new McpAuthorizationDiscoveryError(
      "MCP server did not complete a public MCP handshake and OAuth Protected Resource Metadata discovery failed",
      { cause: probe.failure ?? resourceMetadataError },
    );
  }

  if (!resourceMetadata.authorization_servers?.length) {
    throw new McpAuthorizationDiscoveryError(
      "MCP Protected Resource Metadata has no authorization_servers entry",
    );
  }
  const resourceMetadataUrl =
    discoveredResourceMetadataUrl ?? probe.resourceMetadataUrl?.href;
  if (!resourceMetadataUrl) {
    throw new McpAuthorizationDiscoveryError(
      "MCP Protected Resource Metadata URL could not be determined",
    );
  }
  assertAllowedMcpEndpointUrl(
    resourceMetadataUrl,
    options,
    "MCP Protected Resource Metadata endpoint",
  );

  for (const candidate of resourceMetadata.authorization_servers) {
    assertAllowedMcpEndpointUrl(
      candidate,
      options,
      "OAuth authorization server",
    );
  }
  const authorizationServerUrl = new URL(
    resourceMetadata.authorization_servers[0],
  ).href;

  let authorizationResponseIssuerSupported = false;
  const metadataFetch: FetchLike = async (url, init) => {
    const response = await fetchFn(url, init);
    if (!response.ok) return response;
    const body = await response.text();
    const raw = JSON.parse(body) as Record<string, unknown>;
    authorizationResponseIssuerSupported =
      raw.authorization_response_iss_parameter_supported === true;
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  const metadata = await discoverAuthorizationServerMetadata(
    authorizationServerUrl,
    { fetchFn: metadataFetch, protocolVersion: LATEST_PROTOCOL_VERSION },
  );
  if (!metadata) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth authorization-server and OpenID Connect metadata discovery failed",
    );
  }
  validateAuthorizationMetadata(
    authorizationServerUrl,
    metadata,
    options,
    authorizationResponseIssuerSupported,
  );

  const resource = await selectResourceURL(
    server,
    {} as OAuthClientProvider,
    resourceMetadata,
  );
  if (!resource) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth Protected Resource Metadata did not resolve a resource indicator",
    );
  }
  assertAllowedMcpEndpointUrl(
    resource.href,
    options,
    "OAuth resource indicator",
  );
  if (resource.hash) {
    throw new McpAuthorizationDiscoveryError(
      "OAuth resource indicator must not include a fragment",
    );
  }

  return {
    kind: "oauth",
    authorizationServerUrl,
    metadata,
    resourceMetadata,
    resourceMetadataUrl,
    resourceUri: resource.href,
    scope: probe.scope ?? resourceMetadata.scopes_supported?.join(" "),
  };
}

type OperatorPreregistration = {
  client_id?: unknown;
  client_secret?: unknown;
  token_endpoint_auth_method?: unknown;
};

function chooseTokenEndpointAuthMethod(
  client: OAuthClientInformationMixed,
  metadata: AuthorizationServerMetadata,
  configured?: unknown,
): "none" | "client_secret_basic" | "client_secret_post" {
  const allowed = new Set([
    "none",
    "client_secret_basic",
    "client_secret_post",
  ]);
  if (typeof configured === "string") {
    if (!allowed.has(configured)) {
      throw new Error("Unsupported preregistered token_endpoint_auth_method");
    }
    if (configured !== "none" && !client.client_secret) {
      throw new Error(
        "Preregistered client authentication requires client_secret",
      );
    }
    return configured as "none" | "client_secret_basic" | "client_secret_post";
  }
  return selectClientAuthMethod(
    client,
    metadata.token_endpoint_auth_methods_supported ?? [],
  );
}

function operatorPreregistration(
  env: Pick<Env, "TAKOS_MCP_OAUTH_PREREGISTRATIONS_JSON">,
  keys: string[],
  metadata: AuthorizationServerMetadata,
): McpOAuthClientRegistration | null {
  const raw = env.TAKOS_MCP_OAUTH_PREREGISTRATIONS_JSON?.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TAKOS_MCP_OAUTH_PREREGISTRATIONS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "TAKOS_MCP_OAUTH_PREREGISTRATIONS_JSON must be a JSON object",
    );
  }
  const registrations = parsed as Record<string, OperatorPreregistration>;
  const normalizedKeys = new Set(
    keys.flatMap((key) => {
      try {
        return [key, new URL(key).href];
      } catch {
        return [key];
      }
    }),
  );
  let entry: OperatorPreregistration | undefined;
  for (const key of normalizedKeys) {
    if (registrations[key]) {
      entry = registrations[key];
      break;
    }
  }
  if (!entry) return null;
  if (typeof entry.client_id !== "string" || !entry.client_id.trim()) {
    throw new Error(
      "Preregistered MCP OAuth client_id must be a non-empty string",
    );
  }
  if (
    entry.client_secret !== undefined &&
    (typeof entry.client_secret !== "string" || !entry.client_secret)
  ) {
    throw new Error("Preregistered MCP OAuth client_secret must be a string");
  }
  const client: OAuthClientInformationMixed = {
    client_id: entry.client_id,
    ...(typeof entry.client_secret === "string"
      ? { client_secret: entry.client_secret }
      : {}),
  };
  const tokenEndpointAuthMethod = chooseTokenEndpointAuthMethod(
    client,
    metadata,
    entry.token_endpoint_auth_method,
  );
  return {
    clientId: client.client_id,
    ...(tokenEndpointAuthMethod !== "none" && client.client_secret
      ? { clientSecret: client.client_secret }
      : {}),
    registrationMode: "preregistered",
    tokenEndpointAuthMethod,
  };
}

export async function registerMcpOAuthClient(
  serverUrl: string,
  discovery: Extract<McpAuthorizationDiscovery, { kind: "oauth" }>,
  env: Env,
  spaceId: string,
  options: McpEndpointUrlOptions,
  requestedScope?: string,
): Promise<McpOAuthClientRegistration> {
  const preregistered = operatorPreregistration(
    env,
    [serverUrl, discovery.authorizationServerUrl, discovery.metadata.issuer],
    discovery.metadata,
  );
  if (preregistered) return preregistered;

  const publicUrls = resolveMcpOAuthPublicUrls(env);
  if (discovery.metadata.client_id_metadata_document_supported === true) {
    if (!isHttpsUrl(publicUrls.clientId)) {
      throw new Error("Takos MCP Client ID Metadata Document URL is invalid");
    }
    return {
      clientId: publicUrls.clientId,
      registrationMode: "client_metadata_document",
      tokenEndpointAuthMethod: "none",
    };
  }

  if (!discovery.metadata.registration_endpoint) {
    throw new McpManualRegistrationRequiredError(
      discovery.authorizationServerUrl,
    );
  }
  const fetchFn = createMcpOAuthFetch(env, spaceId, options);
  const scope = requestedScope ?? discovery.scope;
  const information = await registerClient(discovery.authorizationServerUrl, {
    metadata: discovery.metadata,
    clientMetadata: getDcrClientMetadata(env, scope),
    scope,
    fetchFn,
  });
  if (!information.redirect_uris.includes(publicUrls.redirectUri)) {
    throw new Error(
      "Dynamically registered OAuth client changed Takos redirect_uri",
    );
  }
  const tokenEndpointAuthMethod = chooseTokenEndpointAuthMethod(
    information,
    discovery.metadata,
    information.token_endpoint_auth_method,
  );
  return {
    clientId: information.client_id,
    ...(tokenEndpointAuthMethod !== "none" && information.client_secret
      ? { clientSecret: information.client_secret }
      : {}),
    clientIdIssuedAt: information.client_id_issued_at,
    clientSecretExpiresAt: information.client_secret_expires_at,
    registrationMode: "dynamic",
    tokenEndpointAuthMethod,
  };
}

export async function prepareMcpOAuthAuthorization(
  serverUrl: string,
  discovery: Extract<McpAuthorizationDiscovery, { kind: "oauth" }>,
  client: McpOAuthClientRegistration,
  env: Pick<Env, "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">,
  state: string,
  requestedScope?: string,
): Promise<PreparedMcpOAuthAuthorization> {
  const publicUrls = resolveMcpOAuthPublicUrls(env);
  const scope = requestedScope ?? discovery.scope;
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    discovery.authorizationServerUrl,
    {
      metadata: discovery.metadata,
      clientInformation: {
        client_id: client.clientId,
        ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      },
      redirectUrl: publicUrls.redirectUri,
      scope,
      state,
      resource: new URL(discovery.resourceUri),
    },
  );
  return {
    authorizationServerUrl: discovery.authorizationServerUrl,
    authorizationEndpoint: discovery.metadata.authorization_endpoint,
    tokenEndpoint: discovery.metadata.token_endpoint,
    resourceMetadataUrl: discovery.resourceMetadataUrl,
    resourceUri: discovery.resourceUri,
    scope,
    client,
    authorizationUrl,
    codeVerifier,
  };
}
