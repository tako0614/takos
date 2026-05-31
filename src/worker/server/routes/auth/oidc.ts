import { Hono } from "hono";
import * as jose from "jose";
import {
  createOIDCState,
  createSession,
  deleteOIDCState,
  getOIDCState,
  setSessionCookie,
} from "../../../application/services/identity/session.ts";
import {
  auditLog,
  cleanupUserSessions,
  createAuthSession,
} from "../../../application/services/identity/auth-utils.ts";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateRandomString,
} from "../../../application/services/identity/oidc-pkce.ts";
import { getDb } from "../../../infra/db/index.ts";
import { accounts, authIdentities } from "../../../infra/db/schema.ts";
import {
  getPlatformConfig,
  getPlatformServices,
} from "../../../platform/accessors.ts";
import { logError } from "../../../shared/utils/logger.ts";
import type { OptionalAuthRouteEnv } from "../route-auth.ts";
import { errorPage } from "./html.ts";
import { provisionOidcUser, sanitizeReturnTo } from "./provisioning.ts";
import { and, eq } from "drizzle-orm";
import {
  type TtlMs,
  ttlMs,
  type TtlSeconds,
  ttlSeconds,
} from "@takos/worker-platform-utils/ttl";

export const authOidcRouter = new Hono<OptionalAuthRouteEnv>();

const OIDC_STATE_TTL_MS: TtlMs = ttlMs(10 * 60 * 1000);
const SESSION_MAX_AGE_SECONDS: TtlSeconds = ttlSeconds(7 * 24 * 60 * 60);
// OIDC discovery/token/JWKS/userinfo all run on the interactive login path.
// Cap each upstream call at 10s so login fails fast rather than hanging.
const OIDC_FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_ID_TOKEN_ALGORITHMS = new Set([
  "RS256",
  "PS256",
  "ES256",
  "EdDSA",
]);

type OidcDiscoveryDocument = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
};

type OidcTokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
};

type OidcUser = {
  id: string;
  email: string | null;
  name: string;
  username: string;
  bio: string | null;
  picture: string | null;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
};

type ResolvedOidcProfile = {
  accountEmail: string | null;
  emailSnapshot: string | null;
  emailKind: "oidc_verified" | "unknown";
  name?: string;
  picture?: string;
};

// SECURITY: No per-route rate limit. Each request issues an `oidc_state`
// store write + an outbound discovery fetch (cached but still cold on first
// hit per worker). Without an operator-tier limiter (CDN / WAF), this can be
// abused to spray state writes and to amplify upstream OIDC issuer traffic.
// See SECURITY.md "Per-route rate limiting".
authOidcRouter.get("/oidc/login", async (c) => {
  const returnTo = sanitizeReturnTo(c.req.query("return_to"));
  const config = getPlatformConfig(c);
  const sessionStore = getPlatformServices(c).notifications.sessionStore;
  const issuer = normalizeConfiguredUrl(config.oidcIssuerUrl);
  const discoveryBaseUrl = normalizeConfiguredUrl(config.oidcDiscoveryUrl) ??
    issuer;
  const clientId = nonEmptyString(config.oidcClientId);
  const redirectUri = normalizeConfiguredUrl(
    config.oidcRedirectUri ?? defaultOidcRedirectUri(config.adminDomain),
  );

  if (
    !sessionStore || !issuer || !discoveryBaseUrl || !clientId || !redirectUri
  ) {
    return c.html(
      errorPage(
        "OIDC Error",
        "Takosumi Accounts OIDC is not configured.",
        "/",
        "Back",
      ),
      500,
    );
  }

  let discovery;
  try {
    discovery = await discoverOidc(discoveryBaseUrl, issuer);
  } catch {
    return c.html(
      errorPage(
        "OIDC Error",
        "Takosumi Accounts discovery failed.",
        "/",
        "Back",
      ),
      502,
    );
  }

  const state = generateRandomString(32);
  const nonce = generateRandomString(32);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier, "S256");
  await createOIDCState(sessionStore, {
    state,
    nonce,
    code_verifier: codeVerifier,
    return_to: returnTo,
    expires_at: Date.now() + OIDC_STATE_TTL_MS,
  });

  const authorizationUrl = new URL(discovery.authorization_endpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return c.redirect(authorizationUrl.toString());
});

// SECURITY: No per-route rate limit. The callback performs token exchange,
// JWKS verification, DB writes (account upsert, identity link), session
// creation, and audit log writes per request. Without an operator-tier
// limiter (CDN / WAF), an attacker can replay garbage `?code=...&state=...`
// to spam upstream IdP token endpoints and burn DB writes. See SECURITY.md.
authOidcRouter.get("/oidc/callback", async (c) => {
  const config = getPlatformConfig(c);
  const services = getPlatformServices(c);
  const dbBinding = services.sql?.binding;
  const sessionStore = services.notifications.sessionStore;
  const issuer = normalizeConfiguredUrl(config.oidcIssuerUrl);
  const discoveryBaseUrl = normalizeConfiguredUrl(config.oidcDiscoveryUrl) ??
    issuer;
  const clientId = nonEmptyString(config.oidcClientId);
  const clientSecret = nonEmptyString(config.oidcClientSecret);
  const redirectUri = normalizeConfiguredUrl(
    config.oidcRedirectUri ?? defaultOidcRedirectUri(config.adminDomain),
  );
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const error = c.req.query("error");

  if (error) {
    await auditLog("oidc_error", { error });
    return c.html(errorPage("OIDC Error", String(error), "/", "Back"), 400);
  }
  if (!code || !state) {
    return c.html(
      errorPage("OIDC Error", "Missing OIDC code or state.", "/", "Back"),
      400,
    );
  }
  if (
    !dbBinding || !sessionStore || !issuer || !discoveryBaseUrl || !clientId ||
    !redirectUri
  ) {
    return c.html(
      errorPage(
        "OIDC Error",
        "Takosumi Accounts OIDC is not configured.",
        "/",
        "Back",
      ),
      500,
    );
  }

  const oidcState = await getOIDCState(sessionStore, state);
  if (!oidcState) {
    await auditLog("oidc_invalid_state", { state });
    return c.html(
      errorPage("OIDC Error", "Invalid OIDC state.", "/", "Back"),
      400,
    );
  }
  await deleteOIDCState(sessionStore, state);

  let discovery;
  try {
    discovery = await discoverOidc(discoveryBaseUrl, issuer);
  } catch {
    return c.html(
      errorPage(
        "OIDC Error",
        "Takosumi Accounts discovery failed.",
        "/",
        "Back",
      ),
      502,
    );
  }

  const serverTokenEndpoint = serverOidcEndpoint(
    discovery.token_endpoint,
    discoveryBaseUrl,
  );
  const serverJwksUri = serverOidcEndpoint(
    discovery.jwks_uri,
    discoveryBaseUrl,
  );
  const serverUserinfoEndpoint = discovery.userinfo_endpoint
    ? serverOidcEndpoint(discovery.userinfo_endpoint, discoveryBaseUrl)
    : undefined;

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode({
      tokenEndpoint: serverTokenEndpoint,
      code,
      clientId,
      clientSecret,
      redirectUri,
      codeVerifier: oidcState.code_verifier,
    });
  } catch (error) {
    logError("OIDC token exchange failed", error, {
      module: "routes/auth/oidc",
    });
    return c.html(
      errorPage("OIDC Error", "Token exchange failed.", "/", "Back"),
      400,
    );
  }

  let claims;
  try {
    claims = await verifyIdToken({
      idToken: requireString(tokens.id_token),
      jwksUri: serverJwksUri,
      issuer,
      audience: clientId,
      nonce: oidcState.nonce,
    });
  } catch (error) {
    logError("OIDC id_token verification failed", error, {
      module: "routes/auth/oidc",
    });
    return c.html(
      errorPage("OIDC Error", "Invalid ID token.", "/", "Back"),
      400,
    );
  }

  const subject = requireString(claims.sub);
  const userInfo = tokens.access_token && serverUserinfoEndpoint
    ? await fetchUserInfo(serverUserinfoEndpoint, tokens.access_token)
    : {};
  try {
    assertUserInfoSubject(userInfo, subject);
  } catch (error) {
    logError("OIDC userinfo validation failed", error, {
      module: "routes/auth/oidc",
    });
    return c.html(
      errorPage("OIDC Error", "Invalid UserInfo response.", "/", "Back"),
      400,
    );
  }
  const profile = resolveOidcProfile(claims, userInfo);
  const db = getDb(dbBinding);
  const providerSub = oidcProviderSub(issuer, subject);
  const identity = await db.select({
    userId: authIdentities.userId,
  }).from(authIdentities).where(
    and(
      eq(authIdentities.provider, "oidc"),
      eq(authIdentities.providerSub, providerSub),
    ),
  ).get();

  let user: OidcUser | null = null;
  if (identity) {
    const userRow = await db.select({
      id: accounts.id,
      email: accounts.email,
      name: accounts.name,
      slug: accounts.slug,
      status: accounts.status,
      bio: accounts.bio,
      picture: accounts.picture,
      setupCompleted: accounts.setupCompleted,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
    }).from(accounts).where(eq(accounts.id, identity.userId)).get();

    if (userRow) {
      if (userRow.status !== "active") {
        await auditLog("oidc_inactive_account", {
          userId: userRow.id,
          status: userRow.status,
        });
        return c.html(
          errorPage(
            "OIDC Error",
            "This account is not available.",
            "/",
            "Back",
          ),
          403,
        );
      }
      user = oidcUserFromRow(userRow);
    }

    await db.update(authIdentities).set({
      lastLoginAt: new Date().toISOString(),
      emailSnapshot: profile.emailSnapshot,
    }).where(
      and(
        eq(authIdentities.provider, "oidc"),
        eq(authIdentities.providerSub, providerSub),
      ),
    );
  } else {
    user = await provisionOidcUser(dbBinding, {
      subject,
      email: profile.accountEmail,
      name: profile.name,
      picture: profile.picture,
    });

    const timestamp = new Date().toISOString();
    await db.insert(authIdentities).values({
      id: crypto.randomUUID(),
      userId: user.id,
      provider: "oidc",
      providerSub,
      emailSnapshot: profile.emailSnapshot,
      emailKind: profile.emailKind,
      linkedAt: timestamp,
      lastLoginAt: timestamp,
    });
  }

  if (!user) {
    return c.html(
      errorPage("OIDC Error", "Failed to resolve user account.", "/", "Back"),
      500,
    );
  }

  const session = await createSession(sessionStore, user.id);
  const userAgent = c.req.header("User-Agent");
  const ipAddress = c.req.header("CF-Connecting-IP");
  await createAuthSession(dbBinding, user.id, userAgent, ipAddress);
  await cleanupUserSessions(dbBinding, user.id, 5);
  await auditLog("oidc_success", { userId: user.id, subject });

  return new Response(null, {
    status: 302,
    headers: {
      "Location": user.setup_completed
        ? sanitizeReturnTo(oidcState.return_to)
        : "/setup",
      "Set-Cookie": setSessionCookie(session.id, SESSION_MAX_AGE_SECONDS),
    },
  });
});

function defaultOidcRedirectUri(adminDomain: string): string | undefined {
  const domain = nonEmptyString(adminDomain);
  return domain ? `https://${domain}/auth/oidc/callback` : undefined;
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

function discoveryUrl(issuer: string): string {
  const url = new URL(issuer);
  url.pathname = `${
    url.pathname.replace(/\/+$/, "")
  }/.well-known/openid-configuration`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function discoverOidc(
  discoveryBaseUrl: string,
  expectedIssuer: string,
): Promise<OidcDiscoveryDocument> {
  const response = await fetch(discoveryUrl(discoveryBaseUrl), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OIDC discovery returned ${response.status}`);
  }
  const body = await response.json() as Record<string, unknown>;
  if (
    typeof body.issuer === "string" &&
    normalizeConfiguredUrl(body.issuer) !== expectedIssuer
  ) {
    throw new Error("OIDC discovery issuer mismatch");
  }
  if (
    typeof body.authorization_endpoint !== "string" ||
    typeof body.token_endpoint !== "string" ||
    typeof body.jwks_uri !== "string"
  ) {
    throw new Error("OIDC discovery missing required endpoints");
  }
  return {
    authorization_endpoint: new URL(body.authorization_endpoint).toString(),
    token_endpoint: new URL(body.token_endpoint).toString(),
    jwks_uri: new URL(body.jwks_uri).toString(),
    userinfo_endpoint: typeof body.userinfo_endpoint === "string"
      ? new URL(body.userinfo_endpoint).toString()
      : undefined,
  };
}

function serverOidcEndpoint(
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

async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OidcTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OIDC token endpoint returned ${response.status}`);
  }
  return await response.json() as OidcTokenResponse;
}

async function verifyIdToken(input: {
  idToken: string;
  jwksUri: string;
  issuer: string;
  audience: string;
  nonce: string;
}): Promise<jose.JWTPayload> {
  const jwksResponse = await fetch(input.jwksUri, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
  });
  if (!jwksResponse.ok) {
    throw new Error(`OIDC JWKS returned ${jwksResponse.status}`);
  }
  const jwks = await jwksResponse.json() as { keys?: unknown };
  if (!Array.isArray(jwks.keys)) throw new Error("OIDC JWKS has no keys");
  const header = jose.decodeProtectedHeader(input.idToken);
  const algorithm = requireString(header.alg);
  if (algorithm.toLowerCase() === "none") {
    throw new Error("OIDC id_token cannot use alg=none");
  }
  if (!ALLOWED_ID_TOKEN_ALGORITHMS.has(algorithm)) {
    throw new Error("OIDC id_token algorithm is not allowed");
  }
  const key = jwks.keys.find((candidate) =>
    isJwk(candidate) &&
    (!header.kid || candidate.kid === header.kid) &&
    (!candidate.alg || candidate.alg === header.alg) &&
    (!candidate.use || candidate.use === "sig") &&
    (
      !Array.isArray(candidate.key_ops) ||
      candidate.key_ops.includes("verify")
    )
  );
  if (!isJwk(key)) throw new Error("OIDC signing key not found");
  const publicKey = await jose.importJWK(key, algorithm);
  const { payload } = await jose.jwtVerify(input.idToken, publicKey, {
    issuer: input.issuer,
    audience: input.audience,
    algorithms: [algorithm],
  });
  requireString(payload.sub);
  if (typeof payload.exp !== "number") {
    throw new Error("OIDC id_token missing exp");
  }
  if (typeof payload.iat !== "number") {
    throw new Error("OIDC id_token missing iat");
  }
  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : typeof payload.aud === "string"
    ? [payload.aud]
    : [];
  if (audiences.length > 1 && payload.azp !== input.audience) {
    throw new Error("OIDC id_token azp mismatch");
  }
  if (payload.azp !== undefined && payload.azp !== input.audience) {
    throw new Error("OIDC id_token azp mismatch");
  }
  if (payload.nonce !== input.nonce) {
    throw new Error("OIDC nonce mismatch");
  }
  return payload;
}

async function fetchUserInfo(
  endpoint: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
    });
    return response.ok ? await response.json() as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("missing required string");
  }
  return value;
}

function profileString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertUserInfoSubject(
  userInfo: Record<string, unknown>,
  subject: string,
): void {
  const userInfoSubject = profileString(userInfo.sub);
  if (userInfoSubject && userInfoSubject !== subject) {
    throw new Error("OIDC UserInfo sub mismatch");
  }
}

function resolveOidcProfile(
  claims: jose.JWTPayload,
  userInfo: Record<string, unknown>,
): ResolvedOidcProfile {
  const idTokenEmail = profileString(claims.email);
  const userInfoEmail = profileString(userInfo.email);
  const idTokenEmailVerified = claims.email_verified === true;
  const userInfoEmailVerified = userInfo.email_verified === true;
  const verifiedEmail = idTokenEmailVerified
    ? idTokenEmail
    : userInfoEmailVerified
    ? userInfoEmail
    : undefined;

  return {
    accountEmail: verifiedEmail ?? null,
    emailSnapshot: userInfoEmail ?? idTokenEmail ?? null,
    emailKind: verifiedEmail ? "oidc_verified" : "unknown",
    name: profileString(userInfo.name) ?? profileString(claims.name) ??
      profileString(claims.preferred_username),
    picture: profileString(userInfo.picture) ?? profileString(claims.picture),
  };
}

function oidcProviderSub(issuer: string, subject: string): string {
  return `${issuer}#${subject}`;
}

function oidcUserFromRow(row: {
  id: string;
  email: string | null;
  name: string;
  slug: string;
  bio: string | null;
  picture: string | null;
  setupCompleted: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}): OidcUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.slug,
    bio: row.bio,
    picture: row.picture,
    setup_completed: row.setupCompleted,
    created_at: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : row.createdAt,
    updated_at: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : row.updatedAt,
  };
}

function isJwk(value: unknown): value is jose.JWK & {
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
} {
  return typeof value === "object" && value !== null &&
    typeof (value as { kty?: unknown }).kty === "string";
}
