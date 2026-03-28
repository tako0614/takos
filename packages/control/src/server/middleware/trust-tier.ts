/**
 * Trust tier middleware — restricts high-cost operations for new users.
 *
 * Users start at 'new' trust_tier. After 72 hours, they can be promoted to 'normal'.
 * 'trusted' is for manually promoted users.
 *
 * Usage: apply to routes that access expensive resources (agent runs, code execution, etc.)
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
import { AuthenticationError, AuthorizationError } from '@takoserver/common/errors';

type TrustTierVariables = { user?: User };
type TrustTierContext = Context<{ Bindings: Env; Variables: TrustTierVariables }>;

const TIER_ORDER = { new: 0, normal: 1, trusted: 2 } as const;

/** Check if user is at least the specified trust tier. */
function meetsMinTier(userTier: string, requiredTier: 'new' | 'normal' | 'trusted'): boolean {
  const userLevel = TIER_ORDER[userTier as keyof typeof TIER_ORDER] ?? 0;
  const requiredLevel = TIER_ORDER[requiredTier];
  return userLevel >= requiredLevel;
}

/**
 * Middleware that requires minimum trust tier.
 * Returns 403 if user's trust_tier is below the required level.
 */
export function requireTrustTier(minTier: 'normal' | 'trusted'): MiddlewareHandler<{ Bindings: Env; Variables: TrustTierVariables }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }
    if (!meetsMinTier(user.trust_tier, minTier)) {
      throw new AuthorizationError('Account too new for this operation');
    }
    await next();
  };
}

export { meetsMinTier };
