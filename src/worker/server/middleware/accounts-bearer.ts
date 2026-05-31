import { and, eq } from "drizzle-orm";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import { ALL_API_BEARER_SCOPES } from "../../shared/types/api-scopes.ts";
import { accounts, authIdentities, getDb } from "../../infra/db/index.ts";
import { provisionOidcUser } from "../routes/auth/provisioning.ts";

type AccountsDiscoveryDocument = {
  issuer?: string;
  introspection_endpoint?: string;
};

type AccountsIntrospectionResponse = {
  active?: boolean;
  sub?: unknown;
  scope?: unknown;
  scopes?: unknown;
  scp?: unknown;
  iss?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  picture?: unknown;
  "takosumi.account_id"?: unknown;
  account_id?: unknown;
};

export type AccountsBearerValidation = {
  userId: string;
  scopes: string[];
  tokenKind: "takosumi_accounts";
  issuer: string;
  subject: string;
};

export const accountsBearerDeps = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  getDb,
  provisionOidcUser,
  randomUUID: () => crypto.randomUUID(),
  nowSeconds: () => Math.floor(Date.now() / 1000),
};

export async function validateTakosumiAccountsBearer(input: {
  db: SqlDatabaseBinding;
  token: string;
  issuerUrl?: string;
  discoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
  requiredScopes?: string[];
}): Promise<AccountsBearerValidation | null> {
  const issuer = normalizeConfiguredUrl(input.issuerUrl);
  const discoveryBaseUrl = normalizeConfiguredUrl(input.discoveryUrl) ?? issuer;
  if (!input.token || !issuer || !discoveryBaseUrl) {
    return null;
  }

  const discovery = await discoverAccounts(discoveryBaseUrl, issuer).catch(
    () => null,
  );
  if (!discovery?.introspection_endpoint) {
    return null;
  }

  const introspectionEndpoint = serverAccountsEndpoint(
    discovery.introspection_endpoint,
    discoveryBaseUrl,
  );
  const body = await introspectAccountsBearer({
    endpoint: introspectionEndpoint,
    token: input.token,
    clientId: nonEmptyString(input.clientId),
    clientSecret: nonEmptyString(input.clientSecret),
  }).catch(() => null);
  if (!body?.active) {
    return null;
  }

  if (
    typeof body.iss === "string" &&
    normalizeConfiguredUrl(body.iss) !== issuer
  ) {
    return null;
  }
  const now = accountsBearerDeps.nowSeconds();
  if (typeof body.exp === "number" && body.exp <= now) return null;
  if (typeof body.nbf === "number" && body.nbf > now + 60) return null;

  const subject = stringClaim(body.sub) ??
    stringClaim(body["takosumi.account_id"]) ??
    stringClaim(body.account_id);
  if (!subject) return null;

  const scopes = parseIntrospectionScopes(body);
  if (!hasRequiredScopes(scopes, input.requiredScopes)) {
    return null;
  }

  const userId = await resolveAccountsBearerUser({
    db: input.db,
    issuer,
    subject,
    email: stringClaim(body.email),
    emailVerified: body.email_verified === true,
    name: stringClaim(body.name) ?? stringClaim(body.preferred_username),
    picture: stringClaim(body.picture),
  });
  if (!userId) return null;

  return {
    userId,
    scopes,
    tokenKind: "takosumi_accounts",
    issuer,
    subject,
  };
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeConfiguredUrl(value: string | undefined): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function discoveryUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${
    url.pathname.replace(/\/+$/, "")
  }/.well-known/openid-configuration`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function discoverAccounts(
  discoveryBaseUrl: string,
  expectedIssuer: string,
): Promise<AccountsDiscoveryDocument> {
  const response = await accountsBearerDeps.fetch(
    discoveryUrl(discoveryBaseUrl),
    {
      headers: { accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Accounts discovery returned ${response.status}`);
  }
  const body = await response.json() as Record<string, unknown>;
  if (
    typeof body.issuer === "string" &&
    normalizeConfiguredUrl(body.issuer) !== expectedIssuer
  ) {
    throw new Error("Accounts discovery issuer mismatch");
  }
  return {
    issuer: typeof body.issuer === "string" ? body.issuer : undefined,
    introspection_endpoint: typeof body.introspection_endpoint === "string"
      ? new URL(body.introspection_endpoint).toString()
      : undefined,
  };
}

function serverAccountsEndpoint(
  endpoint: string,
  discoveryBaseUrl: string,
): string {
  const publicUrl = new URL(endpoint);
  const serverUrl = new URL(discoveryBaseUrl);
  serverUrl.pathname = publicUrl.pathname;
  serverUrl.search = publicUrl.search;
  serverUrl.hash = "";
  return serverUrl.toString();
}

async function introspectAccountsBearer(input: {
  endpoint: string;
  token: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<AccountsIntrospectionResponse> {
  const body = new URLSearchParams({
    token: input.token,
    token_type_hint: "access_token",
  });
  if (input.clientId) body.set("client_id", input.clientId);
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  const response = await accountsBearerDeps.fetch(input.endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Accounts introspection returned ${response.status}`);
  }
  return await response.json() as AccountsIntrospectionResponse;
}

function stringClaim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIntrospectionScopes(
  body: AccountsIntrospectionResponse,
): string[] {
  const source = body.scope ?? body.scopes ?? body.scp;
  let scopes: string[];
  if (typeof source === "string") {
    scopes = source.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  } else if (Array.isArray(source)) {
    scopes = source.filter((scope): scope is string =>
      typeof scope === "string" && scope.trim().length > 0
    ).map((scope) => scope.trim());
  } else {
    scopes = [];
  }
  return expandTakosumiAccountsPatScopes(scopes);
}

function hasRequiredScopes(
  scopes: string[],
  requiredScopes?: string[],
): boolean {
  if (!requiredScopes?.length) return true;
  return requiredScopes.every((scope) => scopes.includes(scope));
}

const readCompatibleScopes = new Set([
  "openid",
  "profile",
  "email",
  "events:subscribe",
  ...ALL_API_BEARER_SCOPES.filter((scope) => scope.endsWith(":read")),
]);

const writeCompatibleScopes = new Set([
  ...readCompatibleScopes,
  ...ALL_API_BEARER_SCOPES.filter((scope) => scope.endsWith(":write")),
]);

export function expandTakosumiAccountsPatScopes(scopes: string[]): string[] {
  const expanded = new Set(scopes);
  if (expanded.has("admin")) {
    for (const scope of ALL_API_BEARER_SCOPES) expanded.add(scope);
    return [...expanded];
  }
  if (expanded.has("write")) {
    for (const scope of writeCompatibleScopes) expanded.add(scope);
  }
  if (expanded.has("read")) {
    for (const scope of readCompatibleScopes) expanded.add(scope);
  }
  return [...expanded];
}

async function resolveAccountsBearerUser(input: {
  db: SqlDatabaseBinding;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}): Promise<string | null> {
  const db = accountsBearerDeps.getDb(input.db);
  const providerSub = `${input.issuer}#${input.subject}`;
  const identity = await db.select({
    userId: authIdentities.userId,
  }).from(authIdentities).where(
    and(
      eq(authIdentities.provider, "oidc"),
      eq(authIdentities.providerSub, providerSub),
    ),
  ).get();

  if (identity) {
    const user = await db.select({
      id: accounts.id,
      status: accounts.status,
    }).from(accounts).where(eq(accounts.id, identity.userId)).get();
    if (!user || user.status !== "active") {
      return null;
    }
    const timestamp = new Date().toISOString();
    await db.update(authIdentities).set({
      lastLoginAt: timestamp,
      emailSnapshot: input.email,
    }).where(
      and(
        eq(authIdentities.provider, "oidc"),
        eq(authIdentities.providerSub, providerSub),
      ),
    );
    return user.id;
  }

  const user = await accountsBearerDeps.provisionOidcUser(input.db, {
    subject: input.subject,
    email: input.emailVerified ? input.email : null,
    name: input.name,
    picture: input.picture,
  });
  const timestamp = new Date().toISOString();
  await db.insert(authIdentities).values({
    id: accountsBearerDeps.randomUUID(),
    userId: user.id,
    provider: "oidc",
    providerSub,
    emailSnapshot: input.email,
    emailKind: input.emailVerified ? "oidc_verified" : "unknown",
    linkedAt: timestamp,
    lastLoginAt: timestamp,
  });
  return user.id;
}
