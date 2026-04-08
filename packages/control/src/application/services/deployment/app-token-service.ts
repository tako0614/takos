/**
 * App Token Service — issues scoped access tokens for deployed applications.
 *
 * When an app manifest declares top-level `scopes`, the apply engine calls
 * `issueToken()` after workload deployment so the app can authenticate back to
 * the Takos API with limited permissions.
 *
 * JWT claims (canonical, per docs/architecture/kernel.md):
 *   - sub: `group:{groupName}`
 *   - scope: space-separated scope string
 *   - space_id: tenant identifier
 *   - iss: `takos-kernel`
 *   - aud: `takos-app`
 */

import * as jose from 'jose';
import type { Env } from '../../../shared/types/env.ts';

/** 24-hour lifetime for app tokens (seconds). */
const APP_TOKEN_EXPIRES_IN = 60 * 60 * 24;

const APP_TOKEN_ISSUER = 'takos-kernel';
const APP_TOKEN_AUDIENCE = 'takos-app';

export interface AppTokenResult {
  accessToken: string;
  expiresIn: number;
  scopes: string[];
}

export const AppTokenService = {
  /**
   * Issue a scoped JWT access token for a deployed application.
   *
   * Returns `null` when `scopes` is empty — per spec, app tokens are only
   * issued when the manifest declares at least one scope. The apply engine
   * skips token injection in that case.
   */
  async issueToken(
    env: Pick<Env, 'PLATFORM_PRIVATE_KEY'>,
    params: {
      groupName: string;
      spaceId: string;
      scopes: string[];
    },
  ): Promise<AppTokenResult | null> {
    const { groupName, spaceId, scopes } = params;
    if (!scopes || scopes.length === 0) {
      return null;
    }
    const privateKey = await jose.importPKCS8(env.PLATFORM_PRIVATE_KEY, 'RS256');

    const now = Math.floor(Date.now() / 1000);
    const exp = now + APP_TOKEN_EXPIRES_IN;

    const token = await new jose.SignJWT({
      scope: scopes.join(' '),
      space_id: spaceId,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer(APP_TOKEN_ISSUER)
      .setAudience(APP_TOKEN_AUDIENCE)
      .setSubject(`group:${groupName}`)
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
