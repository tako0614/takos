/**
 * Billing account management: creation, plan assignment, credits, and feature access.
 */

import { getDb, billingAccounts, billingTransactions } from '../../../infra/db';
import { generateId } from '../../../shared/utils';
import { InternalError, NotFoundError } from '@takos/common/errors';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { eq, sql } from 'drizzle-orm';
import type { BillingAccountWithPlan } from './billing-types';
import {
  CANONICAL_BILLING_PLAN_IDS,
  assertBillingPlanId,
  resolveCanonicalBillingPlanId,
  hasExpectedBillingCatalog,
  ensureDefaultBillingCatalog,
  loadBillingAccountWithPlan,
} from './billing-plans';

/**
 * Get or create a billing account for a user (lazy init).
 * On first access, creates a free plan account automatically.
 */
export async function getOrCreateBillingAccount(
  d1: D1Database,
  userId: string
): Promise<BillingAccountWithPlan> {
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
  if (!account) throw new InternalError('Failed to create billing account');
  return account;
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
    throw new NotFoundError(`Billing account ${accountId}`);
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
