import type { MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
import {
  checkWeeklyRuntimeLimit,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
  WEEKLY_RUNTIME_WINDOW_DAYS,
} from '../../application/services/billing/billing';
import { PaymentRequiredError } from '@takoserver/common/errors';
import { logError } from '../../shared/utils/logger';

type PlanGateVariables = {
  user?: User;
};

type PlanGateEnv = {
  Bindings: Env;
  Variables: PlanGateVariables;
};

// Must run after requireAuth (needs c.get('user')).
export function requireWeeklyRuntimeLimitForAgent(options?: {
  estimateSeconds?: number;
  windowDays?: number;
  limitSeconds?: number;
  shadow?: boolean;
}): MiddlewareHandler<PlanGateEnv> {
  const estimateSeconds = options?.estimateSeconds ?? 0;
  const windowDays = options?.windowDays ?? WEEKLY_RUNTIME_WINDOW_DAYS;
  const limitSeconds = options?.limitSeconds ?? WEEKLY_RUNTIME_LIMIT_SECONDS;

  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }

    const user = c.get('user');
    if (!user) {
      await next();
      return;
    }

    let check;
    try {
      check = await checkWeeklyRuntimeLimit(c.env.DB, user.id, estimateSeconds, {
        windowDays,
        limitSeconds,
      });
    } catch (err) {
      logError('Failed to check weekly runtime limit', err, { module: 'plangate' });
      // Allow request through on check failure to avoid blocking users
      await next();
      return;
    }

    if (!check.allowed && !options?.shadow) {
      if (check.retryAfterSeconds > 0) {
        c.header('Retry-After', String(check.retryAfterSeconds));
      }
      throw new PaymentRequiredError('Weekly runtime limit exceeded', {
        reason: `Weekly runtime limit reached (${check.usedSeconds}/${check.limitSeconds} seconds in rolling ${check.windowDays}-day window)`,
        used_seconds_7d: check.usedSeconds,
        limit_seconds_7d: check.limitSeconds,
        retry_after_seconds: check.retryAfterSeconds,
      });
    }

    await next();
  };
}
