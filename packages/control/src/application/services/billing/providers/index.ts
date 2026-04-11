/**
 * Payment provider factory.
 *
 * Resolves the active `PaymentProvider` based on the `BILLING_PROVIDER` env
 * (default: 'stripe'). Providers are cached per Env instance so route handlers
 * can call `resolvePaymentProvider(env)` cheaply on every request.
 */

import type { Env } from '../../../../shared/types/index.ts';
import type { PaymentProvider } from '../payment-provider.ts';
import { createStripeProvider } from './stripe/stripe-provider.ts';

const cache = new WeakMap<object, PaymentProvider>();

export function resolvePaymentProvider(env: Env): PaymentProvider {
  const cached = cache.get(env as unknown as object);
  if (cached) return cached;

  const name = (env.BILLING_PROVIDER ?? 'stripe').trim().toLowerCase();
  let provider: PaymentProvider;
  switch (name) {
    case 'stripe':
      provider = createStripeProvider(env);
      break;
    default:
      throw new Error(`Unknown BILLING_PROVIDER: ${name}`);
  }

  cache.set(env as unknown as object, provider);
  return provider;
}
