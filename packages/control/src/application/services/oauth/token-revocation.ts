import type { D1Database } from "../../../shared/types/bindings.ts";
import { oauthTokens } from "../../../infra/db/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, eq, lt } from "drizzle-orm";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import {
  buildAuthorizationCodeTokenFamily,
  buildRevocationData,
} from "./token-helpers.ts";

export async function revokeTokenByHash(
  dbBinding: D1Database,
  tokenHash: string,
  reason?: string,
): Promise<boolean> {
  const db = getDb(dbBinding);

  try {
    const result = await db.update(oauthTokens)
      .set(buildRevocationData(reason ?? "revoked"))
      .where(eq(oauthTokens.tokenHash, tokenHash));

    return (result.meta.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function revokeToken(
  dbBinding: D1Database,
  token: string,
  tokenType?: "access_token" | "refresh_token",
): Promise<boolean> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(token);

  if (tokenType) {
    const dbType = tokenType === "access_token" ? "access" : "refresh";
    const result = await db.update(oauthTokens)
      .set(buildRevocationData("user_revoked"))
      .where(
        and(
          eq(oauthTokens.tokenHash, tokenHash),
          eq(oauthTokens.tokenType, dbType),
        ),
      );
    return (result.meta.changes ?? 0) > 0;
  }

  return revokeTokenByHash(dbBinding, tokenHash, "user_revoked");
}

export async function revokeRefreshTokenAndChildren(
  dbBinding: D1Database,
  refreshTokenId: string,
  reason?: string,
): Promise<void> {
  const db = getDb(dbBinding);
  const data = buildRevocationData(reason ?? "cascade");

  await db.update(oauthTokens).set(data).where(
    eq(oauthTokens.id, refreshTokenId),
  );
  await db.update(oauthTokens).set(data).where(
    eq(oauthTokens.refreshTokenId, refreshTokenId),
  );
}

async function bulkRevokeTokens(
  dbBinding: D1Database,
  conditions: ReturnType<typeof and>,
  reason: string,
): Promise<void> {
  const db = getDb(dbBinding);

  await db.update(oauthTokens)
    .set(buildRevocationData(reason))
    .where(conditions!);
}

export async function revokeAllUserClientTokens(
  dbBinding: D1Database,
  userId: string,
  clientId: string,
): Promise<void> {
  await bulkRevokeTokens(
    dbBinding,
    and(eq(oauthTokens.accountId, userId), eq(oauthTokens.clientId, clientId)),
    "user_revoked_all",
  );
}

export async function revokeTokensByAuthorizationCode(
  dbBinding: D1Database,
  codeId: string,
  reason: string = "auth_code_replay",
): Promise<number> {
  return revokeTokenFamily(
    dbBinding,
    buildAuthorizationCodeTokenFamily(codeId),
    reason,
  );
}

export async function revokeAllClientTokens(
  dbBinding: D1Database,
  clientId: string,
): Promise<void> {
  await bulkRevokeTokens(
    dbBinding,
    and(eq(oauthTokens.clientId, clientId)),
    "client_revoked",
  );
}

export async function revokeTokenFamily(
  dbBinding: D1Database,
  tokenFamily: string,
  reason: string = "reuse_detected",
): Promise<number> {
  const db = getDb(dbBinding);

  const result = await db.update(oauthTokens)
    .set(buildRevocationData(reason))
    .where(
      and(
        eq(oauthTokens.tokenFamily, tokenFamily),
        eq(oauthTokens.revoked, false),
      ),
    );

  return result.meta.changes ?? 0;
}

export async function deleteExpiredTokens(
  dbBinding: D1Database,
): Promise<number> {
  const db = getDb(dbBinding);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await db.delete(oauthTokens).where(
    lt(oauthTokens.expiresAt, oneDayAgo),
  );

  return result.meta.changes ?? 0;
}
