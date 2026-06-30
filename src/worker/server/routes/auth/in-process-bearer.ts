// In-process Bearer self-validation for the unified worker.
//
// Because the unified worker origin is its own OIDC issuer (the account plane
// runs in-process inside this worker), Bearer tokens it issued can be verified
// without any external HTTP call: the JWKS is served by the same in-process
// accounts handler at `/oauth/jwks`. Hosted Takosumi uses app.takosumi.com;
// self-hosted Takos uses its own origin. This module fetches that key set
// through the in-process handler (NOT a remote URL), verifies the JWT
// signature/claims with `jose`, and resolves the local user via the existing
// `authIdentities` lookup keyed by `${issuer}#${sub}`.
import * as jose from "jose";
import { and, eq } from "drizzle-orm";
import type { Env, User } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { accounts, authIdentities, getDb } from "../../../infra/db/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import {
  type CloudflareWorkerEnv,
  handleAccountsPlaneRequest,
} from "../accounts/mount.ts";
import { extractBearerToken } from "../../middleware/bearer-token-classification.ts";

const SELF_BEARER_ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"] as const;

// In-process JWKS path served by the accounts handler (mirrors
// TAKOSUMI_ACCOUNTS_JWKS_PATH). Kept local to avoid a contract import for a
// single literal that is part of this worker's own route surface.
const SELF_JWKS_PATH = "/oauth/jwks";

export type SelfIssuedBearerResult =
  /** No `Bearer` token on the request. */
  | { kind: "no-bearer" }
  /** Issuer is not configured, so self-validation cannot run. */
  | { kind: "no-issuer" }
  /** Bearer present but failed local verification / user resolution. */
  | { kind: "invalid" }
  /** Token verified against the local JWKS and the local user resolved. */
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
 * The in-process accounts plane signs `id_token`s (`issueIdToken`) with the same
 * key it publishes at `/oauth/jwks`, but it NEVER mints JWT access tokens —
 * OAuth access/refresh tokens are opaque (`takat_` / `takrt_`) and can never
 * satisfy `jwtVerify`. So any JWT presented as a Bearer here can only be an
 * `id_token`, which must NOT be accepted as a full API access token: `id_token`s
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
 * Parse the OAuth scope claim from a verified self-issued token payload. Mirrors
 * the `scope` / `scopes` / `scp` precedence used by the remote introspection
 * path so the scope gate behaves identically for self-issued tokens.
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
 * Fetch the issuer JWKS from the in-process accounts handler. This is a direct
 * function call into the same worker — no external URL, no self-loopback fetch.
 */
async function loadLocalJwks(
  origin: string,
  env: CloudflareWorkerEnv,
): Promise<jose.JSONWebKeySet | null> {
  const response = await handleAccountsPlaneRequest(
    new Request(`${origin}${SELF_JWKS_PATH}`, {
      headers: { accept: "application/json" },
    }),
    env,
  );
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
 * Verify a self-issued Bearer token in-process and resolve the local user.
 *
 * `issuer` must be the normalized self origin (the unified worker is both
 * issuer and verifier). JWKS is loaded from the in-process accounts handler;
 * the user is resolved via the existing `authIdentities` lookup.
 */
export async function resolveSelfIssuedBearer(input: {
  authorizationHeader: string | null | undefined;
  origin: string;
  issuer: string | null;
  db: SqlDatabaseBinding | undefined;
  env: Env;
  /**
   * Test seam: override the in-process JWKS loader. Production callers omit this
   * and the real {@link loadLocalJwks} (which calls the in-process accounts
   * handler) is used.
   */
  loadJwks?: (
    origin: string,
    env: CloudflareWorkerEnv,
  ) => Promise<jose.JSONWebKeySet | null>;
}): Promise<SelfIssuedBearerResult> {
  const token = extractBearerToken(input.authorizationHeader);
  if (!token) return { kind: "no-bearer" };
  if (!input.issuer) return { kind: "no-issuer" };
  if (!input.db) return { kind: "invalid" };

  const jwks = await (input.loadJwks ?? loadLocalJwks)(
    input.origin,
    input.env as unknown as CloudflareWorkerEnv,
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

  // Refuse OIDC id_tokens: they are signed by the same in-process key the JWKS
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
