/**
 * Billing usage tracking: recording usage events, quota checks, rolling usage,
 * and weekly runtime limits.
 */

import { getDb, billingAccounts, billingTransactions, usageEvents, usageRollups } from '../../../infra/db';
import { generateId } from '../../../shared/utils';
import { InternalError } from '@takoserver/common/errors';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { eq, and, gte, sum, asc, sql } from 'drizzle-orm';
import type {
  MeterType,
  BillingCheckResult,
  UsageRecordInput,
  UsageRecordResult,
  RollingUsageSnapshot,
  WeeklyRuntimeLimitCheck,
} from './billing-types';
import { WEEKLY_RUNTIME_WINDOW_DAYS, WEEKLY_RUNTIME_LIMIT_SECONDS } from './billing-types';
import { loadBillingAccountWithPlan } from './billing-plans';
import { getOrCreateBillingAccount } from './billing-accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the first day of the current month as YYYY-MM-01.
 */
function getCurrentPeriodStart(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

// ---------------------------------------------------------------------------
// Quota checking
// ---------------------------------------------------------------------------

/**
 * Check if a user has billing quota for a given meter type.
 *
 * Logic:
 * 1. Get billing account (create if needed)
 * 2. Check account status
 * 3. Check plan quota for meter type:
 *    - 0 -> deny (feature not available on this plan)
 *    - >0 -> monthly limit check
 *    - -1 -> balance-gated (check credit balance)
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

// ---------------------------------------------------------------------------
// Usage recording
// ---------------------------------------------------------------------------

/**
 * Record usage for a billing account.
 * Atomically: insert event -> upsert meter -> insert transaction -> debit balance.
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
    throw new InternalError(`Billing configuration incomplete for ${input.meterType} on plan ${account.billingPlan.id}`);
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

// ---------------------------------------------------------------------------
// Rolling usage and runtime limits
// ---------------------------------------------------------------------------

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
