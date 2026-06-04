import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import { ALL_API_BEARER_SCOPES } from "../../shared/types/api-scopes.ts";
import { accounts, authIdentities, getDb } from "../../infra/db/index.ts";
import { provisionOidcUser } from "../routes/auth/provisioning.ts";
import {
  getCachedUser,
  isValidUserId,
} from "../../application/services/identity/user-cache.ts";
import {
  getPlatformConfig,
  getPlatformServices,
} from "../../platform/accessors.ts";
import {
  extractBearerToken,
  isRetiredAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";
import { resolveSelfIssuedBearer } from "../routes/auth/in-process-bearer.ts";

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

function requestOrigin(requestUrl: string): string | undefined {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return undefined;
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
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

/**
 * Dependency seam for the shared Bearer pipeline. `auth.ts`'s `authDeps` and
 * `oauth-auth.ts`'s `oauthAuthDeps` both expose these members so tests can
 * override them; `resolveAccountsBearer` reads them through the passed `deps`
 * object rather than the module bindings so those overrides take effect.
 */
export interface AccountsBearerResolverDeps {
  validateTakosumiAccountsBearer: typeof validateTakosumiAccountsBearer;
  getCachedUser: typeof getCachedUser;
  isValidUserId: typeof isValidUserId;
  getPlatformServices: typeof getPlatformServices;
  getPlatformConfig: typeof getPlatformConfig;
}

export type ResolveAccountsBearerResult =
  /** No `Bearer` token on the request. */
  | { kind: "no-bearer" }
  /** Token carries a retired app-local prefix (`tak_pat_` / `tak_oat_`). */
  | { kind: "retired" }
  /** Token is a Bearer but is not a Takosumi Accounts candidate. */
  | { kind: "not-accounts" }
  /** Accounts candidate but no SQL binding is configured. */
  | { kind: "no-db" }
  /** Introspection rejected the token (inactive / expired / scope-short). */
  | { kind: "invalid" }
  /** Token valid but missing one of `requiredScopes`. */
  | { kind: "scope-insufficient"; scopes: string[] }
  /** Token valid but the resolved user id has no cached user record. */
  | { kind: "user-not-found" }
  /** Token valid and the cached user resolved. */
  | { kind: "ok"; user: User; userId: string; scopes: string[] };

/**
 * Single-sourced Takosumi Accounts Bearer pipeline: extraction → retired/
 * candidate classification → 4-config introspection plumbing → validate →
 * `getCachedUser` (+ optional scope gate). Both `resolveRequestUser`
 * (cookie-or-bearer) and `requireOAuthAuth` (bearer-only, scoped) consume this
 * and map the returned `kind` to their own status codes / response shapes.
 */
export async function resolveAccountsBearer(
  c: Context<{ Bindings: Env; Variables: object }>,
  deps: AccountsBearerResolverDeps,
  options: { requiredScopes?: string[] } = {},
): Promise<ResolveAccountsBearerResult> {
  const bearer = extractBearerToken(c.req.header("Authorization"));
  if (!bearer) return { kind: "no-bearer" };

  if (isRetiredAppLocalBearerToken(bearer)) return { kind: "retired" };

  if (!isTakosumiAccountsBearerCandidate(bearer)) return { kind: "not-accounts" };

  const dbBinding = deps.getPlatformServices(c).sql?.binding;
  if (!dbBinding) return { kind: "no-db" };

  const config = deps.getPlatformConfig(c);

  // Self-issuer short-circuit: when the configured issuer host is this worker's
  // own origin (app.takosumi.com is its own OIDC issuer), the token can be
  // verified in-process against the local JWKS instead of a remote
  // /oauth/introspect call. The accounts handler that serves the JWKS runs in
  // the same worker.
  const issuer = normalizeConfiguredUrl(config.oidcIssuerUrl);
  const origin = requestOrigin(c.req.url);
  if (issuer && origin && sameHost(issuer, origin)) {
    const selfBearer = await resolveSelfIssuedBearer({
      authorizationHeader: c.req.header("Authorization"),
      origin,
      issuer,
      db: dbBinding,
      env: c.env,
    });
    if (selfBearer.kind !== "ok") return { kind: "invalid" };

    const scopes = expandTakosumiAccountsPatScopes(selfBearer.scopes);
    if (!deps.isValidUserId(selfBearer.userId)) return { kind: "invalid" };
    if (
      options.requiredScopes?.length &&
      !options.requiredScopes.every((required) => scopes.includes(required))
    ) {
      return { kind: "scope-insufficient", scopes };
    }

    const user = await deps.getCachedUser(c, selfBearer.userId);
    if (!user) return { kind: "user-not-found" };
    return { kind: "ok", user, userId: selfBearer.userId, scopes };
  }

  const validated = await deps.validateTakosumiAccountsBearer({
    db: dbBinding,
    token: bearer,
    issuerUrl: config.oidcIssuerUrl,
    discoveryUrl: config.oidcDiscoveryUrl,
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
    requiredScopes: options.requiredScopes,
  });
  if (!validated || !deps.isValidUserId(validated.userId)) {
    return { kind: "invalid" };
  }

  if (
    options.requiredScopes?.length &&
    !options.requiredScopes.every((required) =>
      validated.scopes.includes(required)
    )
  ) {
    return { kind: "scope-insufficient", scopes: validated.scopes };
  }

  const user = await deps.getCachedUser(c, validated.userId);
  if (!user) return { kind: "user-not-found" };

  return { kind: "ok", user, userId: validated.userId, scopes: validated.scopes };
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
