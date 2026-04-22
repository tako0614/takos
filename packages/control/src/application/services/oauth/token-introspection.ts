import type { D1Database } from "../../../shared/types/bindings.ts";
import type { OAuthToken } from "../../../shared/types/oauth.ts";
import { oauthTokens } from "../../../infra/db/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { toApiToken } from "./token-helpers.ts";

export async function getRefreshToken(
  dbBinding: D1Database,
  token: string,
): Promise<OAuthToken | null> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(token);

  const result = await db.select().from(oauthTokens).where(
    and(
      eq(oauthTokens.tokenHash, tokenHash),
      eq(oauthTokens.tokenType, "refresh"),
      eq(oauthTokens.revoked, false),
    ),
  ).get();

  if (!result) {
    return null;
  }

  return toApiToken(result);
}

export async function isAccessTokenValid(
  dbBinding: D1Database,
  jti: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(jti);

  const result = await db.select({
    id: oauthTokens.id,
    expiresAt: oauthTokens.expiresAt,
  }).from(oauthTokens).where(
    and(
      eq(oauthTokens.tokenHash, tokenHash),
      eq(oauthTokens.tokenType, "access"),
      eq(oauthTokens.revoked, false),
    ),
  ).get();

  if (!result) {
    return false;
  }

  return new Date(result.expiresAt) > new Date();
}
