import type { D1Database } from "../../../shared/types/bindings.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { oauthClients } from "../../../infra/db/index.ts";
import type {
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  JsonStringArray,
  OAuthClient,
  OAuthClientStatus,
} from "../../../shared/types/oauth.ts";
import {
  OAUTH_CONSTANTS,
  parseJsonStringArray,
} from "../../../shared/types/oauth.ts";
import { generateId, generateRandomString } from "./pkce.ts";
import {
  computeSHA256,
  constantTimeEqual,
} from "../../../shared/utils/hash.ts";
import { parseScopes, validateScopes } from "./scopes.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, desc, eq } from "drizzle-orm";
import { textDate } from "../../../shared/utils/db-guards.ts";

type OAuthClientRow = SelectOf<typeof oauthClients>;

function toApiClient(row: OAuthClientRow): OAuthClient {
  return {
    id: row.id,
    client_id: row.clientId,
    client_secret_hash: row.clientSecretHash ?? null,
    client_type: row.clientType as "confidential" | "public",
    name: row.name,
    description: row.description ?? null,
    logo_uri: row.logoUri ?? null,
    client_uri: row.clientUri ?? null,
    policy_uri: row.policyUri ?? null,
    tos_uri: row.tosUri ?? null,
    redirect_uris: row.redirectUris as JsonStringArray,
    grant_types: row.grantTypes as JsonStringArray,
    response_types: row.responseTypes as JsonStringArray,
    allowed_scopes: row.allowedScopes as JsonStringArray,
    owner_id: row.ownerAccountId ?? null,
    registration_access_token_hash: row.registrationAccessTokenHash ?? null,
    status: row.status as OAuthClientStatus,
    created_at: textDate(row.createdAt),
    updated_at: textDate(row.updatedAt),
  };
}

export async function getClientById(
  dbBinding: D1Database,
  clientId: string,
): Promise<OAuthClient | null> {
  const db = getDb(dbBinding);

  const client = await db.select().from(oauthClients).where(
    and(
      eq(oauthClients.clientId, clientId),
      eq(oauthClients.status, "active"),
    ),
  ).get();

  if (!client) {
    return null;
  }

  return toApiClient(client);
}

export async function getClientByInternalId(
  dbBinding: D1Database,
  id: string,
): Promise<OAuthClient | null> {
  const db = getDb(dbBinding);

  const client = await db.select().from(oauthClients).where(
    eq(oauthClients.id, id),
  ).get();

  if (!client) {
    return null;
  }

  return toApiClient(client);
}

export async function getClientsByOwner(
  dbBinding: D1Database,
  ownerId: string,
): Promise<OAuthClient[]> {
  const db = getDb(dbBinding);

  const clients = await db.select().from(oauthClients)
    .where(eq(oauthClients.ownerAccountId, ownerId))
    .orderBy(desc(oauthClients.createdAt))
    .all();

  return clients.map(toApiClient);
}

export async function createClient(
  dbBinding: D1Database,
  request: ClientRegistrationRequest,
  ownerId?: string,
): Promise<ClientRegistrationResponse> {
  const db = getDb(dbBinding);

  const id = generateId();
  const clientId = generateRandomString(OAUTH_CONSTANTS.CLIENT_ID_LENGTH);
  const clientSecret = generateRandomString(
    OAUTH_CONSTANTS.CLIENT_SECRET_LENGTH,
  );
  const registrationAccessToken = generateRandomString(
    OAUTH_CONSTANTS.REGISTRATION_ACCESS_TOKEN_LENGTH,
  );

  const clientSecretHash = await computeSHA256(clientSecret);
  const registrationAccessTokenHash = await computeSHA256(
    registrationAccessToken,
  );

  const requestedScopes = request.scope ? parseScopes(request.scope) : [];
  const { valid, unknown } = validateScopes(requestedScopes);
  if (!valid) {
    throw new Error(`Unknown scopes: ${unknown.join(", ")}`);
  }

  validateRedirectUris(request.redirect_uris);

  const grantTypes = request.grant_types ??
    ["authorization_code", "refresh_token"];
  const responseTypes = request.response_types ?? ["code"];

  const clientType = request.token_endpoint_auth_method === "none"
    ? "public"
    : "confidential";

  const now = new Date().toISOString();

  await db.insert(oauthClients).values({
    id,
    clientId,
    clientSecretHash: clientType === "confidential" ? clientSecretHash : null,
    clientType,
    name: request.client_name,
    description: null,
    logoUri: request.logo_uri ?? null,
    clientUri: request.client_uri ?? null,
    policyUri: request.policy_uri ?? null,
    tosUri: request.tos_uri ?? null,
    redirectUris: JSON.stringify(request.redirect_uris) as JsonStringArray,
    grantTypes: JSON.stringify(grantTypes) as JsonStringArray,
    responseTypes: JSON.stringify(responseTypes) as JsonStringArray,
    allowedScopes: JSON.stringify(requestedScopes) as JsonStringArray,
    ownerAccountId: ownerId ?? null,
    registrationAccessTokenHash,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return {
    client_id: clientId,
    client_secret: clientType === "confidential" ? clientSecret : undefined,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    // 0 = secret never expires per RFC 7591. Expiry enforcement is not yet
    // implemented in validateClient(); changing this value to a future
    // timestamp would be misleading until the validation check is added.
    client_secret_expires_at: 0,
    registration_access_token: registrationAccessToken,
    registration_client_uri: `/oauth/register/${clientId}`,
    client_name: request.client_name,
    redirect_uris: request.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    scope: requestedScopes.join(" "),
    client_uri: request.client_uri,
    logo_uri: request.logo_uri,
    policy_uri: request.policy_uri,
    tos_uri: request.tos_uri,
  };
}

export async function updateClient(
  dbBinding: D1Database,
  clientId: string,
  updates: Partial<ClientRegistrationRequest>,
): Promise<OAuthClient | null> {
  const db = getDb(dbBinding);

  const client = await getClientById(dbBinding, clientId);
  if (!client) {
    return null;
  }

  const updateData: Record<string, unknown> = {};

  if (updates.client_name) {
    updateData.name = updates.client_name;
  }

  if (updates.redirect_uris) {
    validateRedirectUris(updates.redirect_uris);
    updateData.redirectUris = JSON.stringify(
      updates.redirect_uris,
    ) as JsonStringArray;
  }

  if (updates.logo_uri !== undefined) {
    updateData.logoUri = updates.logo_uri;
  }

  if (updates.client_uri !== undefined) {
    updateData.clientUri = updates.client_uri;
  }

  if (updates.policy_uri !== undefined) {
    updateData.policyUri = updates.policy_uri;
  }

  if (updates.tos_uri !== undefined) {
    updateData.tosUri = updates.tos_uri;
  }

  if (updates.scope !== undefined) {
    const scopes = parseScopes(updates.scope);
    const { valid, unknown } = validateScopes(scopes);
    if (!valid) {
      throw new Error(`Unknown scopes: ${unknown.join(", ")}`);
    }
    updateData.allowedScopes = JSON.stringify(scopes) as JsonStringArray;
  }

  if (Object.keys(updateData).length === 0) {
    return client;
  }

  updateData.updatedAt = new Date().toISOString();

  await db.update(oauthClients).set(updateData).where(
    eq(oauthClients.clientId, clientId),
  );

  return getClientById(dbBinding, clientId);
}

export async function deleteClient(
  dbBinding: D1Database,
  clientId: string,
): Promise<boolean> {
  return updateClientStatus(dbBinding, clientId, "revoked");
}

export async function updateClientStatus(
  dbBinding: D1Database,
  clientId: string,
  status: OAuthClientStatus,
): Promise<boolean> {
  const db = getDb(dbBinding);

  try {
    const result = await db.update(oauthClients).set({
      status,
      updatedAt: new Date().toISOString(),
    }).where(eq(oauthClients.clientId, clientId));
    return (result.meta.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function validateClientCredentials(
  dbBinding: D1Database,
  clientId: string,
  clientSecret?: string,
): Promise<{ valid: boolean; client: OAuthClient | null; error?: string }> {
  const client = await getClientById(dbBinding, clientId);

  if (!client) {
    return { valid: false, client: null, error: "Client not found" };
  }

  if (client.status !== "active") {
    return { valid: false, client: null, error: "Client is not active" };
  }

  if (client.client_type === "confidential") {
    if (!clientSecret) {
      return { valid: false, client, error: "Client secret required" };
    }

    const secretHash = await computeSHA256(clientSecret);
    if (
      !client.client_secret_hash ||
      !constantTimeEqual(secretHash, client.client_secret_hash)
    ) {
      return { valid: false, client: null, error: "Invalid client secret" };
    }
  }

  return { valid: true, client };
}

export async function validateRegistrationToken(
  dbBinding: D1Database,
  clientId: string,
  token: string,
): Promise<boolean> {
  const client = await getClientById(dbBinding, clientId);
  if (!client || !client.registration_access_token_hash) {
    return false;
  }

  const tokenHash = await computeSHA256(token);
  return constantTimeEqual(tokenHash, client.registration_access_token_hash);
}

export function validateRedirectUri(
  client: OAuthClient,
  redirectUri: string,
): boolean {
  const registeredUris = parseJsonStringArray(client.redirect_uris);
  return registeredUris.includes(redirectUri);
}

export function validateRedirectUris(uris: string[]): void {
  if (!uris || uris.length === 0) {
    throw new Error("At least one redirect_uri is required");
  }

  for (const uri of uris) {
    try {
      const parsed = new URL(uri);

      if (!parsed.protocol) {
        throw new Error(`Invalid redirect_uri: ${uri} - must be absolute URI`);
      }

      if (parsed.protocol !== "https:" && !isLocalhost(parsed.hostname)) {
        throw new Error(`Invalid redirect_uri: ${uri} - must use HTTPS`);
      }

      if (parsed.hash) {
        throw new Error(`Invalid redirect_uri: ${uri} - fragment not allowed`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Invalid redirect_uri")) {
        throw e;
      }
      throw new Error(`Invalid redirect_uri: ${uri}`);
    }
  }
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

export function supportsGrantType(
  client: OAuthClient,
  grantType: string,
): boolean {
  const grantTypes = parseJsonStringArray(client.grant_types);
  return grantTypes.includes(grantType);
}

export function getClientAllowedScopes(client: OAuthClient): string[] {
  return parseJsonStringArray(client.allowed_scopes);
}

export function getClientRedirectUris(client: OAuthClient): string[] {
  return parseJsonStringArray(client.redirect_uris);
}
