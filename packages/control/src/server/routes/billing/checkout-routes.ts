import type { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import { logError } from "../../../shared/utils/logger.ts";
import {
  type BillingTopupPack,
  PLUS_SUBSCRIPTION_PURCHASE_KIND,
  PRO_TOPUP_PURCHASE_KIND,
  resolveConfiguredProTopupPack,
} from "./stripe.ts";
import { billingRouteDeps } from "./deps.ts";
import {
  getRequestOrigin,
  loadBillingAccount,
  requireStripeCustomerId,
  requireStripeSecretKey,
} from "./helpers.ts";

type BillingRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

export function registerBillingCheckoutRoutes(app: BillingRouter) {
  app.post("/subscribe", async (c) => {
    const secretKey = requireStripeSecretKey(c);
    const priceId = c.env.STRIPE_PLUS_PRICE_ID;
    if (!priceId) {
      throw new InternalError("Billing not configured");
    }

    const user = c.get("user");
    const account = await loadBillingAccount(c);
    if (account.stripeSubscriptionId) {
      throw new BadRequestError("Already subscribed");
    }

    const { url } = await billingRouteDeps.createCheckoutSession({
      secretKey,
      priceId,
      mode: "subscription",
      userId: user.id,
      customerEmail: user.email,
      stripeCustomerId: account.stripeCustomerId ?? undefined,
      successUrl: `${getRequestOrigin(c)}/?billing=success`,
      cancelUrl: `${getRequestOrigin(c)}/?billing=cancel`,
      metadata: {
        purchase_kind: PLUS_SUBSCRIPTION_PURCHASE_KIND,
      },
    });

    return c.json({ url });
  });

  app.post("/credits/checkout", async (c) => {
    const secretKey = requireStripeSecretKey(c);
    const body = await c.req.json().catch(() => null) as
      | { pack_id?: unknown }
      | null;
    const packId = typeof body?.pack_id === "string" ? body.pack_id.trim() : "";
    if (!packId) {
      throw new BadRequestError("pack_id is required");
    }

    let pack: BillingTopupPack;
    try {
      pack = resolveConfiguredProTopupPack(c.env, packId);
    } catch (err) {
      if (
        err instanceof Error && err.message.startsWith("Unknown top-up pack:")
      ) {
        throw new NotFoundError("Top-up pack");
      }
      logError("invalid pro top-up configuration", err, { module: "billing" });
      throw new InternalError("Billing not configured");
    }

    const user = c.get("user");
    const account = await loadBillingAccount(c);
    if (account.stripeSubscriptionId || account.planId === "plan_plus") {
      throw new ConflictError(
        "Plus subscription is active; cancel it before switching to Pro",
      );
    }

    const { url } = await billingRouteDeps.createCheckoutSession({
      secretKey,
      priceId: pack.priceId,
      mode: "payment",
      userId: user.id,
      customerEmail: user.email,
      stripeCustomerId: account.stripeCustomerId ?? undefined,
      successUrl: `${getRequestOrigin(c)}/?billing=success`,
      cancelUrl: `${getRequestOrigin(c)}/?billing=cancel`,
      metadata: {
        purchase_kind: PRO_TOPUP_PURCHASE_KIND,
        pack_id: pack.id,
      },
    });

    return c.json({ url });
  });

  app.post("/portal", async (c) => {
    const secretKey = requireStripeSecretKey(c);
    const { customerId } = await requireStripeCustomerId(c);

    const { url } = await billingRouteDeps.createPortalSession({
      secretKey,
      customerId,
      returnUrl: `${getRequestOrigin(c)}/?section=billing`,
    });

    return c.json({ url });
  });
}
