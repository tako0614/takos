import type { SelectOf } from '../../../shared/types/drizzle-utils';
import type { OAuthToken, OAuthTokenType } from '../../../shared/types/oauth';
import { oauthTokens } from '../../../infra/db';

export type OAuthTokenRow = SelectOf<typeof oauthTokens>;

export function toOptionalIsoString(value: string | Date | null | undefined): string | null {
  return (value == null ? null : typeof value === 'string' ? value : value.toISOString());
}

export interface AccessTokenJwtPayload {
  scope: string;
  client_id: string;
}

export function buildRevocationData(reason: string): {
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

export function toApiToken(row: OAuthTokenRow): OAuthToken {
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
    expires_at: (row.expiresAt == null ? null : typeof row.expiresAt === 'string' ? row.expiresAt : row.expiresAt.toISOString()),
    created_at: (row.createdAt == null ? null : typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString()),
  };
}
