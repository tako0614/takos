import type { D1Database } from "../../../shared/types/bindings.ts";
import type {
  OAuthClient,
  OAuthToken,
  TokenResponse,
} from "../../../shared/types/oauth.ts";
import { oauthTokens } from "../../../infra/db/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, eq, isNull } from "drizzle-orm";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { toApiToken } from "./token-helpers.ts";
import {
  revokeRefreshTokenAndChildren,
  revokeTokenFamily,
} from "./token-revocation.ts";
import { generateTokenResponse } from "./token-grants.ts";

export class RefreshTokenReuseDetectedError extends Error {
  constructor() {
    super("refresh_token_reuse_detected");
    this.name = "RefreshTokenReuseDetectedError";
  }
}

export async function markRefreshTokenAsUsed(
  dbBinding: D1Database,
  tokenId: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();

  const result = await db.update(oauthTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(oauthTokens.id, tokenId),
        eq(oauthTokens.tokenType, "refresh"),
        eq(oauthTokens.revoked, false),
        isNull(oauthTokens.usedAt),
      ),
    );

  return (result.meta.changes ?? 0) > 0;
}

export async function getRefreshTokenWithReuseCheck(
  dbBinding: D1Database,
  token: string,
): Promise<{ token: OAuthToken | null; isReuse: boolean }> {
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
    return { token: null, isReuse: false };
  }

  const apiToken = toApiToken(result);
  return { token: apiToken, isReuse: apiToken.used_at !== null };
}

export async function rotateRefreshToken(
  dbBinding: D1Database,
  params: {
    privateKeyPem: string;
    issuer: string;
    oldRefreshToken: OAuthToken;
    client: OAuthClient;
    scope: string;
  },
): Promise<TokenResponse> {
  const { privateKeyPem, issuer, oldRefreshToken, client, scope } = params;

  const marked = await markRefreshTokenAsUsed(dbBinding, oldRefreshToken.id);
  if (!marked) {
    if (oldRefreshToken.token_family) {
      await revokeTokenFamily(
        dbBinding,
        oldRefreshToken.token_family,
        "reuse_detected",
      );
    } else {
      await revokeRefreshTokenAndChildren(
        dbBinding,
        oldRefreshToken.id,
        "reuse_detected",
      );
    }
    throw new RefreshTokenReuseDetectedError();
  }

  await revokeRefreshTokenAndChildren(dbBinding, oldRefreshToken.id, "rotated");

  return generateTokenResponse(dbBinding, {
    privateKeyPem,
    issuer,
    userId: oldRefreshToken.user_id,
    client,
    scope,
    includeRefreshToken: true,
    tokenFamily: oldRefreshToken.token_family ?? undefined,
  });
}
