import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  assertBillingPlanId,
  checkBillingQuota,
  getOrCreateBillingAccount,
  recordUsage,
  resolveBillingMode,
  resolveBillingPlanTier,
} from "@/services/billing/billing";

/**
 * Creates a stateful Drizzle mock that supports sequential select/insert/update calls.
 * Each select call returns the next result from the selectResults array.
 */
function createStatefulDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;

  const drizzle = {
    select: () => {
      const result = selectResults[selectIdx++] ?? undefined;
      const terminalChain = {
        get: async () => result,
        all: async () =>
          Array.isArray(result)
            ? result
            : (result !== undefined ? [result] : []),
      };
      const whereChain = {
        ...terminalChain,
        orderBy: () => terminalChain,
        limit: () => terminalChain,
      };
      return {
        from: () => ({
          where: () => whereChain,
          ...terminalChain,
        }),
      };
    },
    insert: spy(() => ({
      values: () => ({
        returning: () => [],
        onConflictDoUpdate: () => ({
          returning: () => [],
          run: ((..._args: any[]) => undefined) as any,
        }),
        onConflictDoNothing: () => ({
          returning: () => [],
          run: ((..._args: any[]) => undefined) as any,
        }),
        run: ((..._args: any[]) => undefined) as any,
      }),
    })),
    update: spy(() => ({
      set: () => ({
        where: () => ({
          run: ((..._args: any[]) => undefined) as any,
          returning: () => ({ get: ((..._args: any[]) => undefined) as any }),
        }),
        run: ((..._args: any[]) => undefined) as any,
      }),
    })),
    delete: spy(() => ({
      where: () => ({ run: ((..._args: any[]) => undefined) as any }),
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

Deno.test("billing catalog self-heal - seeds free-plan quotas when an account exists but plan quotas are missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const account = {
    id: "acct-1",
    accountId: "user-1",
    planId: "plan_free",
    balanceCents: 0,
    status: "active",
    processorName: "stripe",
    processorCustomerId: null,
    processorSubscriptionId: null,
    subscriptionPeriodEnd: null,
  };
  const plan = {
    id: "plan_free",
    name: "free",
    displayName: "Free",
    description: null,
    isDefault: true,
  };

  // First loadBillingAccountWithPlan: no quotas (triggers self-heal)
  const firstLoad = buildBillingAccountSelectSequence(
    account,
    plan,
    [],
    [],
    [],
  );

  // ensureDefaultBillingCatalog: for each of 3 plans: select plan, then per-quota select, per-rate select
  const catalogSelects: unknown[] = [];
  // plan_free: select plan, then 9 quota selects, 0 rate selects
  catalogSelects.push(plan);
  for (let i = 0; i < 9; i++) catalogSelects.push(undefined);
  // plan_plus
  catalogSelects.push({
    id: "plan_plus",
    name: "plus",
    displayName: "Plus",
    description: null,
    isDefault: false,
  });
  for (let i = 0; i < 9; i++) catalogSelects.push(undefined);
  // plan_payg
  catalogSelects.push({
    id: "plan_payg",
    name: "payg",
    displayName: "Pay As You Go",
    description: null,
    isDefault: false,
  });
  for (let i = 0; i < 9; i++) catalogSelects.push(undefined); // quotas
  for (let i = 0; i < 9; i++) catalogSelects.push(undefined); // rates

  // Second loadBillingAccountWithPlan: now has all expected quotas
  const allFreeQuotas = [
    { quotaKey: "llm_tokens_input", limitValue: 20_000 },
    { quotaKey: "llm_tokens_output", limitValue: 10_000 },
    { quotaKey: "embedding_count", limitValue: 200 },
    { quotaKey: "vector_search_count", limitValue: 100 },
    { quotaKey: "exec_seconds", limitValue: 600 },
    { quotaKey: "web_search_count", limitValue: 20 },
    { quotaKey: "r2_storage_gb_month", limitValue: 1 },
    { quotaKey: "wfp_requests", limitValue: 100 },
    { quotaKey: "queue_messages", limitValue: 100 },
  ];
  const secondLoad = buildBillingAccountSelectSequence(
    account,
    plan,
    allFreeQuotas,
    [],
    [],
  );

  // Then checkBillingQuota does a usageRollups query
  const usageResult = { total: 0 };

  const allSelects = [
    ...firstLoad,
    ...catalogSelects,
    ...secondLoad,
    usageResult,
  ];
  const drizzleMock = createStatefulDrizzleMock(allSelects);
  mocks.getDb = (() => drizzleMock) as any;

  const result = await checkBillingQuota(
    drizzleMock as D1Database,
    "user-1",
    "llm_tokens_input",
    1000,
  );

  assertEquals(result.allowed, true);
  assertEquals(result.planName, "free");
  assertEquals(result.accountId, "acct-1");
});
Deno.test("billing catalog self-heal - normalizes legacy payg aliases to canonical plan_payg on account load", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const account = {
    id: "acct-pro",
    accountId: "user-2",
    planId: "plan_pro",
    balanceCents: 500,
    status: "active",
    processorName: "stripe",
    processorCustomerId: null,
    processorSubscriptionId: null,
    subscriptionPeriodEnd: null,
  };
  const payGPlan = {
    id: "plan_payg",
    name: "payg",
    displayName: "Pay As You Go",
    description: null,
    isDefault: false,
  };

  const allPaygQuotas = [
    { quotaKey: "llm_tokens_input", limitValue: -1 },
    { quotaKey: "llm_tokens_output", limitValue: -1 },
    { quotaKey: "embedding_count", limitValue: -1 },
    { quotaKey: "vector_search_count", limitValue: -1 },
    { quotaKey: "exec_seconds", limitValue: -1 },
    { quotaKey: "web_search_count", limitValue: -1 },
    { quotaKey: "r2_storage_gb_month", limitValue: -1 },
    { quotaKey: "wfp_requests", limitValue: -1 },
    { quotaKey: "queue_messages", limitValue: -1 },
  ];
  const allPaygRates = [
    { meterType: "llm_tokens_input", rateCents: 3 },
    { meterType: "llm_tokens_output", rateCents: 15 },
    { meterType: "embedding_count", rateCents: 1 },
    { meterType: "vector_search_count", rateCents: 2 },
    { meterType: "exec_seconds", rateCents: 5 },
    { meterType: "web_search_count", rateCents: 5 },
    { meterType: "r2_storage_gb_month", rateCents: 2300 },
    { meterType: "wfp_requests", rateCents: 1 },
    { meterType: "queue_messages", rateCents: 1 },
  ];

  // First load: account has plan_pro, resolve to plan_payg
  const firstLoad = buildBillingAccountSelectSequence(
    account,
    payGPlan,
    allPaygQuotas,
    allPaygRates,
    [],
  );
  // After update, second load with planId normalized
  const secondLoad = buildBillingAccountSelectSequence(
    { ...account, planId: "plan_payg" },
    payGPlan,
    allPaygQuotas,
    allPaygRates,
    [],
  );

  const allSelects = [...firstLoad, ...secondLoad];
  const drizzleMock = createStatefulDrizzleMock(allSelects);
  mocks.getDb = (() => drizzleMock) as any;

  const result = await getOrCreateBillingAccount(
    drizzleMock as D1Database,
    "user-2",
  );

  assertEquals(result.planId, "plan_payg");
  assertSpyCalls(drizzleMock.update, 1);
});
Deno.test("billing catalog self-heal - fails closed when a payg account is missing a meter rate instead of charging zero", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const account = {
    id: "acct-payg",
    accountId: "user-3",
    planId: "plan_payg",
    balanceCents: 500,
    status: "active",
    processorName: "stripe",
    processorCustomerId: null,
    processorSubscriptionId: null,
    subscriptionPeriodEnd: null,
  };
  const payGPlan = {
    id: "plan_payg",
    name: "payg",
    displayName: "Pay As You Go",
    description: null,
    isDefault: false,
  };

  const allPaygQuotas = [
    { quotaKey: "llm_tokens_input", limitValue: -1 },
    { quotaKey: "llm_tokens_output", limitValue: -1 },
    { quotaKey: "embedding_count", limitValue: -1 },
    { quotaKey: "vector_search_count", limitValue: -1 },
    { quotaKey: "exec_seconds", limitValue: -1 },
    { quotaKey: "web_search_count", limitValue: -1 },
    { quotaKey: "r2_storage_gb_month", limitValue: -1 },
    { quotaKey: "wfp_requests", limitValue: -1 },
    { quotaKey: "queue_messages", limitValue: -1 },
  ];
  const allPaygRates = [
    { meterType: "llm_tokens_input", rateCents: 3 },
    { meterType: "llm_tokens_output", rateCents: 15 },
    { meterType: "embedding_count", rateCents: 1 },
    { meterType: "vector_search_count", rateCents: 2 },
    { meterType: "exec_seconds", rateCents: 5 },
    { meterType: "web_search_count", rateCents: 5 },
    { meterType: "r2_storage_gb_month", rateCents: 2300 },
    { meterType: "wfp_requests", rateCents: 1 },
    { meterType: "queue_messages", rateCents: 1 },
  ];

  // checkBillingQuota: loadBillingAccountWithPlan with full catalog -> OK
  const firstLoad = buildBillingAccountSelectSequence(
    account,
    payGPlan,
    allPaygQuotas,
    allPaygRates,
    [],
  );

  const allSelects1 = [...firstLoad];
  const drizzleMock1 = createStatefulDrizzleMock(allSelects1);
  mocks.getDb = (() => drizzleMock1) as any;

  const quotaResult = await checkBillingQuota(
    drizzleMock1 as D1Database,
    "user-3",
    "llm_tokens_input",
    10,
  );
  assertEquals(quotaResult.allowed, true);

  // recordUsage with missing rates should throw
  const loadNoRates = buildBillingAccountSelectSequence(
    account,
    payGPlan,
    [{ quotaKey: "llm_tokens_input", limitValue: -1 }],
    [], // no rates!
    [],
  );
  const drizzleMock2 = createStatefulDrizzleMock(loadNoRates);
  mocks.getDb = (() => drizzleMock2) as any;

  await assertRejects(async () => {
    await recordUsage(drizzleMock2 as D1Database, {
      accountId: "acct-payg",
      meterType: "llm_tokens_input",
      units: 10,
    });
  }, "Billing configuration incomplete");
});
Deno.test("billing catalog self-heal - rejects non-canonical plan IDs and resolves canonical billing tiers/modes", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(assertBillingPlanId("plan_free"), "plan_free");
  assertEquals(resolveBillingPlanTier("plan_plus"), "plus");
  assertEquals(resolveBillingPlanTier("plan_payg"), "pro");
  assertEquals(resolveBillingMode("plan_free"), "free");
  assertEquals(resolveBillingMode("plan_plus"), "plus_subscription");
  assertEquals(resolveBillingMode("plan_payg"), "pro_prepaid");
  assertThrows(
    () => assertBillingPlanId("plan_pro"),
    Error,
    "Unknown billing plan",
  );
});
