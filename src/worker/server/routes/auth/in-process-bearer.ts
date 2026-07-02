// Takosumi Accounts Bearer validation for the Takos product worker.
//
// Takos no longer embeds the Takosumi Accounts handler. JWT access tokens are
// verified against the configured issuer's JWKS over HTTP, then resolved to the
// local app user via `authIdentities` keyed by `${issuer}#${sub}`.
import * as jose from "jose";
import { and, eq } from "drizzle-orm";
import type { Env, User } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { accounts, authIdentities, getDb } from "../../../infra/db/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { extractBearerToken } from "../../middleware/bearer-token-classification.ts";

const SELF_BEARER_ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"] as const;

// Mirrors TAKOSUMI_ACCOUNTS_JWKS_PATH without importing the account worker.
const SELF_JWKS_PATH = "/oauth/jwks";

export type SelfIssuedBearerResult =
  /** No `Bearer` token on the request. */
  | { kind: "no-bearer" }
  /** Issuer is not configured, so issuer JWT validation cannot run. */
  | { kind: "no-issuer" }
  /** Bearer present but failed local verification / user resolution. */
  | { kind: "invalid" }
  /** Token verified against the issuer JWKS and the local user resolved. */
  | {
      kind: "ok";
      user: User;
      userId: string;
      subject: string;
      scopes: string[];
    };

/**
 * Whether a verified JWT payload is an OIDC `id_token` rather than an OAuth
 * access token.
 *
 * Takosumi Accounts signs `id_token`s with the same key it publishes at
 * `/oauth/jwks`, while some deployments may also mint JWT access tokens. A JWT
 * `id_token` presented as a Bearer here must NOT be accepted as a full API
 * access token: `id_token`s
 * routinely leak through front-channel redirect URLs, `id_token_hint`
 * parameters, and logs, and are treated as lower-sensitivity than access tokens.
 *
 * We reject `id_token`s by their hallmark OIDC claims (an `aud` set to the
 * relying-party `client_id`, or an OIDC `nonce` / `auth_time`) and only allow a
 * JWT that positively declares itself an access token (an OAuth `scope`/`scp` or
 * a `token_use` marker). This stays forward-compatible if JWT access tokens
 * (e.g. RFC 9068 `at+jwt`, which carry `scope`) are ever introduced.
 */
export function isOidcIdToken(payload: jose.JWTPayload): boolean {
  const claims = payload as Record<string, unknown>;
  const hasAccessTokenMarker = typeof claims.token_use === "string" ||
    claims.scope !== undefined ||
    claims.scopes !== undefined ||
    claims.scp !== undefined;
  if (hasAccessTokenMarker) return false;
  return (
    claims.aud !== undefined ||
    claims.nonce !== undefined ||
    claims.auth_time !== undefined
  );
}

/**
 * Parse the OAuth scope claim from a verified issuer JWT payload. Mirrors
 * the `scope` / `scopes` / `scp` precedence used by the remote introspection
 * path so the scope gate behaves identically for issuer JWT tokens.
 */
function parseTokenScopes(payload: jose.JWTPayload): string[] {
  const source =
    (payload as Record<string, unknown>).scope ??
    (payload as Record<string, unknown>).scopes ??
    (payload as Record<string, unknown>).scp;
  if (typeof source === "string") {
    return source
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  if (Array.isArray(source)) {
    return source
      .filter(
        (scope): scope is string =>
          typeof scope === "string" && scope.trim().length > 0,
      )
      .map((scope) => scope.trim());
  }
  return [];
}

/**
 * Fetch the configured Takosumi Accounts issuer JWKS.
 */
async function loadIssuerJwks(
  issuer: string,
  _env: Env,
): Promise<jose.JSONWebKeySet | null> {
  const base = issuer.replace(/\/+$/g, "");
  const response = await fetch(`${base}${SELF_JWKS_PATH}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = (await response
    .json()
    .catch(() => null)) as jose.JSONWebKeySet | null;
  if (!body || !Array.isArray(body.keys)) return null;
  return body;
}

async function resolveSelfIssuedUser(input: {
  db: SqlDatabaseBinding;
  issuer: string;
  subject: string;
}): Promise<User | null> {
  const db = getDb(input.db);
  const providerSub = `${input.issuer}#${input.subject}`;
  const identity = await db
    .select({
      userId: authIdentities.userId,
    })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, "oidc"),
        eq(authIdentities.providerSub, providerSub),
      ),
    )
    .get();
  if (!identity) return null;

  const row = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, identity.userId))
    .get();
  if (!row || row.status !== "active") return null;

  return {
    id: row.id,
    principal_id: undefined,
    email: row.email ?? "",
    name: row.name,
    username: row.slug,
    principal_kind: "user",
    bio: row.bio,
    picture: row.picture,
    trust_tier: row.trustTier,
    setup_completed: row.setupCompleted,
    created_at: textDate(row.createdAt),
    updated_at: textDate(row.updatedAt),
  };
}

/**
 * Verify a Takosumi Accounts JWT Bearer token and resolve the local user.
 *
 * `issuer` must be the normalized Takosumi Accounts issuer. The user is
 * resolved via the existing `authIdentities` lookup.
 */
export async function resolveSelfIssuedBearer(input: {
  authorizationHeader: string | null | undefined;
  origin: string;
  issuer: string | null;
  db: SqlDatabaseBinding | undefined;
  env: Env;
  /**
   * Test seam: override the JWKS loader. Production callers omit this and the
   * real {@link loadIssuerJwks} is used.
   */
  loadJwks?: (
    issuer: string,
    env: Env,
  ) => Promise<jose.JSONWebKeySet | null>;
}): Promise<SelfIssuedBearerResult> {
  const token = extractBearerToken(input.authorizationHeader);
  if (!token) return { kind: "no-bearer" };
  if (!input.issuer) return { kind: "no-issuer" };
  if (!input.db) return { kind: "invalid" };

  const jwks = await (input.loadJwks ?? loadIssuerJwks)(
    input.issuer,
    input.env,
  );
  if (!jwks) return { kind: "invalid" };

  let payload: jose.JWTPayload;
  try {
    const keySet = jose.createLocalJWKSet(jwks);
    ({ payload } = await jose.jwtVerify(token, keySet, {
      issuer: input.issuer,
      algorithms: [...SELF_BEARER_ALGORITHMS],
    }));
  } catch {
    return { kind: "invalid" };
  }

  // Refuse OIDC id_tokens: they are signed by the same issuer key the JWKS
  // serves, so a relying party's id_token (or any captured id_token) would
  // otherwise be accepted as a full API access token. Only opaque access tokens
  // are legitimate, and those never reach this JWT path.
  if (isOidcIdToken(payload)) {
    return { kind: "invalid" };
  }

  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) return { kind: "invalid" };

  const user = await resolveSelfIssuedUser({
    db: input.db,
    issuer: input.issuer,
    subject,
  });
  if (!user) return { kind: "invalid" };

  return {
    kind: "ok",
    user,
    userId: user.id,
    subject,
    scopes: parseTokenScopes(payload),
  };
}
