import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { BadRequestError, InternalError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { billingAccounts } from "../../../infra/db/schema.ts";
import { logError } from "../../../shared/utils/logger.ts";
import type { StripeWebhookEvent } from "../../../application/services/billing/stripe.ts";
import {
  isEventType,
  PLUS_SUBSCRIPTION_PURCHASE_KIND,
  PRO_TOPUP_PURCHASE_KIND,
  resolveConfiguredProTopupPack,
  toStripeCustomerId,
} from "./stripe.ts";
import { billingRouteDeps } from "./deps.ts";

async function handleCompletedCheckout(
  env: Env,
  event: StripeWebhookEvent,
): Promise<void> {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new InternalError("Webhook not configured");
  }

  const session = event.data.object as {
    id: string;
    metadata?: Record<string, string | undefined>;
  };
  const userId = session.metadata?.user_id;
  if (!userId) {
    return;
  }

  const fullSession = await billingRouteDeps.retrieveCheckoutSession({
    secretKey,
    sessionId: session.id,
  });

  const account = await billingRouteDeps.getOrCreateBillingAccount(
    env.DB,
    userId,
  );
  const purchaseKind = fullSession.metadata?.purchase_kind ??
    session.metadata?.purchase_kind;
  const db = billingRouteDeps.getDb(env.DB);

  if (purchaseKind === PLUS_SUBSCRIPTION_PURCHASE_KIND) {
    if (!fullSession.customer || !fullSession.subscription) {
      throw new Error(
        "Plus subscription checkout did not return customer/subscription",
      );
    }

    await db.update(billingAccounts).set({
      planId: "plan_plus",
      stripeCustomerId: fullSession.customer,
      stripeSubscriptionId: fullSession.subscription,
      subscriptionStartedAt: new Date().toISOString(),
      subscriptionPeriodEnd: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
    return;
  }

  if (purchaseKind === PRO_TOPUP_PURCHASE_KIND) {
    if (fullSession.payment_status !== "paid") {
      return;
    }
    const packId = fullSession.metadata?.pack_id ?? session.metadata?.pack_id;
    if (!packId) {
      throw new Error("Pro top-up checkout did not include pack_id");
    }
    const pack = resolveConfiguredProTopupPack(env, packId);
    await db.update(billingAccounts).set({
      planId: "plan_payg",
      stripeCustomerId: fullSession.customer ?? account.stripeCustomerId ??
        null,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
    await billingRouteDeps.addCredits(
      env.DB,
      account.id,
      pack.creditsCents,
      `Pro top-up credit (${pack.id}, ${pack.creditsCents}¢)`,
    );
  }
}

async function handleInvoicePaid(
  env: Env,
  event: StripeWebhookEvent,
): Promise<void> {
  const invoice = event.data.object as {
    customer: string | { id: string };
    lines?: {
      data?: Array<{ period?: { end?: number | null } | null }>;
    } | null;
  };
  const customerId = toStripeCustomerId(invoice.customer);
  const periodEnd = invoice.lines?.data?.[0]?.period?.end ?? null;
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.stripeCustomerId, customerId),
  ).get();

  if (account && account.planId === "plan_plus" && periodEnd) {
    await db.update(billingAccounts).set({
      subscriptionPeriodEnd: new Date(periodEnd * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
  }
}

async function handleSubscriptionDeleted(
  env: Env,
  event: StripeWebhookEvent,
): Promise<void> {
  const sub = event.data.object as {
    customer: string;
  };
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.stripeCustomerId, sub.customer),
  ).get();

  if (account) {
    await db.update(billingAccounts).set({
      planId: account.balanceCents > 0 ? "plan_payg" : "plan_free",
      stripeSubscriptionId: null,
      subscriptionStartedAt: null,
      subscriptionPeriodEnd: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
  }
}

export const billingWebhookHandler = new Hono<{ Bindings: Env }>()
  .post("/", async (c) => {
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secret || !secretKey) {
      throw new InternalError("Webhook not configured");
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      throw new BadRequestError("Missing signature");
    }

    const payload = await c.req.text();

    let event: StripeWebhookEvent;
    try {
      ({ event } = await billingRouteDeps.verifyWebhookSignature({
        payload,
        signature,
        secret,
      }));
    } catch (err) {
      logError("Signature verification failed", err, {
        module: "billing-webhook",
      });
      throw new BadRequestError("Invalid signature");
    }

    try {
      if (isEventType(event, "checkout.session.completed")) {
        await handleCompletedCheckout(c.env, event);
      } else if (isEventType(event, "invoice.paid")) {
        await handleInvoicePaid(c.env, event);
      } else if (isEventType(event, "customer.subscription.deleted")) {
        await handleSubscriptionDeleted(c.env, event);
      }
    } catch (err) {
      logError(`Error processing ${event.type}`, err, {
        module: "billing-webhook",
      });
      throw new InternalError("Webhook processing failed");
    }

    return c.json({ received: true });
  });
