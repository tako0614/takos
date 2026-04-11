/**
 * Billing plan definitions, resolution helpers, and catalog management.
 */

import { billingAccounts, billingPlans, billingPlanQuotas, billingPlanRates, billingPlanFeatures } from '../../../infra/db/index.ts';
import { BadRequestError } from 'takos-common/errors';
import { eq, and } from 'drizzle-orm';
import type { Database } from '../../../infra/db/index.ts';
import type { MeterType, BillingAccountWithPlan } from './billing-types.ts';

// ---------------------------------------------------------------------------
// Plan ID constants and resolution
// ---------------------------------------------------------------------------

export const CANONICAL_BILLING_PLAN_IDS = ['plan_free', 'plan_plus', 'plan_payg'] as const;

const LEGACY_BILLING_PLAN_ALIAS_MAP = {
  plan_pro: 'plan_payg',
  plan_enterprise: 'plan_payg',
} as const;

export type BillingPlanId = typeof CANONICAL_BILLING_PLAN_IDS[number];
export type BillingPlanTier = 'free' | 'plus' | 'pro';
export type BillingMode = 'free' | 'plus_subscription' | 'pro_prepaid';

export function isCanonicalBillingPlanId(planId: string): planId is BillingPlanId {
  return (CANONICAL_BILLING_PLAN_IDS as readonly string[]).includes(planId);
}

export function resolveCanonicalBillingPlanId(planId: string | null | undefined): BillingPlanId | null {
  const normalized = String(planId || '').trim().toLowerCase();
  if (!normalized) return null;
  if (isCanonicalBillingPlanId(normalized)) {
    return normalized;
  }
  return LEGACY_BILLING_PLAN_ALIAS_MAP[normalized as keyof typeof LEGACY_BILLING_PLAN_ALIAS_MAP] ?? null;
}

export function resolveCanonicalBillingPlanIdFromName(planName: string | null | undefined): BillingPlanId | null {
  const normalized = String(planName || '').trim().toLowerCase();
  if (normalized === 'free') return 'plan_free';
  if (normalized === 'plus') return 'plan_plus';
  if (normalized === 'payg') return 'plan_payg';
  return null;
}

export function assertBillingPlanId(planId: string): BillingPlanId {
  const normalized = String(planId || '').trim().toLowerCase();
  if (!isCanonicalBillingPlanId(normalized)) {
    throw new BadRequestError(`Unknown billing plan: ${planId}`);
  }
  return normalized;
}

export function resolveBillingPlanTier(planId: BillingPlanId): BillingPlanTier {
  if (planId === 'plan_free') return 'free';
  if (planId === 'plan_plus') return 'plus';
  return 'pro';
}

export function resolveBillingMode(planId: BillingPlanId): BillingMode {
  if (planId === 'plan_free') return 'free';
  if (planId === 'plan_plus') return 'plus_subscription';
  return 'pro_prepaid';
}

// ---------------------------------------------------------------------------
// Default plan catalog data
// ---------------------------------------------------------------------------

const PRO_PLAN_QUOTAS: Partial<Record<MeterType, number>> = {
  llm_tokens_input: -1,
  llm_tokens_output: -1,
  embedding_count: -1,
  vector_search_count: -1,
  exec_seconds: -1,
  browser_seconds: -1,
  web_search_count: -1,
  r2_storage_gb_month: -1,
  wfp_requests: -1,
  queue_messages: -1,
};

const PRO_PLAN_RATES: Partial<Record<MeterType, number>> = {
  llm_tokens_input: 3,
  llm_tokens_output: 15,
  embedding_count: 1,
  vector_search_count: 2,
  exec_seconds: 5,
  browser_seconds: 10,
  web_search_count: 5,
  r2_storage_gb_month: 2300,
  wfp_requests: 1,
  queue_messages: 1,
};

const DEFAULT_BILLING_PLANS = [
  { id: 'plan_free', name: 'free', displayName: 'Free', description: 'Default free plan', isDefault: true },
  { id: 'plan_plus', name: 'plus', displayName: 'Plus', description: 'Plus plan', isDefault: false },
  { id: 'plan_payg', name: 'payg', displayName: 'Pay As You Go', description: 'Pay-as-you-go plan', isDefault: false },
] as const;

export const DEFAULT_BILLING_QUOTAS: Record<string, Partial<Record<MeterType, number>>> = {
  plan_free: {
    llm_tokens_input: 20_000,
    llm_tokens_output: 10_000,
    embedding_count: 200,
    vector_search_count: 100,
    exec_seconds: 600,
    browser_seconds: 0,
    web_search_count: 20,
    r2_storage_gb_month: 1,
    wfp_requests: 100,
    queue_messages: 100,
  },
  plan_plus: {
    llm_tokens_input: 250_000,
    llm_tokens_output: 125_000,
    embedding_count: 2_500,
    vector_search_count: 1_250,
    exec_seconds: 1_800,
    browser_seconds: 120,
    web_search_count: 400,
    r2_storage_gb_month: 5,
    wfp_requests: 1_000,
    queue_messages: 1_000,
  },
  plan_payg: PRO_PLAN_QUOTAS,
};

export const DEFAULT_BILLING_RATES: Record<string, Partial<Record<MeterType, number>>> = {
  plan_free: {},
  plan_plus: {},
  plan_payg: PRO_PLAN_RATES,
};

// ---------------------------------------------------------------------------
// Catalog validation and seeding
// ---------------------------------------------------------------------------

export function hasExpectedBillingCatalog(plan: {
  id?: string | null;
  name?: string | null;
  quotas: Array<{ quotaKey: string }>;
  rates: Array<{ meterType: string }>;
}): boolean {
  const planId = resolveCanonicalBillingPlanId(plan.id) ?? resolveCanonicalBillingPlanIdFromName(plan.name);
  if (!planId) {
    return false;
  }

  const expectedQuotas = Object.keys(DEFAULT_BILLING_QUOTAS[planId] ?? {});
  const expectedRates = Object.keys(DEFAULT_BILLING_RATES[planId] ?? {});
  if (expectedQuotas.length === 0 && expectedRates.length === 0) {
    return true;
  }

  const quotaKeys = new Set(plan.quotas.map((quota) => quota.quotaKey));
  const rateKeys = new Set(plan.rates.map((rate) => rate.meterType));

  return expectedQuotas.every((quotaKey) => quotaKeys.has(quotaKey))
    && expectedRates.every((meterType) => rateKeys.has(meterType));
}

export async function ensureDefaultBillingCatalog(db: Database): Promise<void> {
  for (const plan of DEFAULT_BILLING_PLANS) {
    // Upsert plan
    const existing = await db.select().from(billingPlans).where(eq(billingPlans.id, plan.id)).get();
    if (existing) {
      await db.update(billingPlans).set({
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        isDefault: plan.isDefault,
      }).where(eq(billingPlans.id, plan.id));
    } else {
      await db.insert(billingPlans).values({
        id: plan.id,
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        isDefault: plan.isDefault,
      });
    }

    for (const [quotaKey, limitValue] of Object.entries(DEFAULT_BILLING_QUOTAS[plan.id] ?? {})) {
      const existingQuota = await db.select().from(billingPlanQuotas)
        .where(and(eq(billingPlanQuotas.planId, plan.id), eq(billingPlanQuotas.quotaKey, quotaKey)))
        .get();
      if (existingQuota) {
        await db.update(billingPlanQuotas).set({ limitValue })
          .where(and(eq(billingPlanQuotas.planId, plan.id), eq(billingPlanQuotas.quotaKey, quotaKey)));
      } else {
        await db.insert(billingPlanQuotas).values({ planId: plan.id, quotaKey, limitValue });
      }
    }

    for (const [meterType, rateCents] of Object.entries(DEFAULT_BILLING_RATES[plan.id] ?? {})) {
      const existingRate = await db.select().from(billingPlanRates)
        .where(and(eq(billingPlanRates.planId, plan.id), eq(billingPlanRates.meterType, meterType)))
        .get();
      if (existingRate) {
        await db.update(billingPlanRates).set({ rateCents })
          .where(and(eq(billingPlanRates.planId, plan.id), eq(billingPlanRates.meterType, meterType)));
      } else {
        await db.insert(billingPlanRates).values({ planId: plan.id, meterType, rateCents });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DB helpers for loading account + plan
// ---------------------------------------------------------------------------

export async function loadBillingAccountWithPlan(db: Database, accountIdFilter: { byAccountId?: string; byId?: string }): Promise<BillingAccountWithPlan | null> {
  let account;
  if (accountIdFilter.byAccountId) {
    account = await db.select().from(billingAccounts).where(eq(billingAccounts.accountId, accountIdFilter.byAccountId)).get();
  } else if (accountIdFilter.byId) {
    account = await db.select().from(billingAccounts).where(eq(billingAccounts.id, accountIdFilter.byId)).get();
  }
  if (!account) return null;

  const plan = await db.select().from(billingPlans).where(eq(billingPlans.id, account.planId)).get();
  if (!plan) return null;

  const quotas = await db.select().from(billingPlanQuotas).where(eq(billingPlanQuotas.planId, account.planId)).all();
  const rates = await db.select().from(billingPlanRates).where(eq(billingPlanRates.planId, account.planId)).all();
  const features = await db.select().from(billingPlanFeatures).where(eq(billingPlanFeatures.planId, account.planId)).all();

  return {
    id: account.id,
    accountId: account.accountId,
    planId: account.planId,
    balanceCents: account.balanceCents,
    status: account.status,
    providerName: account.providerName,
    providerCustomerId: account.providerCustomerId ?? null,
    providerSubscriptionId: account.providerSubscriptionId ?? null,
    subscriptionPeriodEnd: account.subscriptionPeriodEnd ?? null,
    billingPlan: {
      id: plan.id,
      name: plan.name,
      displayName: plan.displayName,
      description: plan.description,
      isDefault: plan.isDefault,
      billingPlanQuotas: quotas.map(q => ({ quotaKey: q.quotaKey, limitValue: q.limitValue })),
      billingPlanRates: rates.map(r => ({ meterType: r.meterType, rateCents: r.rateCents })),
      billingPlanFeatures: features.map(f => ({ featureKey: f.featureKey, enabled: f.enabled })),
    },
  };
}
