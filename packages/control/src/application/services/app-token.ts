import * as jose from 'jose';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { D1Database } from '../../shared/types/bindings.ts';
import { getDb } from '../../infra/db/index.ts';
import { appTokens } from '../../infra/db/index.ts';
import { generateId } from '../../shared/utils/index.ts';
import { computeSHA256 } from '../../shared/utils/hash.ts';
import { validateScopes } from './oauth/scopes.ts';

export interface AppTokenResult {
  token: string;
  tokenId: string;
  scopes: string[];
  expiresAt: string;
}

export class AppTokenService {
  constructor(
    private dbBinding: D1Database,
    private signingKey: CryptoKey,
  ) {}

  /**
   * Issue a new app token with the given scopes.
   * Revokes any existing tokens for the same group.
   */
  async issueToken(params: {
    groupId: string;
    spaceId: string;
    appName: string;
    scopes: string[];
  }): Promise<AppTokenResult> {
    const { groupId, spaceId, appName, scopes } = params;

    // 1. Validate scopes against OAUTH_SCOPES
    const { valid, unknown } = validateScopes(scopes);
    if (!valid) {
      throw new Error(`Unknown scopes: ${unknown.join(', ')}`);
    }

    // 2. Revoke existing tokens for this group
    await this.revokeTokensForGroup(groupId);

    // 3. Generate JWT
    const tokenId = generateId();
    const jwt = await new jose.SignJWT({
      scope: scopes.join(' '),
      scope_space_id: spaceId,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('takos-control')
      .setSubject(`app:${appName}`)
      .setAudience('takos-api')
      .setExpirationTime('1y')
      .setIssuedAt()
      .setJti(tokenId)
      .sign(this.signingKey);

    // 4. Hash token, store in DB
    const tokenHash = await computeSHA256(jwt);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const expiresAtIso = expiresAt.toISOString();

    const db = getDb(this.dbBinding);
    await db.insert(appTokens).values({
      id: tokenId,
      groupId,
      spaceId,
      tokenHash,
      scopes: JSON.stringify(scopes),
      expiresAt: expiresAtIso,
      createdAt: now.toISOString(),
    });

    // 5. Return token + metadata
    return {
      token: jwt,
      tokenId,
      scopes,
      expiresAt: expiresAtIso,
    };
  }

  /**
   * Mark all active tokens for a group as revoked.
   * Returns the number of tokens revoked.
   */
  async revokeTokensForGroup(groupId: string): Promise<number> {
    const db = getDb(this.dbBinding);
    const now = new Date().toISOString();

    const result = await db
      .update(appTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(appTokens.groupId, groupId),
          isNull(appTokens.revokedAt),
        ),
      );

    return result.meta.changes ?? 0;
  }

  /**
   * Get the most recent non-revoked token for a group.
   */
  async getActiveToken(
    groupId: string,
  ): Promise<{ id: string; scopes: string[]; expiresAt: string | null } | null> {
    const db = getDb(this.dbBinding);

    const row = await db
      .select({
        id: appTokens.id,
        scopes: appTokens.scopes,
        expiresAt: appTokens.expiresAt,
      })
      .from(appTokens)
      .where(
        and(
          eq(appTokens.groupId, groupId),
          isNull(appTokens.revokedAt),
        ),
      )
      .orderBy(desc(appTokens.createdAt))
      .limit(1)
      .get();

    if (!row) {
      return null;
    }

    let scopes: string[];
    try {
      const parsed: unknown = JSON.parse(row.scopes);
      scopes = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      scopes = [];
    }

    return {
      id: row.id,
      scopes,
      expiresAt: row.expiresAt,
    };
  }
}
