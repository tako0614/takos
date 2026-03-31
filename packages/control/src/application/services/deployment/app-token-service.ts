/**
 * App Token Service — issues scoped access tokens for deployed applications.
 *
 * When an app manifest declares `spec.takos.scopes`, the apply engine calls
 * `issueToken()` after workload deployment so the app can authenticate back to
 * the Takos API with limited permissions.
 */

import * as jose from 'jose';
import type { Env } from '../../../shared/types/env.ts';

/** 24-hour lifetime for app tokens (seconds). */
const APP_TOKEN_EXPIRES_IN = 60 * 60 * 24;

export interface AppTokenResult {
  accessToken: string;
  expiresIn: number;
  scopes: string[];
}

function getIssuer(env: Pick<Env, 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>): string {
  return env.SERVICE_INTERNAL_JWT_ISSUER || `https://${env.ADMIN_DOMAIN}`;
}

export const AppTokenService = {
  /**
   * Issue a scoped JWT access token for a deployed application.
   *
   * The token is signed with the platform private key and encodes:
   *   - `sub`   — composite subject `app:<groupId>:<appName>`
   *   - `scope` — space-separated scopes from the manifest
   *   - `group_id` / `space_id` — resource ownership context
   */
  async issueToken(
    env: Pick<Env, 'PLATFORM_PRIVATE_KEY' | 'SERVICE_INTERNAL_JWT_ISSUER' | 'ADMIN_DOMAIN'>,
    params: {
      groupId: string;
      spaceId: string;
      appName: string;
      scopes: string[];
    },
  ): Promise<AppTokenResult> {
    const { groupId, spaceId, appName, scopes } = params;
    const issuer = getIssuer(env);
    const privateKey = await jose.importPKCS8(env.PLATFORM_PRIVATE_KEY, 'RS256');

    const now = Math.floor(Date.now() / 1000);
    const exp = now + APP_TOKEN_EXPIRES_IN;

    const token = await new jose.SignJWT({
      scope: scopes.join(' '),
      group_id: groupId,
      space_id: spaceId,
      token_type: 'app',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer(issuer)
      .setSubject(`app:${groupId}:${appName}`)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(privateKey);

    return {
      accessToken: token,
      expiresIn: APP_TOKEN_EXPIRES_IN,
      scopes,
    };
  },
};
