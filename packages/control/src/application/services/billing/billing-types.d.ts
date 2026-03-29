/**
 * Billing type definitions, constants, and meter type helpers.
 */
export declare const METER_TYPES: readonly ["llm_tokens_input", "llm_tokens_output", "embedding_count", "vector_search_count", "exec_seconds", "browser_seconds", "web_search_count", "r2_storage_gb_month", "wfp_requests", "queue_messages"];
export type MeterType = typeof METER_TYPES[number];
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
    idempotencyKey?: string;
}
export interface UsageRecordResult {
    success: boolean;
    balanceCents: number;
    costCents: number;
    eventId: string;
}
export declare const WEEKLY_RUNTIME_WINDOW_DAYS = 7;
export declare const WEEKLY_RUNTIME_LIMIT_SECONDS: number;
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
export interface BillingAccountWithPlan {
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
        billingPlanQuotas: Array<{
            quotaKey: string;
            limitValue: number;
        }>;
        billingPlanRates: Array<{
            meterType: string;
            rateCents: number;
        }>;
        billingPlanFeatures: Array<{
            featureKey: string;
            enabled: boolean;
        }>;
    };
}
//# sourceMappingURL=billing-types.d.ts.map