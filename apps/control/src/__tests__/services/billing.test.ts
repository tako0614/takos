import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

import {
  assertBillingPlanId,
  checkBillingQuota,
  getOrCreateBillingAccount,
  recordUsage,
  resolveBillingMode,
  resolveBillingPlanTier,
} from '@/services/billing/billing';

/**
 * Creates a stateful Drizzle mock that supports sequential select/insert/update calls.
 * Each select call returns the next result from the selectResults array.
 */
function createStatefulDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;

  const drizzle = {
    select: vi.fn().mockImplementation(() => {
      const result = selectResults[selectIdx++] ?? undefined;
      const terminalChain = {
        get: vi.fn().mockResolvedValue(result),
        all: vi.fn().mockResolvedValue(Array.isArray(result) ? result : (result !== undefined ? [result] : [])),
      };
      const whereChain = {
        ...terminalChain,
        orderBy: vi.fn().mockReturnValue(terminalChain),
        limit: vi.fn().mockReturnValue(terminalChain),
      };
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(whereChain),
          ...terminalChain,
        }),
      };
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue([]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue([]),
          run: vi.fn(),
        }),
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue([]),
          run: vi.fn(),
        }),
        run: vi.fn(),
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: vi.fn(),
          returning: vi.fn().mockReturnValue({ get: vi.fn() }),
        }),
        run: vi.fn(),
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockReturnValue({ run: vi.fn() }),
    })),
  };

  return drizzle;
}

/**
 * Build the select results sequence for loadBillingAccountWithPlan.
 * Returns 5 elements: account row, plan row, quotas array, rates array, features array.
 */
function buildBillingAccountSelectSequence(
  account: Record<string, unknown>,
  plan: Record<string, unknown>,
  quotas: Array<{ quotaKey: string; limitValue: number }>,
  rates: Array<{ meterType: string; rateCents: number }>,
  features: Array<{ featureKey: string; enabled: boolean }> = [],
): unknown[] {
  return [account, plan, quotas, rates, features];
}

describe('billing catalog self-heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds free-plan quotas when an account exists but plan quotas are missing', async () => {
    const account = {
      id: 'acct-1', accountId: 'user-1', planId: 'plan_free',
      balanceCents: 0, status: 'active',
      stripeCustomerId: null, stripeSubscriptionId: null, subscriptionPeriodEnd: null,
    };
    const plan = { id: 'plan_free', name: 'free', displayName: 'Free', description: null, isDefault: true };

    // First loadBillingAccountWithPlan: no quotas (triggers self-heal)
    const firstLoad = buildBillingAccountSelectSequence(account, plan, [], [], []);

    // ensureDefaultBillingCatalog: for each of 3 plans: select plan, then per-quota select, per-rate select
    const catalogSelects: unknown[] = [];
    // plan_free: select plan, then 10 quota selects, 0 rate selects
    catalogSelects.push(plan);
    for (let i = 0; i < 10; i++) catalogSelects.push(undefined);
    // plan_plus
    catalogSelects.push({ id: 'plan_plus', name: 'plus', displayName: 'Plus', description: null, isDefault: false });
    for (let i = 0; i < 10; i++) catalogSelects.push(undefined);
    // plan_payg
    catalogSelects.push({ id: 'plan_payg', name: 'payg', displayName: 'Pay As You Go', description: null, isDefault: false });
    for (let i = 0; i < 10; i++) catalogSelects.push(undefined); // quotas
    for (let i = 0; i < 10; i++) catalogSelects.push(undefined); // rates

    // Second loadBillingAccountWithPlan: now has all expected quotas
    const allFreeQuotas = [
      { quotaKey: 'llm_tokens_input', limitValue: 20_000 },
      { quotaKey: 'llm_tokens_output', limitValue: 10_000 },
      { quotaKey: 'embedding_count', limitValue: 200 },
      { quotaKey: 'vector_search_count', limitValue: 100 },
      { quotaKey: 'exec_seconds', limitValue: 600 },
      { quotaKey: 'browser_seconds', limitValue: 0 },
      { quotaKey: 'web_search_count', limitValue: 20 },
      { quotaKey: 'r2_storage_gb_month', limitValue: 1 },
      { quotaKey: 'wfp_requests', limitValue: 100 },
      { quotaKey: 'queue_messages', limitValue: 100 },
    ];
    const secondLoad = buildBillingAccountSelectSequence(account, plan, allFreeQuotas, [], []);

    // Then checkBillingQuota does a usageRollups query
    const usageResult = { total: 0 };

    const allSelects = [...firstLoad, ...catalogSelects, ...secondLoad, usageResult];
    const drizzleMock = createStatefulDrizzleMock(allSelects);
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await checkBillingQuota({} as D1Database, 'user-1', 'llm_tokens_input', 1000);

    expect(result.allowed).toBe(true);
    expect(drizzleMock.insert).toHaveBeenCalled();
  });

  it('normalizes legacy payg aliases to canonical plan_payg on account load', async () => {
    const account = {
      id: 'acct-pro', accountId: 'user-2', planId: 'plan_pro',
      balanceCents: 500, status: 'active',
      stripeCustomerId: null, stripeSubscriptionId: null, subscriptionPeriodEnd: null,
    };
    const payGPlan = { id: 'plan_payg', name: 'payg', displayName: 'Pay As You Go', description: null, isDefault: false };

    const allPaygQuotas = [
      { quotaKey: 'llm_tokens_input', limitValue: -1 },
      { quotaKey: 'llm_tokens_output', limitValue: -1 },
      { quotaKey: 'embedding_count', limitValue: -1 },
      { quotaKey: 'vector_search_count', limitValue: -1 },
      { quotaKey: 'exec_seconds', limitValue: -1 },
      { quotaKey: 'browser_seconds', limitValue: -1 },
      { quotaKey: 'web_search_count', limitValue: -1 },
      { quotaKey: 'r2_storage_gb_month', limitValue: -1 },
      { quotaKey: 'wfp_requests', limitValue: -1 },
      { quotaKey: 'queue_messages', limitValue: -1 },
    ];
    const allPaygRates = [
      { meterType: 'llm_tokens_input', rateCents: 3 },
      { meterType: 'llm_tokens_output', rateCents: 15 },
      { meterType: 'embedding_count', rateCents: 1 },
      { meterType: 'vector_search_count', rateCents: 2 },
      { meterType: 'exec_seconds', rateCents: 5 },
      { meterType: 'browser_seconds', rateCents: 10 },
      { meterType: 'web_search_count', rateCents: 5 },
      { meterType: 'r2_storage_gb_month', rateCents: 2300 },
      { meterType: 'wfp_requests', rateCents: 1 },
      { meterType: 'queue_messages', rateCents: 1 },
    ];

    // First load: account has plan_pro, resolve to plan_payg
    const firstLoad = buildBillingAccountSelectSequence(
      account, payGPlan, allPaygQuotas, allPaygRates, [],
    );
    // After update, second load with planId normalized
    const secondLoad = buildBillingAccountSelectSequence(
      { ...account, planId: 'plan_payg' }, payGPlan, allPaygQuotas, allPaygRates, [],
    );

    const allSelects = [...firstLoad, ...secondLoad];
    const drizzleMock = createStatefulDrizzleMock(allSelects);
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await getOrCreateBillingAccount({} as D1Database, 'user-2');

    expect(result.planId).toBe('plan_payg');
    expect(drizzleMock.update).toHaveBeenCalled();
  });

  it('fails closed when a payg account is missing a meter rate instead of charging zero', async () => {
    const account = {
      id: 'acct-payg', accountId: 'user-3', planId: 'plan_payg',
      balanceCents: 500, status: 'active',
      stripeCustomerId: null, stripeSubscriptionId: null, subscriptionPeriodEnd: null,
    };
    const payGPlan = { id: 'plan_payg', name: 'payg', displayName: 'Pay As You Go', description: null, isDefault: false };

    const allPaygQuotas = [
      { quotaKey: 'llm_tokens_input', limitValue: -1 },
      { quotaKey: 'llm_tokens_output', limitValue: -1 },
      { quotaKey: 'embedding_count', limitValue: -1 },
      { quotaKey: 'vector_search_count', limitValue: -1 },
      { quotaKey: 'exec_seconds', limitValue: -1 },
      { quotaKey: 'browser_seconds', limitValue: -1 },
      { quotaKey: 'web_search_count', limitValue: -1 },
      { quotaKey: 'r2_storage_gb_month', limitValue: -1 },
      { quotaKey: 'wfp_requests', limitValue: -1 },
      { quotaKey: 'queue_messages', limitValue: -1 },
    ];
    const allPaygRates = [
      { meterType: 'llm_tokens_input', rateCents: 3 },
      { meterType: 'llm_tokens_output', rateCents: 15 },
      { meterType: 'embedding_count', rateCents: 1 },
      { meterType: 'vector_search_count', rateCents: 2 },
      { meterType: 'exec_seconds', rateCents: 5 },
      { meterType: 'browser_seconds', rateCents: 10 },
      { meterType: 'web_search_count', rateCents: 5 },
      { meterType: 'r2_storage_gb_month', rateCents: 2300 },
      { meterType: 'wfp_requests', rateCents: 1 },
      { meterType: 'queue_messages', rateCents: 1 },
    ];

    // checkBillingQuota: loadBillingAccountWithPlan with full catalog -> OK
    const firstLoad = buildBillingAccountSelectSequence(
      account, payGPlan, allPaygQuotas, allPaygRates, [],
    );

    const allSelects1 = [...firstLoad];
    const drizzleMock1 = createStatefulDrizzleMock(allSelects1);
    mocks.getDb.mockReturnValue(drizzleMock1);

    const quotaResult = await checkBillingQuota({} as D1Database, 'user-3', 'llm_tokens_input', 10);
    expect(quotaResult.allowed).toBe(true);

    // recordUsage with missing rates should throw
    const loadNoRates = buildBillingAccountSelectSequence(
      account, payGPlan,
      [{ quotaKey: 'llm_tokens_input', limitValue: -1 }],
      [], // no rates!
      [],
    );
    const drizzleMock2 = createStatefulDrizzleMock(loadNoRates);
    mocks.getDb.mockReturnValue(drizzleMock2);

    await expect(recordUsage({} as D1Database, {
      accountId: 'acct-payg',
      meterType: 'llm_tokens_input',
      units: 10,
    })).rejects.toThrow('Billing configuration incomplete');
  });

  it('rejects non-canonical plan IDs and resolves canonical billing tiers/modes', () => {
    expect(assertBillingPlanId('plan_free')).toBe('plan_free');
    expect(resolveBillingPlanTier('plan_plus')).toBe('plus');
    expect(resolveBillingPlanTier('plan_payg')).toBe('pro');
    expect(resolveBillingMode('plan_free')).toBe('free');
    expect(resolveBillingMode('plan_plus')).toBe('plus_subscription');
    expect(resolveBillingMode('plan_payg')).toBe('pro_prepaid');
    expect(() => assertBillingPlanId('plan_pro')).toThrow('Unknown billing plan');
  });
});
