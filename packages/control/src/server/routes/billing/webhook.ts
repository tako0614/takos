import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { BadRequestError, InternalError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { billingAccounts, stripeWebhookEvents } from "../../../infra/db/schema.ts";
import { logError, logInfo, logWarn } from "../../../shared/utils/logger.ts";
import type {
  BillingWebhookEvent,
  CompletedCheckoutSession,
  PaymentProvider,
} from "../../../application/services/billing/payment-provider.ts";
import {
  PLUS_SUBSCRIPTION_PURCHASE_KIND,
  PRO_TOPUP_PURCHASE_KIND,
  resolveConfiguredProTopupPack,
} from "../../../application/services/billing/providers/stripe/stripe-purchase-config.ts";
import { billingRouteDeps } from "./deps.ts";

/**
 * Resolve the payment provider, normalizing config errors to a documented
 * InternalError. The provider factory throws a plain `Error` when its config
 * env vars are missing; we re-wrap so the global error handler returns the
 * documented `{ error: { code: "INTERNAL_ERROR", message: "Webhook not
 * configured" } }` envelope instead of bubbling out as an unstructured 500.
 */
function resolveProviderOrThrow(env: Env): PaymentProvider {
  try {
    return billingRouteDeps.resolvePaymentProvider(env);
  } catch (err) {
    logError("Payment provider not configured", err, {
      module: "billing-webhook",
    });
    throw new InternalError("Webhook not configured");
  }
}

async function handleCompletedCheckout(
  env: Env,
  session: CompletedCheckoutSession,
): Promise<void> {
  const userId = session.metadata?.user_id;
  if (!userId) {
    return;
  }

  const provider = resolveProviderOrThrow(env);
  // Re-fetch the session to ensure we have the latest customer/subscription
  // bindings — the webhook payload is sometimes a stripped-down version of the
  // full session object.
  const fullSession = await provider.retrieveCheckoutSession(session.sessionId);

  const account = await billingRouteDeps.getOrCreateBillingAccount(
    env.DB,
    userId,
  );
  const purchaseKind = fullSession.metadata?.purchase_kind ??
    session.metadata?.purchase_kind;
  const db = billingRouteDeps.getDb(env.DB);

  if (purchaseKind === PLUS_SUBSCRIPTION_PURCHASE_KIND) {
    if (!fullSession.customerId || !fullSession.subscriptionId) {
      throw new Error(
        "Plus subscription checkout did not return customer/subscription",
      );
    }

    await db.update(billingAccounts).set({
      planId: "plan_plus",
      providerName: provider.name,
      providerCustomerId: fullSession.customerId,
      providerSubscriptionId: fullSession.subscriptionId,
      subscriptionStartedAt: new Date().toISOString(),
      subscriptionPeriodEnd: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
    return;
  }

  if (purchaseKind === PRO_TOPUP_PURCHASE_KIND) {
    if (fullSession.paymentStatus !== "paid") {
      return;
    }
    const packId = fullSession.metadata?.pack_id ?? session.metadata?.pack_id;
    if (!packId) {
      throw new Error("Pro top-up checkout did not include pack_id");
    }
    const pack = resolveConfiguredProTopupPack(env, packId);
    await db.update(billingAccounts).set({
      planId: "plan_payg",
      providerName: provider.name,
      providerCustomerId: fullSession.customerId ?? account.providerCustomerId ??
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
  event: Extract<BillingWebhookEvent, { kind: "invoice_paid" }>,
): Promise<void> {
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.providerCustomerId, event.customerId),
  ).get();

  if (account && account.planId === "plan_plus" && event.currentPeriodEndUnix) {
    await db.update(billingAccounts).set({
      subscriptionPeriodEnd: new Date(event.currentPeriodEndUnix * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
  }
}

async function handleSubscriptionCanceled(
  env: Env,
  event: Extract<BillingWebhookEvent, { kind: "subscription_canceled" }>,
): Promise<void> {
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.providerCustomerId, event.customerId),
  ).get();

  if (account) {
    await db.update(billingAccounts).set({
      planId: account.balanceCents > 0 ? "plan_payg" : "plan_free",
      providerSubscriptionId: null,
      subscriptionStartedAt: null,
      subscriptionPeriodEnd: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(billingAccounts.id, account.id));
  }
}

/**
 * Handle subscription updates fired when a subscription changes via the
 * provider's billing portal (plan change, cancel-at-period-end toggle,
 * payment-method-driven status change, trial transitions). Without this
 * handler the kernel's view of `subscriptionPeriodEnd` and `status` drifts
 * from the provider's ground truth.
 */
async function handleSubscriptionUpdated(
  env: Env,
  event: Extract<BillingWebhookEvent, { kind: "subscription_updated" }>,
): Promise<void> {
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.providerCustomerId, event.customerId),
  ).get();
  if (!account) return;

  const periodEndIso = event.currentPeriodEndUnix !== null
    ? new Date(event.currentPeriodEndUnix * 1000).toISOString()
    : account.subscriptionPeriodEnd ?? null;

  await db.update(billingAccounts).set({
    status: event.status ?? account.status,
    subscriptionPeriodEnd: periodEndIso,
    updatedAt: new Date().toISOString(),
  }).where(eq(billingAccounts.id, account.id));
}

/**
 * Handle a payment failure (card decline etc) on a subscription invoice. The
 * provider will mark the subscription `past_due` → `unpaid` → `canceled` over
 * several days. We mark the local `billing_accounts.status` as `past_due` so
 * the application can surface dunning UI. The terminal `subscription_canceled`
 * event still handles the eventual downgrade.
 */
async function handleInvoicePaymentFailed(
  env: Env,
  event: Extract<BillingWebhookEvent, { kind: "invoice_payment_failed" }>,
): Promise<void> {
  const db = billingRouteDeps.getDb(env.DB);

  const account = await db.select().from(billingAccounts).where(
    eq(billingAccounts.providerCustomerId, event.customerId),
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
 *
 * Note: this stores into `stripe_webhook_events`, kept under that name for
 * historical reasons even though the table now serves any payment provider.
 * See `schema-billing.ts` for the rationale.
 */
async function recordWebhookEventIfNew(
  env: Env,
  eventId: string,
  eventKind: string,
): Promise<boolean> {
  const db = billingRouteDeps.getDb(env.DB);
  try {
    await db.insert(stripeWebhookEvents).values({
      id: eventId,
      type: eventKind,
      receivedAt: new Date().toISOString(),
      status: 'received',
      errorMessage: null,
    }).onConflictDoNothing({ target: stripeWebhookEvents.id });
  } catch (err) {
    logWarn('Failed to record webhook event id', { module: 'billing-webhook', detail: err });
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
    logWarn('Failed to update webhook event status', { module: 'billing-webhook', detail: err });
  }
}

export const billingWebhookHandler = new Hono<{ Bindings: Env }>()
  .post("/", async (c) => {
    const provider = resolveProviderOrThrow(c.env);

    // Stripe sends the signature in the `stripe-signature` header. Other
    // providers may use a different header name; for now we only support
    // Stripe so this is hardcoded. Future providers should expose their
    // expected header name through a `PaymentProvider` extension.
    const signature = c.req.header("stripe-signature");
    if (!signature) {
      throw new BadRequestError("Missing signature");
    }

    const payload = await c.req.text();

    let event: BillingWebhookEvent;
    try {
      event = await provider.parseWebhook(payload, signature);
    } catch (err) {
      logError("Webhook signature verification failed", err, {
        module: "billing-webhook",
      });
      throw new BadRequestError("Invalid signature");
    }

    // Idempotency dedup. Provider webhooks may retry failed deliveries and
    // replay events; without dedup, a retried checkout completion would call
    // addCredits() multiple times, double-crediting the user.
    const eventId = event.eventId;
    if (eventId) {
      const isFirstSeen = await recordWebhookEventIfNew(c.env, eventId, event.kind);
      if (!isFirstSeen) {
        logInfo(`Skipping duplicate webhook ${eventId}`, {
          module: 'billing-webhook',
          detail: { kind: event.kind },
        });
        return c.json({ received: true, duplicate: true });
      }
    }

    try {
      switch (event.kind) {
        case "checkout_completed":
          await handleCompletedCheckout(c.env, event.session);
          break;
        case "invoice_paid":
          await handleInvoicePaid(c.env, event);
          break;
        case "invoice_payment_failed":
          await handleInvoicePaymentFailed(c.env, event);
          break;
        case "subscription_updated":
          await handleSubscriptionUpdated(c.env, event);
          break;
        case "subscription_canceled":
          await handleSubscriptionCanceled(c.env, event);
          break;
        case "unhandled":
          // Acknowledge unknown event types so the provider doesn't retry forever.
          if (eventId) await markWebhookEventStatus(c.env, eventId, 'skipped');
          return c.json({ received: true, skipped: true });
      }
      if (eventId) await markWebhookEventStatus(c.env, eventId, 'processed');
    } catch (err) {
      // Return 200 on processing errors to prevent provider retry storms.
      // The event id is recorded with status='failed' so an operator can
      // replay it manually after fixing the underlying issue.
      const message = err instanceof Error ? err.message : String(err);
      logError(`Error processing ${event.kind}`, err, {
        module: "billing-webhook",
      });
      if (eventId) await markWebhookEventStatus(c.env, eventId, 'failed', message);
      return c.json({ received: true, error: 'processing_failed' });
    }

    return c.json({ received: true });
  });
