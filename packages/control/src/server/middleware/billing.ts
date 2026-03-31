import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types/index.ts';
import {
  checkBillingQuota,
  type MeterType,
  type BillingCheckResult,
} from '../../application/services/billing/billing.ts';
import { ServiceUnavailableError, PaymentRequiredError } from 'takos-common/errors';
import { logError } from '../../shared/utils/logger.ts';

export type BillingVariables = {
  user?: User;
  billingCheck?: BillingCheckResult;
};

type BillingEnv = { Bindings: Env; Variables: BillingVariables };

// Must run after requireAuth (needs c.get('user')).
// Returns 402 when quota exceeded. Stores result in context for downstream usage recording.
export function billingGate(
  meterType: MeterType,
  estimateUnits?: number | ((c: Context<BillingEnv>) => number),
  options?: { shadow?: boolean }
): MiddlewareHandler<BillingEnv> {
  return async (c, next) => {
    // Read-only requests are free on all plans
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      return next();
    }

    const user = c.get('user');
    if (!user) {
      // requireAuth will reject unauthenticated access downstream
      return next();
    }

    const units = typeof estimateUnits === 'function'
      ? estimateUnits(c)
      : (estimateUnits ?? 1);

    let result: BillingCheckResult;
    try {
      result = await checkBillingQuota(c.env.DB, user.id, meterType, units);
    } catch (err) {
      logError('Failed to check billing quota', err, { module: 'billinggate' });
      throw new ServiceUnavailableError('Billing unavailable');
    }
    c.set('billingCheck', result);

    if (!result.allowed && !options?.shadow) {
      throw new PaymentRequiredError('Billing quota exceeded', {
        reason: result.reason,
        plan: result.planName,
        balance_cents: result.balanceCents,
        estimated_cost_cents: result.estimatedCostCents,
      });
    }

    await next();
  };
}
