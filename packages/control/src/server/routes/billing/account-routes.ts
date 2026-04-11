import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { usageRollups } from "../../../infra/db/schema.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  type BillingTopupPack,
  getAvailableActions,
  getConfiguredProTopupPacks,
  toTopupPackResponse,
} from "../../../application/services/billing/providers/stripe/stripe-purchase-config.ts";
import { billingRouteDeps } from "./deps.ts";
import { loadBillingAccount } from "./helpers.ts";
import { InternalError } from "takos-common/errors";

type BillingRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

export function registerBillingAccountRoutes(app: BillingRouter) {
  app.get("/", async (c) => {
    const account = await loadBillingAccount(c);

    let topupPacks: BillingTopupPack[];
    let planId: ReturnType<typeof billingRouteDeps.assertBillingPlanId>;
    try {
      planId = billingRouteDeps.assertBillingPlanId(account.planId);
      topupPacks = getConfiguredProTopupPacks(c.env);
    } catch (err) {
      logError("invalid plan on account", err, { module: "billing" });
      throw new InternalError("Billing configuration incomplete");
    }

    return c.json({
      plan: {
        id: account.billingPlan.id,
        name: account.billingPlan.name,
        display_name: account.billingPlan.displayName,
      },
      plan_tier: billingRouteDeps.resolveBillingPlanTier(planId),
      billing_mode: billingRouteDeps.resolveBillingMode(planId),
      available_actions: getAvailableActions(account, topupPacks.length > 0),
      topup_packs: topupPacks.map(toTopupPackResponse),
      runtime_limit_7d_seconds: billingRouteDeps.WEEKLY_RUNTIME_LIMIT_SECONDS,
      balance_cents: account.balanceCents,
      status: account.status,
      has_payment_account: !!account.providerCustomerId,
      has_subscription: !!account.providerSubscriptionId,
      subscription_period_end: account.subscriptionPeriodEnd ?? null,
    });
  });

  app.get("/usage", async (c) => {
    const account = await loadBillingAccount(c);
    const db = billingRouteDeps.getDb(c.env.DB);

    const d = new Date();
    const periodStart = `${d.getUTCFullYear()}-${
      String(d.getUTCMonth() + 1).padStart(2, "0")
    }-01`;

    const meters = await db.select({
      meterType: usageRollups.meterType,
      units: usageRollups.units,
      costCents: usageRollups.costCents,
    }).from(usageRollups).where(
      and(
        eq(usageRollups.accountId, account.id),
        eq(usageRollups.periodStart, periodStart),
      ),
    ).all();

    return c.json({
      period_start: periodStart,
      meters: meters.map((m) => ({
        meter_type: m.meterType,
        units: m.units,
        cost_cents: m.costCents,
      })),
    });
  });
}
