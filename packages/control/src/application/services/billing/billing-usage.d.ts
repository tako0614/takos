/**
 * Billing usage tracking: recording usage events, quota checks, rolling usage,
 * and weekly runtime limits.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { MeterType, BillingCheckResult, UsageRecordInput, UsageRecordResult, RollingUsageSnapshot, WeeklyRuntimeLimitCheck } from './billing-types';
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
export declare function checkBillingQuota(d1: D1Database, userId: string, meterType: MeterType, estimatedUnits?: number): Promise<BillingCheckResult>;
/**
 * Record usage for a billing account.
 * Atomically: insert event -> upsert meter -> insert transaction -> debit balance.
 */
export declare function recordUsage(d1: D1Database, input: UsageRecordInput): Promise<UsageRecordResult>;
export declare function getRollingUsage(d1: D1Database, userId: string, meterType: MeterType, windowDays?: number): Promise<RollingUsageSnapshot>;
export declare function checkWeeklyRuntimeLimit(d1: D1Database, userId: string, estimatedAdditionalSeconds?: number, options?: {
    limitSeconds?: number;
    windowDays?: number;
}): Promise<WeeklyRuntimeLimitCheck>;
//# sourceMappingURL=billing-usage.d.ts.map