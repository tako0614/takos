import { and, eq, isNull, lt, or } from "drizzle-orm";

import { getDb } from "../../../infra/db/index.ts";
import { authIdentities } from "../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  decryptEnvelope,
  encryptEnvelope,
} from "../../../shared/utils/crypto.ts";
import {
  AuthenticationError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

const ACCESS_TOKEN_SKEW_MS = 15_000;
const REFRESH_LEASE_MS = 15_000;
const REFRESH_WAIT_MS = 100;
const REFRESH_WAIT_ATTEMPTS = 60;
const TOKEN_FETCH_TIMEOUT_MS = 10_000;

export const TAKOS_ACCOUNTS_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "capsules:read",
  "capsules:write",
] as const;

type DelegatedTokenResponse = {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
};

type DelegationAccess = "read" | "write";

type DelegationIdentity = {
  readonly id: string;
  readonly providerSub: string;
  readonly accessTokenEnc: string | null;
  readonly accessTokenExpiresAt: string | null;
  readonly refreshTokenEnc: string | null;
  readonly tokenScope: string | null;
  readonly delegatedWorkspaceId: string | null;
  readonly refreshLeaseId: string | null;
  readonly refreshLeaseExpiresAt: string | null;
};

export type AccountsDelegatedAuthorization = {
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly subjectId: string;
};

const refreshes = new Map<string, Promise<AccountsDelegatedAuthorization>>();

function tokenSalt(identityId: string, kind: "access" | "refresh"): string {
  return `takos:accounts-oidc:${identityId}:${kind}`;
}

function scopeAllows(scope: string | null, access: DelegationAccess): boolean {
  const scopes = new Set((scope ?? "").split(/\s+/u).filter(Boolean));
  return access === "write"
    ? scopes.has("capsules:write")
    : scopes.has("capsules:read") || scopes.has("capsules:write");
}

function validAccessToken(
  identity: DelegationIdentity,
  access: DelegationAccess,
): boolean {
  if (!identity.accessTokenEnc || !scopeAllows(identity.tokenScope, access)) {
    return false;
  }
  const expiresAt = Date.parse(identity.accessTokenExpiresAt ?? "");
  return (
    Number.isFinite(expiresAt) && expiresAt > Date.now() + ACCESS_TOKEN_SKEW_MS
  );
}

function delegatedSubjectId(
  identity: DelegationIdentity,
  issuer: string,
): string {
  const prefix = `${issuer}#`;
  const subjectId = identity.providerSub.startsWith(prefix)
    ? identity.providerSub.slice(prefix.length).trim()
    : "";
  if (!subjectId) {
    throw new AuthenticationError(
      "Takosumi Accounts identity subject is invalid",
    );
  }
  return subjectId;
}

async function identityForUser(
  db: ReturnType<typeof getDb>,
  userId: string,
  issuer: string,
): Promise<DelegationIdentity | undefined> {
  const rows = await db
    .select({
      id: authIdentities.id,
      providerSub: authIdentities.providerSub,
      accessTokenEnc: authIdentities.accessTokenEnc,
      accessTokenExpiresAt: authIdentities.accessTokenExpiresAt,
      refreshTokenEnc: authIdentities.refreshTokenEnc,
      tokenScope: authIdentities.tokenScope,
      delegatedWorkspaceId: authIdentities.delegatedWorkspaceId,
      refreshLeaseId: authIdentities.refreshLeaseId,
      refreshLeaseExpiresAt: authIdentities.refreshLeaseExpiresAt,
    })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.userId, userId),
        eq(authIdentities.provider, "oidc"),
      ),
    )
    .all();
  const prefix = `${issuer}#`;
  return rows.find((row) => row.providerSub.startsWith(prefix));
}

export async function storeAccountsDelegation(input: {
  readonly db: SqlDatabaseBinding;
  readonly encryptionKey: string;
  readonly identityId: string;
  readonly tokens: DelegatedTokenResponse;
  readonly fallbackScope: string;
  readonly workspaceId?: string;
  readonly now?: number;
}): Promise<void> {
  const accessToken = input.tokens.access_token?.trim();
  if (!accessToken) return;
  if (!input.encryptionKey) {
    throw new Error("ENCRYPTION_KEY is required for Accounts OAuth delegation");
  }
  const now = input.now ?? Date.now();
  const expiresIn = Number.isFinite(input.tokens.expires_in)
    ? Math.max(1, Math.floor(input.tokens.expires_in!))
    : 300;
  const accessTokenEnc = await encryptEnvelope(
    accessToken,
    input.encryptionKey,
    tokenSalt(input.identityId, "access"),
  );
  const refreshToken = input.tokens.refresh_token?.trim();
  const refreshTokenEnc = refreshToken
    ? await encryptEnvelope(
        refreshToken,
        input.encryptionKey,
        tokenSalt(input.identityId, "refresh"),
      )
    : undefined;
  const scope = input.tokens.scope?.trim() || input.fallbackScope;
  if (scopeAllows(scope, "read") && !input.workspaceId) {
    throw new Error(
      "Takosumi Accounts Workspace binding is required for Capsule delegation",
    );
  }
  await getDb(input.db)
    .update(authIdentities)
    .set({
      accessTokenEnc,
      accessTokenExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
      tokenScope: scope,
      delegatedWorkspaceId: input.workspaceId ?? null,
      ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
      refreshLeaseId: null,
      refreshLeaseExpiresAt: null,
    })
    .where(eq(authIdentities.id, input.identityId));
}

export async function accountsDelegatedAuthorization(input: {
  readonly db: SqlDatabaseBinding;
  readonly encryptionKey: string;
  readonly userId: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly access: DelegationAccess;
}): Promise<AccountsDelegatedAuthorization> {
  const key = `${input.userId}:${input.issuer}:${input.access}`;
  const current = refreshes.get(key);
  if (current) return await current;
  const pending = resolveAccountsDelegatedAuthorization(input).finally(() => {
    if (refreshes.get(key) === pending) refreshes.delete(key);
  });
  refreshes.set(key, pending);
  return await pending;
}

async function resolveAccountsDelegatedAuthorization(input: {
  readonly db: SqlDatabaseBinding;
  readonly encryptionKey: string;
  readonly userId: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly access: DelegationAccess;
}): Promise<AccountsDelegatedAuthorization> {
  if (!input.encryptionKey) {
    throw new ServiceUnavailableError(
      "Accounts OAuth delegation encryption is not configured",
    );
  }
  const db = getDb(input.db);
  let identity = await identityForUser(db, input.userId, input.issuer);
  if (!identity) {
    throw new AuthenticationError(
      "Takosumi Accounts authorization is required",
    );
  }
  if (!identity.delegatedWorkspaceId) {
    throw new AuthenticationError(
      "Takosumi Accounts Workspace authorization must be renewed",
    );
  }
  if (validAccessToken(identity, input.access)) {
    return {
      accessToken: await decryptEnvelope(
        identity.accessTokenEnc!,
        input.encryptionKey,
        tokenSalt(identity.id, "access"),
      ),
      workspaceId: identity.delegatedWorkspaceId,
      subjectId: delegatedSubjectId(identity, input.issuer),
    };
  }
  if (!identity.refreshTokenEnc) {
    throw new AuthenticationError(
      "Takosumi Accounts authorization must be renewed",
    );
  }

  const leaseId = crypto.randomUUID();
  const now = Date.now();
  const claimed = await db
    .update(authIdentities)
    .set({
      refreshLeaseId: leaseId,
      refreshLeaseExpiresAt: new Date(now + REFRESH_LEASE_MS).toISOString(),
    })
    .where(
      and(
        eq(authIdentities.id, identity.id),
        or(
          isNull(authIdentities.refreshLeaseExpiresAt),
          lt(authIdentities.refreshLeaseExpiresAt, new Date(now).toISOString()),
        ),
      ),
    )
    .returning({ id: authIdentities.id })
    .all();

  if (claimed.length === 0) {
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
      identity = await identityForUser(db, input.userId, input.issuer);
      if (!identity) break;
      if (!identity.delegatedWorkspaceId) {
        throw new AuthenticationError(
          "Takosumi Accounts Workspace authorization must be renewed",
        );
      }
      if (validAccessToken(identity, input.access)) {
        return {
          accessToken: await decryptEnvelope(
            identity.accessTokenEnc!,
            input.encryptionKey,
            tokenSalt(identity.id, "access"),
          ),
          workspaceId: identity.delegatedWorkspaceId,
          subjectId: delegatedSubjectId(identity, input.issuer),
        };
      }
      const leaseExpiresAt = Date.parse(identity.refreshLeaseExpiresAt ?? "");
      if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= Date.now()) {
        return await resolveAccountsDelegatedAuthorization(input);
      }
    }
    throw new ServiceUnavailableError(
      "Takosumi Accounts authorization refresh timed out",
    );
  }

  try {
    const refreshToken = await decryptEnvelope(
      identity.refreshTokenEnc,
      input.encryptionKey,
      tokenSalt(identity.id, "refresh"),
    );
    const tokenUrl = new URL("/oauth/token", input.issuer);
    const tokenBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: input.clientId,
    });
    if (input.clientSecret?.trim()) {
      tokenBody.set("client_secret", input.clientSecret.trim());
    }
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
    });
    const tokens = (await response
      .json()
      .catch(() => ({}))) as DelegatedTokenResponse;
    if (!response.ok || !tokens.access_token) {
      await clearDelegation(db, identity.id, leaseId);
      throw new AuthenticationError(
        "Takosumi Accounts authorization must be renewed",
      );
    }
    const scope = tokens.scope?.trim() || identity.tokenScope || "";
    if (!scopeAllows(scope, input.access)) {
      await clearDelegation(db, identity.id, leaseId);
      throw new AuthenticationError(
        "Takosumi Accounts authorization scope is insufficient",
      );
    }
    const accessTokenEnc = await encryptEnvelope(
      tokens.access_token,
      input.encryptionKey,
      tokenSalt(identity.id, "access"),
    );
    const refreshTokenEnc = tokens.refresh_token
      ? await encryptEnvelope(
          tokens.refresh_token,
          input.encryptionKey,
          tokenSalt(identity.id, "refresh"),
        )
      : identity.refreshTokenEnc;
    const expiresIn = Number.isFinite(tokens.expires_in)
      ? Math.max(1, Math.floor(tokens.expires_in!))
      : 300;
    await db
      .update(authIdentities)
      .set({
        accessTokenEnc,
        accessTokenExpiresAt: new Date(
          Date.now() + expiresIn * 1000,
        ).toISOString(),
        refreshTokenEnc,
        tokenScope: scope,
        refreshLeaseId: null,
        refreshLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(authIdentities.id, identity.id),
          eq(authIdentities.refreshLeaseId, leaseId),
        ),
      );
    return {
      accessToken: tokens.access_token,
      workspaceId: identity.delegatedWorkspaceId,
      subjectId: delegatedSubjectId(identity, input.issuer),
    };
  } catch (error) {
    await db
      .update(authIdentities)
      .set({ refreshLeaseId: null, refreshLeaseExpiresAt: null })
      .where(
        and(
          eq(authIdentities.id, identity.id),
          eq(authIdentities.refreshLeaseId, leaseId),
        ),
      );
    throw error;
  }
}

async function clearDelegation(
  db: ReturnType<typeof getDb>,
  identityId: string,
  leaseId: string,
): Promise<void> {
  await db
    .update(authIdentities)
    .set({
      accessTokenEnc: null,
      accessTokenExpiresAt: null,
      refreshTokenEnc: null,
      tokenScope: null,
      delegatedWorkspaceId: null,
      refreshLeaseId: null,
      refreshLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(authIdentities.id, identityId),
        eq(authIdentities.refreshLeaseId, leaseId),
      ),
    );
}
