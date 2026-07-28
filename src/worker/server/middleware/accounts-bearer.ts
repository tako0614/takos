import type { Context } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import { ALL_API_BEARER_SCOPES } from "../../shared/types/api-scopes.ts";
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
  isUnsupportedAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";
import { resolveSelfIssuedBearer } from "../routes/auth/in-process-bearer.ts";

function normalizeConfiguredUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
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

const readCompatibleScopes = new Set([
  "openid",
  "profile",
  "email",
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
  resolveSelfIssuedBearer: typeof resolveSelfIssuedBearer;
  getCachedUser: typeof getCachedUser;
  isValidUserId: typeof isValidUserId;
  getPlatformServices: typeof getPlatformServices;
  getPlatformConfig: typeof getPlatformConfig;
}

/**
 * Verified Takosumi Accounts authority retained only for this request. This
 * lets an explicit facade consumer forward the inbound access token without
 * requiring a browser-stored refresh-token delegation. Never persist or log
 * this value.
 */
export interface AccountsBearerAuthContext {
  accessToken: string;
  subjectId: string;
  workspaceId: string;
  scopes: string[];
}

export type ResolveAccountsBearerResult =
  /** No `Bearer` token on the request. */
  | { kind: "no-bearer" }
  /** Token carries an unsupported app-local prefix (`tak_pat_` / `tak_oat_`). */
  | { kind: "unsupported-app-local-bearer" }
  /** Token is a Bearer but is not a Takosumi Accounts candidate. */
  | { kind: "not-accounts" }
  /** Accounts candidate but no SQL binding is configured. */
  | { kind: "no-db" }
  /** Self-issued verification rejected the token (bad signature / expired). */
  | { kind: "invalid" }
  /** Token valid but missing one of `requiredScopes`. */
  | { kind: "scope-insufficient"; scopes: string[] }
  /** Token valid but the resolved user id has no cached user record. */
  | { kind: "user-not-found" }
  /** Token valid and the cached user resolved. */
  | {
      kind: "ok";
      user: User;
      userId: string;
      scopes: string[];
      accountsBearer?: AccountsBearerAuthContext;
    };

/**
 * Single-sourced Takosumi Accounts Bearer pipeline: extraction →
 * unsupported app-local bearer / Accounts-candidate classification →
 * configured Accounts UserInfo verification → `getCachedUser`
 * (+ optional scope gate).
 * Both `resolveRequestUser` (cookie-or-bearer) and `requireOAuthAuth`
 * (bearer-only, scoped) consume this and map the returned `kind` to their own
 * status codes / response shapes.
 */
export function resolveAccountsBearer<TVariables extends object>(
  c: Context<{ Bindings: Env; Variables: TVariables }>,
  deps: AccountsBearerResolverDeps,
  options: { requiredScopes?: string[] } = {},
): Promise<ResolveAccountsBearerResult> {
  return resolveAccountsBearerFromHeader(
    c,
    deps,
    c.req.header("Authorization"),
    options,
  );
}

/**
 * Same pipeline as {@link resolveAccountsBearer} but with an explicit
 * `Authorization` header string. Git Smart HTTP authenticates with HTTP Basic
 * (`password` = access token), so the git route decodes Basic → `Bearer
 * <token>` and reuses this single-sourced verification path.
 */
export async function resolveAccountsBearerFromHeader<
  TVariables extends object,
>(
  c: Context<{ Bindings: Env; Variables: TVariables }>,
  deps: AccountsBearerResolverDeps,
  authorizationHeader: string | null | undefined,
  options: { requiredScopes?: string[] } = {},
): Promise<ResolveAccountsBearerResult> {
  const bearer = extractBearerToken(authorizationHeader);
  if (!bearer) return { kind: "no-bearer" };

  if (isUnsupportedAppLocalBearerToken(bearer)) {
    return { kind: "unsupported-app-local-bearer" };
  }

  if (!isTakosumiAccountsBearerCandidate(bearer)) {
    return { kind: "not-accounts" };
  }

  const dbBinding = deps.getPlatformServices(c).sql?.binding;
  if (!dbBinding) return { kind: "no-db" };

  const issuer = normalizeConfiguredUrl(
    deps.getPlatformConfig(c).oidcIssuerUrl,
  );

  const selfBearer = await deps.resolveSelfIssuedBearer({
    authorizationHeader,
    issuer: issuer ?? null,
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
  return {
    kind: "ok",
    user,
    userId: selfBearer.userId,
    scopes,
    // Only expose forwarding authority when UserInfo binds the token to one
    // exact Workspace. General Takos user authentication still succeeds
    // without it, but Workspace-scoped Interface/Capsule facades fail closed.
    ...(selfBearer.workspaceId
      ? {
          accountsBearer: {
            accessToken: bearer,
            subjectId: selfBearer.subject,
            workspaceId: selfBearer.workspaceId,
            scopes,
          },
        }
      : {}),
  };
}
