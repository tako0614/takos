import * as jose from 'jose';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type {
  OAuthAccessTokenPayload,
  TokenResponse,
  OAuthClient,
} from '../../../shared/types/oauth';
import { OAUTH_CONSTANTS, parseJsonStringArray } from '../../../shared/types/oauth';
import { generateRandomString, generateId } from './pkce';
import { computeSHA256 } from '../../../shared/utils/hash';
import { getDb } from '../../../infra/db';
import { oauthTokens } from '../../../infra/db';
import type { AccessTokenJwtPayload } from './token-helpers';

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
    const grantTypes = parseJsonStringArray(client.grant_types);
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
