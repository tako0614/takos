/**
 * Billing account management: creation, plan assignment, credits, and feature access.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { BillingAccountWithPlan } from './billing-types';
/**
 * Get or create a billing account for a user (lazy init).
 * On first access, creates a free plan account automatically.
 */
export declare function getOrCreateBillingAccount(d1: D1Database, userId: string): Promise<BillingAccountWithPlan>;
/**
 * Assign a billing plan to a user. Creates account if needed.
 */
export declare function assignPlanToUser(d1: D1Database, userId: string, planId: string): Promise<BillingAccountWithPlan | null>;
/**
 * Add credits to a billing account and record a transaction.
 */
export declare function addCredits(d1: D1Database, accountId: string, amount: number, description: string): Promise<{
    balanceCents: number;
    transactionId: string;
}>;
/**
 * Check if a user has access to a boolean feature (e.g., custom_domain).
 */
export declare function checkFeatureAccess(d1: D1Database, userId: string, feature: string): Promise<boolean>;
//# sourceMappingURL=billing-accounts.d.ts.map