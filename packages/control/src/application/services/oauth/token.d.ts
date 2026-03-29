import type { D1Database } from '../../../shared/types/bindings.ts';
import type { OAuthToken, OAuthAccessTokenPayload, TokenResponse, OAuthClient } from '../../../shared/types/oauth';
export declare function buildAuthorizationCodeTokenFamily(codeId: string): string;
export declare function generateAccessToken(params: {
    privateKeyPem: string;
    issuer: string;
    userId: string;
    clientId: string;
    scope: string;
    expiresInSeconds?: number;
}): Promise<{
    token: string;
    jti: string;
    expiresAt: Date;
}>;
export declare function verifyAccessToken(params: {
    token: string;
    publicKeyPem: string;
    issuer: string;
    expectedAudience?: string | string[];
}): Promise<OAuthAccessTokenPayload | null>;
export declare function generateRefreshToken(): {
    token: string;
    expiresAt: Date;
};
export declare function storeAccessToken(dbBinding: D1Database, params: {
    jti: string;
    clientId: string;
    userId: string;
    scope: string;
    expiresAt: Date;
    refreshTokenId?: string;
    tokenFamily?: string;
}): Promise<string>;
export declare function storeRefreshToken(dbBinding: D1Database, params: {
    token: string;
    clientId: string;
    userId: string;
    scope: string;
    expiresAt: Date;
    tokenFamily?: string;
}): Promise<{
    id: string;
    tokenFamily: string;
}>;
export declare function getRefreshToken(dbBinding: D1Database, token: string): Promise<OAuthToken | null>;
export declare function isAccessTokenValid(dbBinding: D1Database, jti: string): Promise<boolean>;
export declare function revokeTokenByHash(dbBinding: D1Database, tokenHash: string, reason?: string): Promise<boolean>;
export declare function revokeToken(dbBinding: D1Database, token: string, tokenType?: 'access_token' | 'refresh_token'): Promise<boolean>;
export declare function revokeRefreshTokenAndChildren(dbBinding: D1Database, refreshTokenId: string, reason?: string): Promise<void>;
export declare function revokeAllUserClientTokens(dbBinding: D1Database, userId: string, clientId: string): Promise<void>;
export declare function revokeTokensByAuthorizationCode(dbBinding: D1Database, codeId: string, reason?: string): Promise<number>;
export declare function revokeAllClientTokens(dbBinding: D1Database, clientId: string): Promise<void>;
export declare function markRefreshTokenAsUsed(dbBinding: D1Database, tokenId: string): Promise<boolean>;
export declare function revokeTokenFamily(dbBinding: D1Database, tokenFamily: string, reason?: string): Promise<number>;
export declare function getRefreshTokenWithReuseCheck(dbBinding: D1Database, token: string): Promise<{
    token: OAuthToken | null;
    isReuse: boolean;
}>;
export declare function generateTokenResponse(dbBinding: D1Database, params: {
    privateKeyPem: string;
    issuer: string;
    userId: string;
    client: OAuthClient;
    scope: string;
    includeRefreshToken?: boolean;
    tokenFamily?: string;
}): Promise<TokenResponse>;
export declare function rotateRefreshToken(dbBinding: D1Database, params: {
    privateKeyPem: string;
    issuer: string;
    oldRefreshToken: OAuthToken;
    client: OAuthClient;
    scope: string;
}): Promise<TokenResponse>;
export declare class RefreshTokenReuseDetectedError extends Error {
    constructor();
}
export declare function deleteExpiredTokens(dbBinding: D1Database): Promise<number>;
//# sourceMappingURL=token.d.ts.map