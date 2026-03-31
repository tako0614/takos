/**
 * Billing API Routes
 *
 * Endpoints for subscription management, usage viewing, and Stripe integration.
 */

import { Hono } from 'hono';
import type { Env } from '../../../shared/types/index.ts';
import type { BaseVariables } from '../route-auth.ts';
import { getDb } from '../../../infra/db/index.ts';
import { billingAccounts, usageRollups } from '../../../infra/db/schema.ts';
import { eq, and } from 'drizzle-orm';

import {
  getOrCreateBillingAccount,
  addCredits,
  assertBillingPlanId,
  resolveBillingMode,
  resolveBillingPlanTier,
  WEEKLY_RUNTIME_LIMIT_SECONDS,
} from '../../../application/services/billing/billing.ts';
import {
  createCheckoutSession,
  createPortalSession,
  verifyWebhookSignature,
  retrieveCheckoutSession,
  listInvoices,
  retrieveInvoice,
  sendInvoice,
} from '../../../application/services/billing/stripe.ts';
import type {
  StripeWebhookEvent,
  StripeWebhookEventType,
} from '../../../application/services/billing/stripe.ts';
import {
  PLUS_SUBSCRIPTION_PURCHASE_KIND,
  PRO_TOPUP_PURCHASE_KIND,
  getAvailableActions,
  getConfiguredProTopupPacks,
  resolveConfiguredProTopupPack,
  toStripeCustomerId,
  toTopupPackResponse,
  type BillingTopupPack,
  isEventType,
} from './stripe.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';
import { BadRequestError, NotFoundError, ConflictError, InternalError, BadGatewayError } from 'takos-common/errors';

export {
  getConfiguredProTopupPacks,
  resolveConfiguredProTopupPack,
} from './stripe.ts';

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()

  .get('/', async (c) => {
    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);
    let topupPacks: BillingTopupPack[];
    let planId: ReturnType<typeof assertBillingPlanId>;
    try {
      planId = assertBillingPlanId(account.planId);
      topupPacks = getConfiguredProTopupPacks(c.env);
    } catch (err) {
      logError('invalid plan on account', err, { module: 'billing' });
      throw new InternalError('Billing configuration incomplete');
    }

    return c.json({
      plan: {
        id: account.billingPlan.id,
        name: account.billingPlan.name,
        display_name: account.billingPlan.displayName,
      },
      plan_tier: resolveBillingPlanTier(planId),
      billing_mode: resolveBillingMode(planId),
      available_actions: getAvailableActions(account, topupPacks.length > 0),
      topup_packs: topupPacks.map(toTopupPackResponse),
      runtime_limit_7d_seconds: WEEKLY_RUNTIME_LIMIT_SECONDS,
      balance_cents: account.balanceCents,
      status: account.status,
      has_stripe_customer: !!account.stripeCustomerId,
      has_subscription: !!account.stripeSubscriptionId,
      subscription_period_end: account.subscriptionPeriodEnd ?? null,
    });
  })

  .get('/usage', async (c) => {
    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);
    const db = getDb(c.env.DB);

    const d = new Date();
    const periodStart = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const meters = await db.select({
      meterType: usageRollups.meterType,
      units: usageRollups.units,
      costCents: usageRollups.costCents,
    }).from(usageRollups).where(
      and(
        eq(usageRollups.accountId, account.id),
        eq(usageRollups.periodStart, periodStart),
      )
    ).all();

    return c.json({
      period_start: periodStart,
      meters: meters.map((m) => ({
        meter_type: m.meterType,
        units: m.units,
        cost_cents: m.costCents,
      })),
    });
  })

  .post('/subscribe', async (c) => {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    const priceId = c.env.STRIPE_PLUS_PRICE_ID;
    if (!secretKey || !priceId) {
      throw new InternalError('Billing not configured');
    }

    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);

    if (account.stripeSubscriptionId) {
      throw new BadRequestError('Already subscribed');
    }

    const origin = new URL(c.req.url).origin;

    const { url } = await createCheckoutSession({
      secretKey,
      priceId,
      mode: 'subscription',
      userId: user.id,
      customerEmail: user.email,
      stripeCustomerId: account.stripeCustomerId ?? undefined,
      successUrl: `${origin}/?billing=success`,
      cancelUrl: `${origin}/?billing=cancel`,
      metadata: {
        purchase_kind: PLUS_SUBSCRIPTION_PURCHASE_KIND,
      },
    });

    return c.json({ url });
  })

  .post('/credits/checkout', async (c) => {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new InternalError('Billing not configured');
    }

    const body = await c.req.json().catch(() => null) as { pack_id?: unknown } | null;
    const packId = typeof body?.pack_id === 'string' ? body.pack_id.trim() : '';
    if (!packId) {
      throw new BadRequestError('pack_id is required');
    }

    let pack: BillingTopupPack;
    try {
      pack = resolveConfiguredProTopupPack(c.env, packId);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Unknown top-up pack:')) {
        throw new NotFoundError('Top-up pack');
      }
      logError('invalid pro top-up configuration', err, { module: 'billing' });
      throw new InternalError('Billing not configured');
    }

    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);
    if (account.stripeSubscriptionId || account.planId === 'plan_plus') {
      throw new ConflictError('Plus subscription is active; cancel it before switching to Pro');
    }

    const origin = new URL(c.req.url).origin;

    const { url } = await createCheckoutSession({
      secretKey,
      priceId: pack.priceId,
      mode: 'payment',
      userId: user.id,
      customerEmail: user.email,
      stripeCustomerId: account.stripeCustomerId ?? undefined,
      successUrl: `${origin}/?billing=success`,
      cancelUrl: `${origin}/?billing=cancel`,
      metadata: {
        purchase_kind: PRO_TOPUP_PURCHASE_KIND,
        pack_id: pack.id,
      },
    });

    return c.json({ url });
  })

  .post('/portal', async (c) => {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new InternalError('Billing not configured');
    }

    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);

    if (!account.stripeCustomerId) {
      throw new BadRequestError('No Stripe customer found');
    }

    const origin = new URL(c.req.url).origin;

    const { url } = await createPortalSession({
      secretKey,
      customerId: account.stripeCustomerId,
      returnUrl: `${origin}/?section=billing`,
    });

    return c.json({ url });
  })

  .get('/invoices', async (c) => {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new InternalError('Billing not configured');
    }

    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);

    if (!account.stripeCustomerId) {
      throw new BadRequestError('No Stripe customer found');
    }

    const url = new URL(c.req.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '20');
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 20, 1), 100);
    const startingAfter = url.searchParams.get('starting_after') ?? undefined;
    const endingBefore = url.searchParams.get('ending_before') ?? undefined;

    try {
      const result = await listInvoices({
        secretKey,
        customerId: account.stripeCustomerId,
        limit,
        startingAfter,
        endingBefore,
      });

      return c.json({
        invoices: result.invoices.map((inv) => ({
          id: inv.id,
          number: inv.number ?? null,
          status: inv.status ?? null,
          currency: inv.currency ?? null,
          amount_due: inv.amount_due ?? null,
          amount_paid: inv.amount_paid ?? null,
          total: inv.total ?? null,
          created: inv.created ?? null,
          period_start: inv.period_start ?? null,
          period_end: inv.period_end ?? null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          invoice_pdf: inv.invoice_pdf ?? null,
        })),
        has_more: result.has_more,
      });
    } catch (err) {
      logError('listInvoices failed', err, { module: 'billing' });
      throw new BadGatewayError('Failed to list invoices');
    }
  })

  .get('/invoices/:id/pdf', async (c) => {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new InternalError('Billing not configured');
    }

    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);

    if (!account.stripeCustomerId) {
      throw new BadRequestError('No Stripe customer found');
    }

    const invoiceId = c.req.param('id');

    let invoice;
    try {
      invoice = await retrieveInvoice({ secretKey, invoiceId });
    } catch (err) {
      logError('retrieveInvoice failed', err, { module: 'billing' });
      throw new NotFoundError('Invoice');
    }

    const invoiceCustomerId = toStripeCustomerId(invoice.customer);
    if (invoiceCustomerId !== account.stripeCustomerId) {
      throw new NotFoundError('Invoice');
    }

    const pdfUrl = typeof invoice.invoice_pdf === 'string' && invoice.invoice_pdf
      ? invoice.invoice_pdf
      : null;
    if (!pdfUrl) {
      throw new NotFoundError('Invoice PDF');
    }

    let pdfUrlParsed: URL;
    try {
      pdfUrlParsed = new URL(pdfUrl);
    } catch {
      logError('invoice_pdf URL is malformed', pdfUrl, { module: 'billing' });
      throw new NotFoundError('Invoice PDF');
    }
    if (!pdfUrlParsed.hostname.endsWith('.stripe.com')) {
      logError('invoice_pdf URL is not from stripe.com', pdfUrlParsed.hostname, { module: 'billing' });
      throw new NotFoundError('Invoice PDF');
    }

    let pdfRes: Response;
    try {
      pdfRes = await fetch(pdfUrl);
    } catch (err) {
      logError('failed to fetch invoice_pdf URL', err, { module: 'billing' });
      throw new BadGatewayError('Failed to fetch invoice PDF');
    }

    if (!pdfRes.ok || !pdfRes.body) {
      const text = await pdfRes.text().catch((e) => { logWarn('Failed to read invoice PDF response body', { module: 'billing', error: String(e) }); return ''; });
      logError('invoice_pdf fetch failed', { status: pdfRes.status, text }, { module: 'billing' });
      throw new BadGatewayError('Failed to fetch invoice PDF');
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    headers.set('Content-Disposition', `attachment; filename="stripe-invoice-${invoiceId}.pdf"`);
    headers.set('Cache-Control', 'no-store');
    const contentLength = pdfRes.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    return new Response(pdfRes.body, { status: 200, headers });
  })

  .post('/invoices/:id/send', async (c) => {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new InternalError('Billing not configured');
    }

    const user = c.get('user');
    const account = await getOrCreateBillingAccount(c.env.DB, user.id);

    if (!account.stripeCustomerId) {
      throw new BadRequestError('No Stripe customer found');
    }

    const invoiceId = c.req.param('id');

    let invoice;
    try {
      invoice = await retrieveInvoice({ secretKey, invoiceId });
    } catch (err) {
      logError('retrieveInvoice failed', err, { module: 'billing' });
      throw new NotFoundError('Invoice');
    }

    const invoiceCustomerId = toStripeCustomerId(invoice.customer);
    if (invoiceCustomerId !== account.stripeCustomerId) {
      throw new NotFoundError('Invoice');
    }

    try {
      await sendInvoice({ secretKey, invoiceId });
    } catch (err) {
      logError('sendInvoice failed', err, { module: 'billing' });
      throw new BadGatewayError('Failed to send invoice email');
    }

    return c.json({ success: true });
  });

export const billingWebhookHandler = new Hono<{ Bindings: Env }>()

  .post('/', async (c) => {
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secret || !secretKey) {
      throw new InternalError('Webhook not configured');
    }

    const signature = c.req.header('stripe-signature');
    if (!signature) {
      throw new BadRequestError('Missing signature');
    }

    const payload = await c.req.text();

    let event: StripeWebhookEvent;
    try {
      ({ event } = await verifyWebhookSignature({
        payload,
        signature,
        secret,
      }));
    } catch (err) {
      logError('Signature verification failed', err, { module: 'billing-webhook' });
      throw new BadRequestError('Invalid signature');
    }

    const db = getDb(c.env.DB);

    try {
      if (isEventType(event, 'checkout.session.completed')) {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (userId) {
          const fullSession = await retrieveCheckoutSession({
            secretKey,
            sessionId: session.id,
          });

          const account = await getOrCreateBillingAccount(c.env.DB, userId);
          const purchaseKind = fullSession.metadata?.purchase_kind ?? session.metadata?.purchase_kind;

          if (purchaseKind === PLUS_SUBSCRIPTION_PURCHASE_KIND) {
            if (!fullSession.customer || !fullSession.subscription) {
              throw new Error('Plus subscription checkout did not return customer/subscription');
            }

            await db.update(billingAccounts).set({
              planId: 'plan_plus',
              stripeCustomerId: fullSession.customer,
              stripeSubscriptionId: fullSession.subscription,
              subscriptionStartedAt: new Date().toISOString(),
              subscriptionPeriodEnd: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(billingAccounts.id, account.id));
          } else if (purchaseKind === PRO_TOPUP_PURCHASE_KIND) {
            if (fullSession.payment_status !== 'paid') {
              return c.json({ received: true });
            }
            const packId = fullSession.metadata?.pack_id ?? session.metadata?.pack_id;
            if (!packId) {
              throw new Error('Pro top-up checkout did not include pack_id');
            }
            const pack = resolveConfiguredProTopupPack(c.env, packId);
            await db.update(billingAccounts).set({
              planId: 'plan_payg',
              stripeCustomerId: fullSession.customer ?? account.stripeCustomerId ?? null,
              updatedAt: new Date().toISOString(),
            }).where(eq(billingAccounts.id, account.id));
            await addCredits(c.env.DB, account.id, pack.creditsCents, `Pro top-up credit (${pack.id}, ${pack.creditsCents}¢)`);
          }
        }
      } else if (isEventType(event, 'invoice.paid')) {
        const invoice = event.data.object;
        const customerId = toStripeCustomerId(invoice.customer);
        const periodEnd = invoice.lines?.data?.[0]?.period?.end ?? null;

        const account = await db.select().from(billingAccounts).where(
          eq(billingAccounts.stripeCustomerId, customerId)
        ).get();

        if (account && account.planId === 'plan_plus' && periodEnd) {
          await db.update(billingAccounts).set({
            subscriptionPeriodEnd: new Date(periodEnd * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
          }).where(eq(billingAccounts.id, account.id));
        }
      } else if (isEventType(event, 'customer.subscription.deleted')) {
        const sub = event.data.object;

        const account = await db.select().from(billingAccounts).where(
          eq(billingAccounts.stripeCustomerId, sub.customer)
        ).get();

        if (account) {
          await db.update(billingAccounts).set({
            planId: account.balanceCents > 0 ? 'plan_payg' : 'plan_free',
            stripeSubscriptionId: null,
            subscriptionStartedAt: null,
            subscriptionPeriodEnd: null,
            updatedAt: new Date().toISOString(),
          }).where(eq(billingAccounts.id, account.id));
        }
      }
    } catch (err) {
      logError(`Error processing ${event.type}`, err, { module: 'billing-webhook' });
      throw new InternalError('Webhook processing failed');
    }

    return c.json({ received: true });
  });
