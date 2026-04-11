/**
 * Stripe-specific purchase catalog (Plus subscription + Pro top-up packs).
 *
 * The pack configuration ships as a single env var (`STRIPE_PRO_TOPUP_PACKS_JSON`)
 * and is parsed/validated here. The internal `priceId` field is the Stripe Price
 * ID — it is never exposed to the frontend (`toTopupPackResponse` strips it).
 *
 * If a future provider needs its own top-up catalog, that provider should ship
 * its own equivalent of this file under `providers/<name>/`.
 */

import type { Env } from '../../../../../shared/types/index.ts';

export const PLUS_SUBSCRIPTION_PURCHASE_KIND = 'plus_subscription';
export const PRO_TOPUP_PURCHASE_KIND = 'pro_topup';

export interface BillingTopupPack {
  id: string;
  label: string;
  /** Stripe Price ID (`price_*`). Never sent to the frontend. */
  priceId: string;
  creditsCents: number;
  featured: boolean;
  badge: string | null;
}

export function getAvailableActions(account: {
  planId: string;
  providerSubscriptionId?: string | null;
}, hasTopupPacks: boolean) {
  const hasActiveSubscription = Boolean(account.providerSubscriptionId);
  const isPlusPlan = account.planId === 'plan_plus';
  return {
    subscribe_plus: !hasActiveSubscription && !isPlusPlan,
    top_up_pro: !hasActiveSubscription && !isPlusPlan && hasTopupPacks,
    manage_subscription: hasActiveSubscription,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseConfiguredTopupPack(value: unknown, index: number): BillingTopupPack {
  if (!isRecord(value)) {
    throw new Error(`Top-up pack at index ${index} must be an object`);
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  const priceId = typeof value.price_id === 'string' ? value.price_id.trim() : '';
  const creditsCentsRaw = value.credits_cents;
  const featured = value.featured;
  const badge = typeof value.badge === 'string' ? value.badge.trim() || null : null;

  if (!id) {
    throw new Error(`Top-up pack at index ${index} is missing id`);
  }
  if (!label) {
    throw new Error(`Top-up pack "${id}" is missing label`);
  }
  if (!priceId) {
    throw new Error(`Top-up pack "${id}" is missing price_id`);
  }
  if (typeof creditsCentsRaw !== 'number' || !Number.isInteger(creditsCentsRaw) || creditsCentsRaw <= 0) {
    throw new Error(`Top-up pack "${id}" has invalid credits_cents`);
  }
  if (typeof featured !== 'boolean') {
    throw new Error(`Top-up pack "${id}" is missing featured`);
  }

  return {
    id,
    label,
    priceId,
    creditsCents: creditsCentsRaw,
    featured,
    badge,
  };
}

export function getConfiguredProTopupPacks(env: Env): BillingTopupPack[] {
  const rawCatalog = env.STRIPE_PRO_TOPUP_PACKS_JSON?.trim();
  if (rawCatalog) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawCatalog);
    } catch (err) {
      throw new Error(`STRIPE_PRO_TOPUP_PACKS_JSON is invalid JSON: ${String(err)}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('STRIPE_PRO_TOPUP_PACKS_JSON must be a non-empty array');
    }

    const seenIds = new Set<string>();
    return parsed.map((entry, index) => {
      const pack = parseConfiguredTopupPack(entry, index);
      if (seenIds.has(pack.id)) throw new Error(`Duplicate top-up pack id: ${pack.id}`);
      seenIds.add(pack.id);
      return pack;
    });
  }

  throw new Error('STRIPE_PRO_TOPUP_PACKS_JSON is not configured');
}

export function resolveConfiguredProTopupPack(env: Env, packId: string): BillingTopupPack {
  const pack = getConfiguredProTopupPacks(env).find((entry) => entry.id === packId);
  if (!pack) {
    throw new Error(`Unknown top-up pack: ${packId}`);
  }
  return pack;
}

/**
 * Convert a top-up pack to its public API shape. The Stripe `priceId` is
 * intentionally omitted — the frontend identifies packs by `id` only and the
 * checkout flow looks the price up server-side.
 */
export function toTopupPackResponse(pack: BillingTopupPack) {
  return {
    id: pack.id,
    label: pack.label,
    credits_cents: pack.creditsCents,
    featured: pack.featured,
    badge: pack.badge,
  };
}
