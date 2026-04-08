import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { BadRequestError, InternalError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { billingAccounts, stripeWebhookEvents } from "../../../infra/db/schema.ts";
import { logError, logInfo, logWarn } from "../../../shared/utils/logger.ts";
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

/**
 * Handle `customer.subscription.updated` — fired by Stripe when a subscription
 * changes via the Billing Portal (plan change, cancel-at-period-end toggle,
 * payment-method-driven status change, trial transitions). Without this
 * handler the kernel's view of `subscriptionPeriodEnd` and `status` drifts
 * from Stripe ground truth.
 */
async function handleSubscriptionUpdated(
  env: Env,
  event: StripeWebhookEvent,
): Promise<void> {
  const sub = event.data.object as {
    customer: string | { id: string };
    status?: string;
    current_period_end?: number | null;
    cancel_at_period_end?: boolean;
  };
  const customerId = toStripeCustomerId(sub.customer);
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.stripeCustomerId, customerId),
  ).get();
  if (!account) return;

  const periodEndIso = typeof sub.current_period_end === 'number'
    ? new Date(sub.current_period_end * 1000).toISOString()
    : account.subscriptionPeriodEnd ?? null;

  await db.update(billingAccounts).set({
    status: typeof sub.status === 'string' ? sub.status : account.status,
    subscriptionPeriodEnd: periodEndIso,
    updatedAt: new Date().toISOString(),
  }).where(eq(billingAccounts.id, account.id));
}

/**
 * Handle `invoice.payment_failed` — fired when a card decline or other payment
 * failure prevents a subscription invoice from being paid. Stripe will mark
 * the subscription `past_due` → `unpaid` → `canceled` over several days. Mark
 * the local `billing_accounts.status` as `past_due` so the application can
 * surface dunning UI. The terminal `customer.subscription.deleted` event still
 * handles the eventual downgrade.
 */
async function handleInvoicePaymentFailed(
  env: Env,
  event: StripeWebhookEvent,
): Promise<void> {
  const invoice = event.data.object as {
    customer: string | { id: string };
  };
  const customerId = toStripeCustomerId(invoice.customer);
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.stripeCustomerId, customerId),
  ).get();
  if (!account) return;

  await db.update(billingAccounts).set({
    status: 'past_due',
    updatedAt: new Date().toISOString(),
  }).where(eq(billingAccounts.id, account.id));
}

/**
 * Best-effort idempotency dedup. Returns `true` if the event id was inserted
 * (i.e. not seen before) and the caller should dispatch. Returns `false` if
 * the event was already processed and should be skipped.
 *
 * Uses an INSERT OR IGNORE pattern: if two webhook deliveries race, only the
 * first INSERT succeeds, the second falls into the duplicate branch.
 */
async function recordWebhookEventIfNew(
  env: Env,
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const db = billingRouteDeps.getDb(env.DB);
  try {
    await db.insert(stripeWebhookEvents).values({
      id: eventId,
      type: eventType,
      receivedAt: new Date().toISOString(),
      status: 'received',
      errorMessage: null,
    }).onConflictDoNothing({ target: stripeWebhookEvents.id });
  } catch (err) {
    logWarn('Failed to record stripe webhook event id', { module: 'billing-webhook', detail: err });
    // Fall through and process — better to risk a duplicate than to drop the event.
    return true;
  }
  // Re-read to confirm whether THIS call inserted vs found an existing row.
  const row = await db.select({ status: stripeWebhookEvents.status })
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.id, eventId))
    .get();
  return row?.status === 'received';
}

async function markWebhookEventStatus(
  env: Env,
  eventId: string,
  status: 'processed' | 'skipped' | 'failed',
  errorMessage?: string,
): Promise<void> {
  try {
    const db = billingRouteDeps.getDb(env.DB);
    await db.update(stripeWebhookEvents).set({
      status,
      errorMessage: errorMessage ?? null,
    }).where(eq(stripeWebhookEvents.id, eventId));
  } catch (err) {
    logWarn('Failed to update stripe webhook event status', { module: 'billing-webhook', detail: err });
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

    // Idempotency dedup. Stripe retries failed deliveries for up to 3 days
    // and may also re-send identical events during replay; without dedup,
    // a retried `checkout.session.completed` for a Pro top-up would call
    // addCredits() multiple times, double-crediting the user.
    const eventId = (event as { id?: string }).id;
    if (eventId) {
      const isFirstSeen = await recordWebhookEventIfNew(c.env, eventId, event.type);
      if (!isFirstSeen) {
        logInfo(`Skipping duplicate stripe webhook ${eventId}`, {
          module: 'billing-webhook',
          detail: { type: event.type },
        });
        return c.json({ received: true, duplicate: true });
      }
    }

    try {
      if (isEventType(event, "checkout.session.completed")) {
        await handleCompletedCheckout(c.env, event);
      } else if (isEventType(event, "invoice.paid")) {
        await handleInvoicePaid(c.env, event);
      } else if (isEventType(event, "invoice.payment_failed")) {
        await handleInvoicePaymentFailed(c.env, event);
      } else if (isEventType(event, "customer.subscription.updated")) {
        await handleSubscriptionUpdated(c.env, event);
      } else if (isEventType(event, "customer.subscription.deleted")) {
        await handleSubscriptionDeleted(c.env, event);
      } else {
        // Acknowledge unknown event types so Stripe doesn't retry forever.
        if (eventId) await markWebhookEventStatus(c.env, eventId, 'skipped');
        return c.json({ received: true, skipped: true });
      }
      if (eventId) await markWebhookEventStatus(c.env, eventId, 'processed');
    } catch (err) {
      // Return 200 on processing errors to prevent Stripe retry storms.
      // The event id is recorded with status='failed' so an operator can
      // replay it manually after fixing the underlying issue. Without this,
      // a single failing event triggers retries × no-dedup → repeated side
      // effects once the transient cause clears.
      const message = err instanceof Error ? err.message : String(err);
      logError(`Error processing ${event.type}`, err, {
        module: "billing-webhook",
      });
      if (eventId) await markWebhookEventStatus(c.env, eventId, 'failed', message);
      return c.json({ received: true, error: 'processing_failed' });
    }

    return c.json({ received: true });
  });
