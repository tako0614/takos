import * as jose from 'jose';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SelectOf } from '../../../shared/types/drizzle-helpers';
import { oauthTokens } from '../../../infra/db';
import type {
  OAuthToken,
  OAuthTokenType,
  OAuthAccessTokenPayload,
  TokenResponse,
  OAuthClient,
} from '../../../shared/types/oauth';
import { OAUTH_CONSTANTS } from '../../../shared/types/oauth';
import { generateRandomString, generateId } from './pkce';
import { computeSHA256 } from '../../../shared/utils/hash';
import { getDb } from '../../../infra/db';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { toIsoString } from '../../../shared/utils';

type OAuthTokenRow = SelectOf<typeof oauthTokens>;

function toOptionalIsoString(value: string | Date | null | undefined): string | null {
  return toIsoString(value);
}

interface AccessTokenJwtPayload {
  scope: string;
  client_id: string;
}

function buildRevocationData(reason: string): {
  revoked: true;
  revokedAt: string;
  revokedReason: string;
} {
  return {
    revoked: true,
    revokedAt: new Date().toISOString(),
    revokedReason: reason,
  };
}

const AUTHORIZATION_CODE_TOKEN_FAMILY_PREFIX = 'auth_code:';

export function buildAuthorizationCodeTokenFamily(codeId: string): string {
  return `${AUTHORIZATION_CODE_TOKEN_FAMILY_PREFIX}${codeId}`;
}

function toApiToken(row: OAuthTokenRow): OAuthToken {
  return {
    id: row.id,
    token_type: row.tokenType as OAuthTokenType,
    token_hash: row.tokenHash,
    client_id: row.clientId,
    user_id: row.accountId,
    scope: row.scope,
    refresh_token_id: row.refreshTokenId ?? null,
    revoked: row.revoked,
    revoked_at: toOptionalIsoString(row.revokedAt),
    revoked_reason: row.revokedReason ?? null,
    used_at: toOptionalIsoString(row.usedAt),
    token_family: row.tokenFamily ?? null,
    expires_at: toIsoString(row.expiresAt),
    created_at: toIsoString(row.createdAt),
  };
}

export async function generateAccessToken(params: {
  privateKeyPem: string;
  issuer: string;
  userId: string;
  clientId: string;
  scope: string;
  expiresInSeconds?: number;
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const {
    privateKeyPem,
    issuer,
    userId,
    clientId,
    scope,
    expiresInSeconds = OAUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES_IN,
  } = params;

  const privateKey = await jose.importPKCS8(privateKeyPem, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const jti = generateId();

  const token = await new jose.SignJWT({
    scope,
    client_id: clientId,
    jti,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);

  return {
    token,
    jti,
    expiresAt: new Date(exp * 1000),
  };
}

export async function verifyAccessToken(params: {
  token: string;
  publicKeyPem: string;
  issuer: string;
  expectedAudience?: string | string[];
}): Promise<OAuthAccessTokenPayload | null> {
  const { token, publicKeyPem, issuer, expectedAudience } = params;

  try {
    const publicKey = await jose.importSPKI(publicKeyPem, 'RS256');

    const verifyOptions: jose.JWTVerifyOptions = {
      issuer,
    };
    if (expectedAudience !== undefined) {
      verifyOptions.audience = expectedAudience;
    }

    const { payload } = await jose.jwtVerify<AccessTokenJwtPayload>(token, publicKey, verifyOptions);
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;

    return {
      iss: payload.iss!,
      sub: payload.sub!,
      aud: aud!,
      exp: payload.exp!,
      iat: payload.iat!,
      jti: payload.jti!,
      scope: payload.scope,
      client_id: payload.client_id,
    };
  } catch {
    return null;
  }
}


export function generateRefreshToken(): {
  token: string;
  expiresAt: Date;
} {
  const token = generateRandomString(OAUTH_CONSTANTS.REFRESH_TOKEN_LENGTH);
  const expiresAt = new Date(
    Date.now() + OAUTH_CONSTANTS.REFRESH_TOKEN_EXPIRES_IN * 1000
  );

  return { token, expiresAt };
}


export async function storeAccessToken(
  dbBinding: D1Database,
  params: {
    jti: string;
    clientId: string;
    userId: string;
    scope: string;
    expiresAt: Date;
    refreshTokenId?: string;
    tokenFamily?: string;
  }
): Promise<string> {
  const db = getDb(dbBinding);
  const id = generateId();
  const tokenHash = await computeSHA256(params.jti);

  await db.insert(oauthTokens).values({
    id,
    tokenType: 'access',
    tokenHash,
    clientId: params.clientId,
    accountId: params.userId,
    scope: params.scope,
    refreshTokenId: params.refreshTokenId ?? null,
    revoked: false,
    tokenFamily: params.tokenFamily ?? null,
    expiresAt: params.expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });

  return id;
}

export async function storeRefreshToken(
  dbBinding: D1Database,
  params: {
    token: string;
    clientId: string;
    userId: string;
    scope: string;
    expiresAt: Date;
    tokenFamily?: string;
  }
): Promise<{ id: string; tokenFamily: string }> {
  const db = getDb(dbBinding);
  const id = generateId();
  const tokenHash = await computeSHA256(params.token);
  const tokenFamily = params.tokenFamily ?? generateId();

  await db.insert(oauthTokens).values({
    id,
    tokenType: 'refresh',
    tokenHash,
    clientId: params.clientId,
    accountId: params.userId,
    scope: params.scope,
    refreshTokenId: null,
    revoked: false,
    tokenFamily,
    expiresAt: params.expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });

  return { id, tokenFamily };
}

export async function getRefreshToken(
  dbBinding: D1Database,
  token: string
): Promise<OAuthToken | null> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(token);

  const result = await db.select().from(oauthTokens).where(
    and(
      eq(oauthTokens.tokenHash, tokenHash),
      eq(oauthTokens.tokenType, 'refresh'),
      eq(oauthTokens.revoked, false),
    )
  ).get();

  if (!result) {
    return null;
  }

  return toApiToken(result);
}

export async function isAccessTokenValid(
  dbBinding: D1Database,
  jti: string
): Promise<boolean> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(jti);

  const result = await db.select({
    id: oauthTokens.id,
    expiresAt: oauthTokens.expiresAt,
  }).from(oauthTokens).where(
    and(
      eq(oauthTokens.tokenHash, tokenHash),
      eq(oauthTokens.tokenType, 'access'),
      eq(oauthTokens.revoked, false),
    )
  ).get();

  if (!result) {
    return false;
  }

  return new Date(result.expiresAt) > new Date();
}


export async function revokeTokenByHash(
  dbBinding: D1Database,
  tokenHash: string,
  reason?: string
): Promise<boolean> {
  const db = getDb(dbBinding);

  try {
    const result = await db.update(oauthTokens)
      .set(buildRevocationData(reason ?? 'revoked'))
      .where(eq(oauthTokens.tokenHash, tokenHash));

    return (result.meta.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function revokeToken(
  dbBinding: D1Database,
  token: string,
  tokenType?: 'access_token' | 'refresh_token'
): Promise<boolean> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(token);

  if (tokenType) {
    const dbType = tokenType === 'access_token' ? 'access' : 'refresh';
    const result = await db.update(oauthTokens)
      .set(buildRevocationData('user_revoked'))
      .where(
        and(
          eq(oauthTokens.tokenHash, tokenHash),
          eq(oauthTokens.tokenType, dbType),
        )
      );
    return (result.meta.changes ?? 0) > 0;
  }

  return revokeTokenByHash(dbBinding, tokenHash, 'user_revoked');
}

export async function revokeRefreshTokenAndChildren(
  dbBinding: D1Database,
  refreshTokenId: string,
  reason?: string
): Promise<void> {
  const db = getDb(dbBinding);
  const data = buildRevocationData(reason ?? 'cascade');

  await db.update(oauthTokens).set(data).where(eq(oauthTokens.id, refreshTokenId));
  await db.update(oauthTokens).set(data).where(eq(oauthTokens.refreshTokenId, refreshTokenId));
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
  clientId: string
): Promise<void> {
  await bulkRevokeTokens(
    dbBinding,
    and(eq(oauthTokens.accountId, userId), eq(oauthTokens.clientId, clientId)),
    'user_revoked_all',
  );
}

export async function revokeTokensByAuthorizationCode(
  dbBinding: D1Database,
  codeId: string,
  reason: string = 'auth_code_replay'
): Promise<number> {
  return revokeTokenFamily(dbBinding, buildAuthorizationCodeTokenFamily(codeId), reason);
}

export async function revokeAllClientTokens(
  dbBinding: D1Database,
  clientId: string
): Promise<void> {
  await bulkRevokeTokens(
    dbBinding,
    and(eq(oauthTokens.clientId, clientId)),
    'client_revoked',
  );
}


export async function markRefreshTokenAsUsed(
  dbBinding: D1Database,
  tokenId: string
): Promise<boolean> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();

  const result = await db.update(oauthTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(oauthTokens.id, tokenId),
        eq(oauthTokens.tokenType, 'refresh'),
        eq(oauthTokens.revoked, false),
        isNull(oauthTokens.usedAt),
      )
    );

  return (result.meta.changes ?? 0) > 0;
}

export async function revokeTokenFamily(
  dbBinding: D1Database,
  tokenFamily: string,
  reason: string = 'reuse_detected'
): Promise<number> {
  const db = getDb(dbBinding);

  const result = await db.update(oauthTokens)
    .set(buildRevocationData(reason))
    .where(
      and(
        eq(oauthTokens.tokenFamily, tokenFamily),
        eq(oauthTokens.revoked, false),
      )
    );

  return result.meta.changes ?? 0;
}

export async function getRefreshTokenWithReuseCheck(
  dbBinding: D1Database,
  token: string
): Promise<{ token: OAuthToken | null; isReuse: boolean }> {
  const db = getDb(dbBinding);
  const tokenHash = await computeSHA256(token);

  const result = await db.select().from(oauthTokens).where(
    and(
      eq(oauthTokens.tokenHash, tokenHash),
      eq(oauthTokens.tokenType, 'refresh'),
      eq(oauthTokens.revoked, false),
    )
  ).get();

  if (!result) {
    return { token: null, isReuse: false };
  }

  const apiToken = toApiToken(result);
  return { token: apiToken, isReuse: apiToken.used_at !== null };
}


export async function generateTokenResponse(
  dbBinding: D1Database,
  params: {
    privateKeyPem: string;
    issuer: string;
    userId: string;
    client: OAuthClient;
    scope: string;
    includeRefreshToken?: boolean;
    tokenFamily?: string;
  }
): Promise<TokenResponse> {
  const { privateKeyPem, issuer, userId, client, scope, includeRefreshToken = true, tokenFamily } = params;

  const { token: accessToken, jti, expiresAt: accessExpiresAt } = await generateAccessToken({
    privateKeyPem,
    issuer,
    userId,
    clientId: client.client_id,
    scope,
  });

  let refreshTokenId: string | undefined;
  let refreshToken: string | undefined;

  if (includeRefreshToken) {
    let grantTypes: string[];
    try {
      grantTypes = JSON.parse(client.grant_types) as string[];
    } catch {
      grantTypes = [];
    }
    if (grantTypes.includes('refresh_token')) {
      const refresh = generateRefreshToken();
      refreshToken = refresh.token;

      const stored = await storeRefreshToken(dbBinding, {
        token: refresh.token,
        clientId: client.client_id,
        userId,
        scope,
        expiresAt: refresh.expiresAt,
        tokenFamily,
      });
      refreshTokenId = stored.id;
    }
  }

  await storeAccessToken(dbBinding, {
    jti,
    clientId: client.client_id,
    userId,
    scope,
    expiresAt: accessExpiresAt,
    refreshTokenId,
    tokenFamily,
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: OAUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES_IN,
    refresh_token: refreshToken,
    scope,
  };
}

export async function rotateRefreshToken(
  dbBinding: D1Database,
  params: {
    privateKeyPem: string;
    issuer: string;
    oldRefreshToken: OAuthToken;
    client: OAuthClient;
    scope: string;
  }
): Promise<TokenResponse> {
  const { privateKeyPem, issuer, oldRefreshToken, client, scope } = params;

  const marked = await markRefreshTokenAsUsed(dbBinding, oldRefreshToken.id);
  if (!marked) {
    if (oldRefreshToken.token_family) {
      await revokeTokenFamily(dbBinding, oldRefreshToken.token_family, 'reuse_detected');
    } else {
      await revokeRefreshTokenAndChildren(dbBinding, oldRefreshToken.id, 'reuse_detected');
    }
    throw new RefreshTokenReuseDetectedError();
  }

  await revokeRefreshTokenAndChildren(dbBinding, oldRefreshToken.id, 'rotated');

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

export class RefreshTokenReuseDetectedError extends Error {
  constructor() {
    super('refresh_token_reuse_detected');
    this.name = 'RefreshTokenReuseDetectedError';
  }
}


export async function deleteExpiredTokens(dbBinding: D1Database): Promise<number> {
  const db = getDb(dbBinding);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await db.delete(oauthTokens).where(
    lt(oauthTokens.expiresAt, oneDayAgo)
  );

  return result.meta.changes ?? 0;
}
