// Takosumi Accounts Bearer validation for the Takos product worker.
//
// Takos no longer embeds the Takosumi Accounts handler. Accounts owns opaque
// OAuth access tokens and PATs, so this resource server delegates validation to
// the configured issuer's UserInfo endpoint, then resolves the returned subject
// to the local app user via `authIdentities` keyed by `${issuer}#${sub}`.
import { and, eq } from "drizzle-orm";
import { TAKOSUMI_ACCOUNTS_USERINFO_PATH } from
  "@takosjp/takosumi-contract/identity-oidc";
import type { Env, User } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { accounts, authIdentities, getDb } from "../../../infra/db/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { extractBearerToken } from "../../middleware/bearer-token-classification.ts";
import { provisionOidcUser } from "./provisioning.ts";

const ACCOUNTS_USERINFO_TIMEOUT_MS = 10_000;

export type SelfIssuedBearerResult =
  /** No `Bearer` token on the request. */
  | { kind: "no-bearer" }
  /** Issuer is not configured, so issuer JWT validation cannot run. */
  | { kind: "no-issuer" }
  /** Bearer present but failed local verification / user resolution. */
  | { kind: "invalid" }
  /** Token verified by Accounts UserInfo and the local user resolved. */
  | {
      kind: "ok";
      user: User;
      userId: string;
      subject: string;
      scopes: string[];
      workspaceId?: string;
    };

/**
 * Parse the OAuth scope claim from Accounts UserInfo. The current contract
 * emits a space-delimited `scope`; the array aliases keep the consumer
 * tolerant of compatible OIDC providers without inspecting token shape.
 */
function parseTokenScopes(payload: Record<string, unknown>): string[] {
  const source = payload.scope ?? payload.scopes ?? payload.scp;
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

function resolveWorkspaceEvidence(
  payload: Record<string, unknown>,
): { valid: boolean; workspaceId?: string } {
  const takosumi =
    payload.takosumi &&
      typeof payload.takosumi === "object" &&
      !Array.isArray(payload.takosumi)
      ? (payload.takosumi as Record<string, unknown>)
      : undefined;
  const workspaceId = profileString(takosumi?.workspace_id);
  const memberships = Array.isArray(payload.workspace_memberships)
    ? payload.workspace_memberships
      .map(profileString)
      .filter((value): value is string => value !== undefined)
    : [];
  if (
    workspaceId &&
    memberships.length > 0 &&
    !memberships.includes(workspaceId)
  ) {
    return { valid: false };
  }
  if (workspaceId) return { valid: true, workspaceId };
  return memberships.length === 1
    ? { valid: true, workspaceId: memberships[0] }
    : { valid: true };
}

function hasAcceptedAudience(payload: Record<string, unknown>, env: Env): boolean {
  // Accounts PAT UserInfo currently has no `aud`; PAT authority is instead
  // issuer + active-token + scope based. Any ordinary OAuth response that does
  // carry `aud` must be bound to one of this Takos host's registered clients.
  if (payload.aud === undefined) return true;
  const actual = Array.isArray(payload.aud)
    ? payload.aud.filter((value): value is string => typeof value === "string")
    : typeof payload.aud === "string"
    ? [payload.aud]
    : [];
  const accepted = [env.OIDC_CLIENT_ID, env.OIDC_MOBILE_CLIENT_ID]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return accepted.length > 0 &&
    actual.some((audience) => accepted.includes(audience));
}

function normalizeAccountsBaseUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function accountsUserInfoUrl(env: Env, issuer: string): string {
  const base =
    normalizeAccountsBaseUrl(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    normalizeAccountsBaseUrl(env.OIDC_DISCOVERY_URL) ??
    issuer.replace(/\/+$/, "");
  return `${base}${TAKOSUMI_ACCOUNTS_USERINFO_PATH}`;
}

type SelfIssuedUserResolution = {
  identityFound: boolean;
  user: User | null;
};

async function resolveSelfIssuedUser(input: {
  db: SqlDatabaseBinding;
  issuer: string;
  subject: string;
}): Promise<SelfIssuedUserResolution> {
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
  if (!identity) return { identityFound: false, user: null };

  const row = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, identity.userId))
    .get();
  if (!row || row.status !== "active") {
    return { identityFound: true, user: null };
  }

  return {
    identityFound: true,
    user: {
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
    },
  };
}

function profileString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  const detail = String(error).toLowerCase();
  return detail.includes("unique constraint") ||
    detail.includes("sqlite_constraint_unique");
}

async function resolveOrProvisionSelfIssuedUser(input: {
  db: SqlDatabaseBinding;
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
}): Promise<User | null> {
  const providerSub = `${input.issuer}#${input.subject}`;
  const emailSnapshot = profileString(input.claims.email) ?? null;
  const verifiedEmail = input.claims.email_verified === true
    ? emailSnapshot
    : null;

  // A concurrent first request can observe the same missing identity. The
  // account+identity batch is atomic and the provider/sub unique index chooses
  // one winner; losers re-read that winner instead of creating another user.
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await resolveSelfIssuedUser(input);
    if (current.identityFound) return current.user;

    try {
      await provisionOidcUser(
        input.db,
        {
          subject: input.subject,
          email: verifiedEmail,
          name: profileString(input.claims.name) ??
            profileString(input.claims.preferred_username),
          picture: profileString(input.claims.picture),
        },
        {
          id: crypto.randomUUID(),
          providerSub,
          emailSnapshot,
          emailKind: verifiedEmail ? "oidc_verified" : "unknown",
        },
      );
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      // Either this exact issuer/sub won elsewhere, or another new subject
      // claimed the same owner slug. Re-read both constraints and retry.
      continue;
    }

    const provisioned = await resolveSelfIssuedUser(input);
    if (provisioned.identityFound) return provisioned.user;
  }

  return (await resolveSelfIssuedUser(input)).user;
}

/**
 * Verify a Takosumi Accounts opaque Bearer token and resolve the local user.
 *
 * Token prefixes are display/generation details, not a routing mechanism.
 * Accounts UserInfo is the authority for OAuth access tokens and PATs and also
 * rejects OIDC id_tokens, so Takos never parses or guesses the token format.
 */
export async function resolveSelfIssuedBearer(input: {
  authorizationHeader: string | null | undefined;
  issuer: string | null;
  db: SqlDatabaseBinding | undefined;
  env: Env;
  /** Test seam for the external Accounts authority. */
  fetchImpl?: typeof fetch;
}): Promise<SelfIssuedBearerResult> {
  const token = extractBearerToken(input.authorizationHeader);
  if (!token) return { kind: "no-bearer" };
  if (!input.issuer) return { kind: "no-issuer" };
  if (!input.db) return { kind: "invalid" };

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      new Request(accountsUserInfoUrl(input.env, input.issuer), {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(ACCOUNTS_USERINFO_TIMEOUT_MS),
      }),
    );
  } catch {
    return { kind: "invalid" };
  }
  if (!response.ok) return { kind: "invalid" };
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "invalid" };
  }
  const claims = payload as Record<string, unknown>;
  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  if (!subject) return { kind: "invalid" };
  if (!hasAcceptedAudience(claims, input.env)) return { kind: "invalid" };
  const workspace = resolveWorkspaceEvidence(claims);
  if (!workspace.valid) return { kind: "invalid" };

  const user = await resolveOrProvisionSelfIssuedUser({
    db: input.db,
    issuer: input.issuer,
    subject,
    claims,
  });
  if (!user) return { kind: "invalid" };

  return {
    kind: "ok",
    user,
    userId: user.id,
    subject,
    scopes: parseTokenScopes(claims),
    ...(workspace.workspaceId
      ? { workspaceId: workspace.workspaceId }
      : {}),
  };
}
