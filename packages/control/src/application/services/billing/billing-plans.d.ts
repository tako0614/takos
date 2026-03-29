/**
 * Billing plan definitions, resolution helpers, and catalog management.
 */
import type { Database } from '../../../infra/db';
import type { MeterType, BillingAccountWithPlan } from './billing-types';
export declare const CANONICAL_BILLING_PLAN_IDS: readonly ["plan_free", "plan_plus", "plan_payg"];
export type BillingPlanId = typeof CANONICAL_BILLING_PLAN_IDS[number];
export type BillingPlanTier = 'free' | 'plus' | 'pro';
export type BillingMode = 'free' | 'plus_subscription' | 'pro_prepaid';
export declare function isCanonicalBillingPlanId(planId: string): planId is BillingPlanId;
export declare function resolveCanonicalBillingPlanId(planId: string | null | undefined): BillingPlanId | null;
export declare function resolveCanonicalBillingPlanIdFromName(planName: string | null | undefined): BillingPlanId | null;
export declare function assertBillingPlanId(planId: string): BillingPlanId;
export declare function resolveBillingPlanTier(planId: BillingPlanId): BillingPlanTier;
export declare function resolveBillingMode(planId: BillingPlanId): BillingMode;
export declare const DEFAULT_BILLING_QUOTAS: Record<string, Partial<Record<MeterType, number>>>;
export declare const DEFAULT_BILLING_RATES: Record<string, Partial<Record<MeterType, number>>>;
export declare function hasExpectedBillingCatalog(plan: {
    id?: string | null;
    name?: string | null;
    quotas: Array<{
        quotaKey: string;
    }>;
    rates: Array<{
        meterType: string;
    }>;
}): boolean;
export declare function ensureDefaultBillingCatalog(db: Database): Promise<void>;
export declare function loadBillingAccountWithPlan(db: Database, accountIdFilter: {
    byAccountId?: string;
    byId?: string;
}): Promise<BillingAccountWithPlan | null>;
//# sourceMappingURL=billing-plans.d.ts.map