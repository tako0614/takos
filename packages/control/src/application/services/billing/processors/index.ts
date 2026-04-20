/**
 * Payment processor factory.
 *
 * Resolves the active `PaymentProcessor` based on the `BILLING_PROCESSOR` env
 * (default: 'stripe'). Processors are cached per Env instance so route handlers
 * can call `resolvePaymentProcessor(env)` cheaply on every request.
 */

import type { Env } from "../../../../shared/types/index.ts";
import type { PaymentProcessor } from "../payment-processor.ts";
import { createStripeProcessor } from "./stripe/stripe-processor.ts";

const cache = new WeakMap<object, PaymentProcessor>();

export function resolvePaymentProcessor(env: Env): PaymentProcessor {
  const cached = cache.get(env);
  if (cached) return cached;

  const name = (env.BILLING_PROCESSOR ?? "stripe").trim().toLowerCase();
  let processor: PaymentProcessor;
  switch (name) {
    case "stripe":
      processor = createStripeProcessor(env);
      break;
    default:
      throw new Error(`Unknown BILLING_PROCESSOR: ${name}`);
  }

  cache.set(env, processor);
  return processor;
}
