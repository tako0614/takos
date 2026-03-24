import type { Env } from '../../../shared/types';
import type {
  StripeWebhookEvent,
  StripeWebhookEventType,
} from '../../../application/services/billing/stripe';

export const PLUS_SUBSCRIPTION_PURCHASE_KIND = 'plus_subscription';
export const PRO_TOPUP_PURCHASE_KIND = 'pro_topup';

export interface BillingTopupPack {
  id: string;
  label: string;
  priceId: string;
  creditsCents: number;
  featured: boolean;
  badge: string | null;
}

export function toStripeCustomerId(value: string | { id: string }): string {
  if (typeof value === 'string') return value;
  return value.id;
}

export function getAvailableActions(account: {
  planId: string;
  stripeSubscriptionId?: string | null;
}, hasTopupPacks: boolean) {
  const hasActiveSubscription = Boolean(account.stripeSubscriptionId);
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

export function toTopupPackResponse(pack: BillingTopupPack) {
  return {
    id: pack.id,
    label: pack.label,
    price_id: pack.priceId,
    credits_cents: pack.creditsCents,
    featured: pack.featured,
    badge: pack.badge,
  };
}

export function isEventType<T extends StripeWebhookEventType>(
  event: StripeWebhookEvent,
  type: T,
): event is StripeWebhookEvent<T> {
  return event.type === type;
}
