/**
 * Auth Helpers -- Shared authentication utilities.
 *
 * Extracts common PAT (Personal Access Token) validation logic that is
 * duplicated between `auth.ts` and `oauth-auth.ts` middleware.
 *
 * Both middlewares independently:
 *   1. Check if a bearer token starts with `tak_pat_`.
 *   2. Validate the token against the database.
 *   3. Load the user via `getCachedUser`.
 *   4. Return an error response when the token or user is invalid.
 *
 * This module consolidates that flow into `validatePatAndLoadUser` so
 * the two middleware files can share a single implementation.
 */

import type { Context } from 'hono';
import type { Env, User } from '../../shared/types';
import type { D1Database } from '../../shared/types/bindings';
import {
  validateTakosPersonalAccessToken,
  validateTakosAccessToken,
  type TakosAccessTokenValidation,
} from '../../application/services/identity/takos-access-tokens';
import { getCachedUser, isValidUserId } from '../../shared/utils/user-cache';
import { extractBearerToken } from '../../shared/utils';

/** Prefix used by Takos personal access tokens. */
export const PAT_PREFIX = 'tak_pat_';

/**
 * Result of a successful PAT validation.
 */
export interface PatValidationSuccess {
  user: User;
  tokenValidation: TakosAccessTokenValidation;
}

/**
 * Outcome of a PAT validation attempt.
 *
 * - `null` when the token is not a PAT (does not start with `tak_pat_`).
 * - `{ valid: false }` when the token is a PAT but validation failed.
 * - `{ valid: true, ... }` on success.
 */
export type PatValidationResult =
  | null
  | { valid: false }
  | { valid: true; user: User; tokenValidation: TakosAccessTokenValidation };

/**
 * Validate a PAT token and load the associated user.
 *
 * This is the shared core used by both session-based auth (`auth.ts`)
 * and OAuth auth (`oauth-auth.ts`) when they encounter a `tak_pat_*`
 * bearer token.
 *
 * @param c              - Hono context (used for user caching).
 * @param db             - D1 database binding for token lookup.
 * @param token          - the raw bearer token string.
 * @param requiredScopes - optional scopes the token must satisfy.
 * @returns `null` if the token is not a PAT, otherwise a result
 *          indicating whether validation succeeded.
 *
 * @example
 * ```ts
 * const bearer = extractBearerToken(c.req.header('Authorization'));
 * if (!bearer) return unauthorized(c);
 *
 * const patResult = await validatePatAndLoadUser(c, c.env.DB, bearer);
 * if (patResult === null) {
 *   // Not a PAT -- try other auth methods
 * } else if (!patResult.valid) {
 *   return c.json({ error: 'invalid_token' }, 401);
 * } else {
 *   c.set('user', patResult.user);
 * }
 * ```
 */
export async function validatePatAndLoadUser(
  c: Context<{ Bindings: Env; Variables: Record<string, unknown> }>,
  db: D1Database,
  token: string,
  requiredScopes?: string[],
): Promise<PatValidationResult> {
  if (!token.startsWith(PAT_PREFIX)) {
    return null;
  }

  const tokenResult = await validateTakosAccessToken(db, token, requiredScopes);
  if (!tokenResult || !isValidUserId(tokenResult.userId)) {
    return { valid: false };
  }

  const user = await getCachedUser(c, tokenResult.userId);
  if (!user) {
    return { valid: false };
  }

  return { valid: true, user, tokenValidation: tokenResult };
}

/**
 * Validate a bearer token that is specifically a personal access token
 * (uses `validateTakosPersonalAccessToken` rather than the combined
 * `validateTakosAccessToken` which also checks managed tokens).
 *
 * Used by `auth.ts` where only personal PATs are accepted on
 * session-auth endpoints.
 *
 * @param c     - Hono context.
 * @param db    - D1 database binding.
 * @param token - the raw `tak_pat_*` token.
 * @returns same discriminated result as {@link validatePatAndLoadUser}.
 */
export async function validatePersonalPatAndLoadUser(
  c: Context<{ Bindings: Env; Variables: Record<string, unknown> }>,
  db: D1Database,
  token: string,
): Promise<PatValidationResult> {
  if (!token.startsWith(PAT_PREFIX)) {
    return null;
  }

  const tokenResult = await validateTakosPersonalAccessToken(db, token);
  if (!tokenResult || !isValidUserId(tokenResult.userId)) {
    return { valid: false };
  }

  const user = await getCachedUser(c, tokenResult.userId);
  if (!user) {
    return { valid: false };
  }

  return { valid: true, user, tokenValidation: tokenResult };
}

/**
 * Extract a bearer token from the Authorization header.
 *
 * Re-exported for convenience so consumers only need a single import.
 */
export { extractBearerToken };
