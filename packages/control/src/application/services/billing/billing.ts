import { getDb, billingAccounts, billingPlans, billingPlanQuotas, billingPlanRates, billingPlanFeatures, billingTransactions, usageEvents, usageRollups, runs } from '../../../infra/db';
import { generateId, safeJsonParseOrDefault } from '../../../shared/utils';
import { logWarn, logError } from '../../../shared/utils/logger';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
import { eq, and, gte, sum, asc, sql } from 'drizzle-orm';
import { getUsageEventsFromR2 } from '../offload/usage-events';
import type { Database } from '../../../infra/db';

const METER_TYPES = [
  'llm_tokens_input',
  'llm_tokens_output',
  'embedding_count',
  'vector_search_count',
  'exec_seconds',
  'browser_seconds',
  'web_search_count',
  'r2_storage_gb_month',
  'wfp_requests',
  'queue_messages',
] as const;

export type MeterType = typeof METER_TYPES[number];

export function asMeterType(value: string): MeterType | null {
  return (METER_TYPES as readonly string[]).includes(value) ? (value as MeterType) : null;
}

export type TransactionType = 'purchase' | 'usage' | 'refund' | 'bonus' | 'adjustment';

export interface BillingCheckResult {
  allowed: boolean;
  reason?: string;
  balanceCents: number;
  estimatedCostCents: number;
  accountId: string;
  planName: string;
}

export interface UsageRecordInput {
  accountId: string;
  spaceId?: string;
  meterType: MeterType;
  units: number;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
  // Optional idempotency key to prevent double billing on retries.
  // When provided, `usage_events.idempotency_key` is used as SSOT.
  idempotencyKey?: string;
}

export interface UsageRecordResult {
  success: boolean;
  balanceCents: number;
  costCents: number;
  eventId: string;
}

export const WEEKLY_RUNTIME_WINDOW_DAYS = 7;
export const WEEKLY_RUNTIME_LIMIT_SECONDS = 5 * 60 * 60;
export const CANONICAL_BILLING_PLAN_IDS = ['plan_free', 'plan_plus', 'plan_payg'] as const;
const LEGACY_BILLING_PLAN_ALIAS_MAP = {
  plan_pro: 'plan_payg',
  plan_enterprise: 'plan_payg',
} as const;
export type BillingPlanId = typeof CANONICAL_BILLING_PLAN_IDS[number];
export type BillingPlanTier = 'free' | 'plus' | 'pro';
export type BillingMode = 'free' | 'plus_subscription' | 'pro_prepaid';

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

const DEFAULT_BILLING_QUOTAS: Record<string, Partial<Record<MeterType, number>>> = {
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

const DEFAULT_BILLING_RATES: Record<string, Partial<Record<MeterType, number>>> = {
  plan_free: {},
  plan_plus: {},
  plan_payg: PRO_PLAN_RATES,
};

export interface RollingUsageSnapshot {
  meterType: MeterType;
  units: number;
  windowDays: number;
  windowStart: string;
}

export interface WeeklyRuntimeLimitCheck {
  allowed: boolean;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  windowDays: number;
  windowStart: string;
  retryAfterSeconds: number;
}

interface BillingAccountWithPlan {
  id: string;
  accountId: string;
  planId: string;
  balanceCents: number;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionPeriodEnd: string | null;
  billingPlan: {
    id: string;
    name: string;
    displayName: string;
    description: string | null;
    isDefault: boolean;
    billingPlanQuotas: Array<{ quotaKey: string; limitValue: number }>;
    billingPlanRates: Array<{ meterType: string; rateCents: number }>;
    billingPlanFeatures: Array<{ featureKey: string; enabled: boolean }>;
  };
}

async function loadBillingAccountWithPlan(db: Database, accountIdFilter: { byAccountId?: string; byId?: string }): Promise<BillingAccountWithPlan | null> {
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
    stripeCustomerId: account.stripeCustomerId ?? null,
    stripeSubscriptionId: account.stripeSubscriptionId ?? null,
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

async function ensureDefaultBillingCatalog(db: Database): Promise<void> {
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

function isCanonicalBillingPlanId(planId: string): planId is BillingPlanId {
  return (CANONICAL_BILLING_PLAN_IDS as readonly string[]).includes(planId);
}

function resolveCanonicalBillingPlanId(planId: string | null | undefined): BillingPlanId | null {
  const normalized = String(planId || '').trim().toLowerCase();
  if (!normalized) return null;
  if (isCanonicalBillingPlanId(normalized)) {
    return normalized;
  }
  return LEGACY_BILLING_PLAN_ALIAS_MAP[normalized as keyof typeof LEGACY_BILLING_PLAN_ALIAS_MAP] ?? null;
}

function resolveCanonicalBillingPlanIdFromName(planName: string | null | undefined): BillingPlanId | null {
  const normalized = String(planName || '').trim().toLowerCase();
  if (normalized === 'free') return 'plan_free';
  if (normalized === 'plus') return 'plan_plus';
  if (normalized === 'payg') return 'plan_payg';
  return null;
}

export function assertBillingPlanId(planId: string): BillingPlanId {
  const normalized = String(planId || '').trim().toLowerCase();
  if (!isCanonicalBillingPlanId(normalized)) {
    throw new Error(`Unknown billing plan: ${planId}`);
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

function hasExpectedBillingCatalog(plan: {
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

/**
 * Batch-record all usage for a run (LLM tokens + raw usage events from R2).
 *
 * Idempotent by construction via `usage_events.idempotency_key`:
 * - `run:${runId}:${meterType}`
 */
export async function recordRunUsageBatch(env: Env, runId: string): Promise<void> {
  const db = getDb(env.DB);
  const run = await db
    .select({ usage: runs.usage, accountId: runs.accountId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!run) return;
  const ownerId = run.accountId;
  if (!ownerId) return;

  const account = await getOrCreateBillingAccount(env.DB, ownerId);

  // 1) LLM token usage (from runs.usage)
  const usage = safeJsonParseOrDefault<{ inputTokens?: number; outputTokens?: number }>(run.usage, {});
  const inputK = (usage.inputTokens ?? 0) / 1000;
  const outputK = (usage.outputTokens ?? 0) / 1000;

  const aggregated = new Map<MeterType, number>();
  if (inputK > 0) aggregated.set('llm_tokens_input', inputK);
  if (outputK > 0) aggregated.set('llm_tokens_output', outputK);

  // 2) Tool usage (raw events from R2)
  if (env.TAKOS_OFFLOAD) {
    try {
      const raw = await getUsageEventsFromR2(env.TAKOS_OFFLOAD, runId, { maxEvents: 50_000 });
      for (const ev of raw) {
        const meterType = asMeterType(ev.meter_type);
        if (!meterType) continue;
        const units = typeof ev.units === 'number' ? ev.units : NaN;
        if (!Number.isFinite(units) || units <= 0) continue;
        aggregated.set(meterType, (aggregated.get(meterType) ?? 0) + units);
      }
    } catch (err) {
      logWarn('[BILLING] Failed to read raw usage events from R2', {
        action: 'recordRunUsageBatch',
        runId,
        errorValue: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3) Apply aggregated usage idempotently.
  for (const [meterType, units] of aggregated.entries()) {
    if (units <= 0) continue;
    try {
      await recordUsage(env.DB, {
        accountId: account.id,
        spaceId: run.accountId,
        meterType,
        units,
        referenceId: runId,
        referenceType: 'run',
        idempotencyKey: `run:${runId}:${meterType}`,
      });
    } catch (err) {
      logError('[BILLING] recordUsage failed', err, {
        action: 'recordRunUsageBatch',
        runId,
        meterType,
      });
    }
  }
}

/**
 * Get or create a billing account for a user (lazy init).
 * On first access, creates a free plan account automatically.
 */
export async function getOrCreateBillingAccount(
  d1: D1Database,
  userId: string
) {
  const db = getDb(d1);

  let existing = await loadBillingAccountWithPlan(db, { byAccountId: userId });

  const normalizedExistingPlanId = existing ? resolveCanonicalBillingPlanId(existing.planId) : null;
  if (existing && normalizedExistingPlanId && normalizedExistingPlanId !== existing.planId) {
    await db.update(billingAccounts).set({
      planId: normalizedExistingPlanId,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, existing.id));
    existing = await loadBillingAccountWithPlan(db, { byAccountId: userId });
  }

  if (existing && hasExpectedBillingCatalog({
    id: existing.billingPlan.id,
    name: existing.billingPlan.name,
    quotas: existing.billingPlan.billingPlanQuotas,
    rates: existing.billingPlan.billingPlanRates,
  })) {
    assertBillingPlanId(existing.planId);
    return existing;
  }

  await ensureDefaultBillingCatalog(db);

  existing = await loadBillingAccountWithPlan(db, { byAccountId: userId });

  if (existing) {
    assertBillingPlanId(existing.planId);
    return existing;
  }

  // Use insert with onConflictDoUpdate to handle concurrent requests safely
  const newId = generateId();
  await db.insert(billingAccounts).values({
    id: newId,
    accountId: userId,
    planId: CANONICAL_BILLING_PLAN_IDS[0],
    balanceCents: 0,
    status: 'active',
  }).onConflictDoUpdate({
    target: billingAccounts.accountId,
    set: { updatedAt: new Date().toISOString() },
  });

  const account = await loadBillingAccountWithPlan(db, { byAccountId: userId });
  if (!account) throw new Error('Failed to create billing account');
  return account;
}

/**
 * Check if a user has billing quota for a given meter type.
 *
 * Logic:
 * 1. Get billing account (create if needed)
 * 2. Check account status
 * 3. Check plan quota for meter type:
 *    - 0 → deny (feature not available on this plan)
 *    - >0 → monthly limit check
 *    - -1 → balance-gated (check credit balance)
 * 4. For balance-gated: check balance >= estimated cost
 */
export async function checkBillingQuota(
  d1: D1Database,
  userId: string,
  meterType: MeterType,
  estimatedUnits: number = 1
): Promise<BillingCheckResult> {
  const account = await getOrCreateBillingAccount(d1, userId);

  const baseResult = {
    accountId: account.id,
    planName: account.billingPlan.name,
    balanceCents: account.balanceCents,
  };

  if (account.status !== 'active') {
    return {
      ...baseResult,
      allowed: false,
      reason: `Account is ${account.status}`,
      estimatedCostCents: 0,
    };
  }

  const quotas = Object.fromEntries(account.billingPlan.billingPlanQuotas.map((quota) => [quota.quotaKey, quota.limitValue]));
  const meterRates = Object.fromEntries(account.billingPlan.billingPlanRates.map((rate) => [rate.meterType, rate.rateCents]));

  const quota = quotas[meterType];
  const rate = meterRates[meterType];
  const normalizedRate = rate ?? 0;
  const estimatedCostCents = Math.ceil(estimatedUnits * normalizedRate);

  if (quota === 0 || quota === undefined) {
    return {
      ...baseResult,
      allowed: false,
      reason: `${meterType} is not available on the ${account.billingPlan.displayName} plan`,
      estimatedCostCents,
    };
  }

  if (quota > 0) {
    const db = getDb(d1);
    const periodStart = getCurrentPeriodStart();
    const monthlyUsage = await db
      .select({ total: sum(usageRollups.units) })
      .from(usageRollups)
      .where(and(
        eq(usageRollups.billingAccountId, account.id),
        eq(usageRollups.meterType, meterType),
        eq(usageRollups.periodStart, periodStart),
      ))
      .get();

    const currentUnits = Number(monthlyUsage?.total ?? 0);
    if (currentUnits + estimatedUnits > quota) {
      return {
        ...baseResult,
        allowed: false,
        reason: `Monthly ${meterType} limit reached (${currentUnits}/${quota})`,
        estimatedCostCents,
      };
    }

    return { ...baseResult, allowed: true, estimatedCostCents };
  }

  if (rate === undefined) {
    return {
      ...baseResult,
      allowed: false,
      reason: `Billing configuration incomplete for ${meterType} on the ${account.billingPlan.displayName} plan`,
      estimatedCostCents: 0,
    };
  }

  if (account.balanceCents < estimatedCostCents) {
    return {
      ...baseResult,
      allowed: false,
      reason: `Insufficient balance (have ${account.balanceCents}¢, need ${estimatedCostCents}¢)`,
      estimatedCostCents,
    };
  }

  return { ...baseResult, allowed: true, estimatedCostCents };
}

/**
 * Record usage for a billing account.
 * Atomically: insert event → upsert meter → insert transaction → debit balance.
 */
export async function recordUsage(
  d1: D1Database,
  input: UsageRecordInput
): Promise<UsageRecordResult> {
  const db = getDb(d1);

  const account = await loadBillingAccountWithPlan(db, { byId: input.accountId });

  if (!account) {
    return { success: false, balanceCents: 0, costCents: 0, eventId: '' };
  }

  const meterRates = Object.fromEntries(account.billingPlan.billingPlanRates.map((rate) => [rate.meterType, rate.rateCents]));
  const planQuotas = Object.fromEntries(account.billingPlan.billingPlanQuotas.map((quota) => [quota.quotaKey, quota.limitValue]));
  const rate = meterRates[input.meterType];
  const quota = planQuotas[input.meterType];
  if ((quota === -1 || quota === undefined) && rate === undefined) {
    throw new Error(`Billing configuration incomplete for ${input.meterType} on plan ${account.billingPlan.id}`);
  }
  const normalizedRate = rate ?? 0;
  const costCents = Math.ceil(input.units * normalizedRate);

  const eventId = generateId();
  const transactionId = generateId();
  const periodStart = getCurrentPeriodStart();
  const now = new Date().toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : '{}';
  const scopeType = input.spaceId ? 'space' : 'account';

  let applied = true;
  let resultingBalance = account.balanceCents;

  // Execute sequentially (idempotent when idempotencyKey is provided).
  // D1 doesn't support interactive transactions.
  if (input.idempotencyKey) {
    const inserted = await db.insert(usageEvents)
      .values({
        id: eventId,
        idempotencyKey: input.idempotencyKey,
        billingAccountId: input.accountId,
        scopeType,
        accountId: input.spaceId ?? null,
        meterType: input.meterType,
        units: input.units,
        costCents,
        referenceId: input.referenceId ?? null,
        referenceType: input.referenceType ?? null,
        metadata: metadataJson,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: usageEvents.id });

    if (inserted.length === 0) {
      applied = false;
    }
  } else {
    await db.insert(usageEvents).values({
      id: eventId,
      billingAccountId: input.accountId,
      scopeType,
      accountId: input.spaceId ?? null,
      meterType: input.meterType,
      units: input.units,
      costCents,
      referenceId: input.referenceId ?? null,
      referenceType: input.referenceType ?? null,
      metadata: metadataJson,
    });
  }

  if (applied) {
    // 2. Upsert monthly usage aggregation
    await db.insert(usageRollups)
      .values({
        id: generateId(),
        billingAccountId: input.accountId,
        scopeType,
        accountId: input.spaceId ?? null,
        meterType: input.meterType,
        periodStart,
        units: input.units,
        costCents,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [usageRollups.billingAccountId, usageRollups.scopeType, usageRollups.accountId, usageRollups.meterType, usageRollups.periodStart],
        set: {
          units: sql`${usageRollups.units} + ${input.units}`,
          costCents: sql`${usageRollups.costCents} + ${costCents}`,
          updatedAt: now,
        },
      });

    // 3/4. Atomically debit balance, then insert billing transaction.
    // Use sql expression to avoid read-calculate-update race condition.
    await db.update(billingAccounts)
      .set({
        balanceCents: sql`${billingAccounts.balanceCents} - ${costCents}`,
        updatedAt: now,
      })
      .where(eq(billingAccounts.id, input.accountId));

    // Read back the authoritative balance after the atomic update.
    const updatedAccount = await db
      .select({ balanceCents: billingAccounts.balanceCents })
      .from(billingAccounts)
      .where(eq(billingAccounts.id, input.accountId))
      .get();
    resultingBalance = updatedAccount?.balanceCents ?? 0;

    await db.insert(billingTransactions).values({
      id: transactionId,
      billingAccountId: input.accountId,
      type: 'usage',
      amountCents: -costCents,
      balanceAfterCents: resultingBalance,
      description: `${input.meterType}: ${input.units} units`,
      referenceId: eventId,
      metadata: '{}',
    });
  }

  if (!applied) {
    // Refresh balance in case another write happened between pre-read and now.
    const refreshed = await db
      .select({ balanceCents: billingAccounts.balanceCents })
      .from(billingAccounts)
      .where(eq(billingAccounts.id, input.accountId))
      .get();
    resultingBalance = refreshed?.balanceCents ?? resultingBalance;
  }

  return {
    success: true,
    balanceCents: resultingBalance,
    costCents: applied ? costCents : 0,
    eventId: applied ? eventId : '',
  };
}

/**
 * Assign a billing plan to a user. Creates account if needed.
 */
export async function assignPlanToUser(
  d1: D1Database,
  userId: string,
  planId: string
) {
  const db = getDb(d1);
  const account = await getOrCreateBillingAccount(d1, userId);
  const canonicalPlanId = assertBillingPlanId(planId);

  if (account.planId === canonicalPlanId) {
    return account;
  }

  await db.update(billingAccounts).set({
    planId: canonicalPlanId,
    updatedAt: new Date().toISOString(),
  }).where(eq(billingAccounts.id, account.id));

  const updated = await loadBillingAccountWithPlan(db, { byId: account.id });
  return updated;
}

/**
 * Add credits to a billing account and record a transaction.
 */
export async function addCredits(
  d1: D1Database,
  accountId: string,
  amount: number,
  description: string
) {
  const db = getDb(d1);

  const account = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.id, accountId))
    .get();

  if (!account) {
    throw new Error(`Billing account not found: ${accountId}`);
  }

  const transactionId = generateId();

  // Use atomic SQL expression to prevent race conditions (e.g., Stripe webhook retries)
  await db.update(billingAccounts).set({
    balanceCents: sql`${billingAccounts.balanceCents} + ${amount}`,
    updatedAt: new Date().toISOString(),
  }).where(eq(billingAccounts.id, accountId));

  // Re-read the updated balance for the transaction record
  const updated = await db.select({ balanceCents: billingAccounts.balanceCents })
    .from(billingAccounts)
    .where(eq(billingAccounts.id, accountId))
    .get();
  const newBalance = updated?.balanceCents ?? account.balanceCents + amount;

  await db.insert(billingTransactions).values({
    id: transactionId,
    billingAccountId: accountId,
    type: 'purchase',
    amountCents: amount,
    balanceAfterCents: newBalance,
    description,
    metadata: '{}',
  });

  return { balanceCents: newBalance, transactionId };
}

/**
 * Check if a user has access to a boolean feature (e.g., custom_domain).
 */
export async function checkFeatureAccess(
  d1: D1Database,
  userId: string,
  feature: string
): Promise<boolean> {
  const account = await getOrCreateBillingAccount(d1, userId);

  const features = Object.fromEntries(account.billingPlan.billingPlanFeatures.map((item) => [item.featureKey, item.enabled]));

  return features[feature] === true;
}

export async function getRollingUsage(
  d1: D1Database,
  userId: string,
  meterType: MeterType,
  windowDays: number = WEEKLY_RUNTIME_WINDOW_DAYS
): Promise<RollingUsageSnapshot> {
  const account = await getOrCreateBillingAccount(d1, userId);
  const db = getDb(d1);
  const windowStartDate = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000));

  const agg = await db
    .select({ total: sum(usageEvents.units) })
    .from(usageEvents)
    .where(and(
      eq(usageEvents.billingAccountId, account.id),
      eq(usageEvents.meterType, meterType),
      gte(usageEvents.createdAt, windowStartDate.toISOString()),
    ))
    .get();

  return {
    meterType,
    units: Number(agg?.total ?? 0),
    windowDays,
    windowStart: windowStartDate.toISOString(),
  };
}

export async function checkWeeklyRuntimeLimit(
  d1: D1Database,
  userId: string,
  estimatedAdditionalSeconds: number = 0,
  options?: {
    limitSeconds?: number;
    windowDays?: number;
  }
): Promise<WeeklyRuntimeLimitCheck> {
  const limitSeconds = options?.limitSeconds ?? WEEKLY_RUNTIME_LIMIT_SECONDS;
  const windowDays = options?.windowDays ?? WEEKLY_RUNTIME_WINDOW_DAYS;
  const snapshot = await getRollingUsage(d1, userId, 'exec_seconds', windowDays);
  const projected = snapshot.units + Math.max(0, estimatedAdditionalSeconds);
  const remainingSeconds = Math.max(0, limitSeconds - snapshot.units);
  let retryAfterSeconds = 0;

  if (projected > limitSeconds || snapshot.units >= limitSeconds) {
    const account = await getOrCreateBillingAccount(d1, userId);
    const db = getDb(d1);
    const oldest = await db
      .select({ createdAt: usageEvents.createdAt })
      .from(usageEvents)
      .where(and(
        eq(usageEvents.billingAccountId, account.id),
        eq(usageEvents.meterType, 'exec_seconds'),
        gte(usageEvents.createdAt, snapshot.windowStart),
      ))
      .orderBy(asc(usageEvents.createdAt))
      .limit(1)
      .get();

    if (oldest?.createdAt) {
      const oldestMs = Date.parse(String(oldest.createdAt));
      if (Number.isFinite(oldestMs)) {
        const releaseAtMs = oldestMs + (windowDays * 24 * 60 * 60 * 1000);
        retryAfterSeconds = Math.max(1, Math.ceil((releaseAtMs - Date.now()) / 1000));
      }
    }
  }

  return {
    allowed: projected <= limitSeconds && snapshot.units < limitSeconds,
    usedSeconds: snapshot.units,
    limitSeconds,
    remainingSeconds,
    windowDays,
    windowStart: snapshot.windowStart,
    retryAfterSeconds,
  };
}

/**
 * Get the first day of the current month as YYYY-MM-01.
 */
function getCurrentPeriodStart(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}
