import type { Env } from '../../../shared/types';
import type { StripeWebhookEvent, StripeWebhookEventType } from '../../../application/services/billing/stripe';
export declare const PLUS_SUBSCRIPTION_PURCHASE_KIND = "plus_subscription";
export declare const PRO_TOPUP_PURCHASE_KIND = "pro_topup";
export interface BillingTopupPack {
    id: string;
    label: string;
    priceId: string;
    creditsCents: number;
    featured: boolean;
    badge: string | null;
}
export declare function toStripeCustomerId(value: string | {
    id: string;
}): string;
export declare function getAvailableActions(account: {
    planId: string;
    stripeSubscriptionId?: string | null;
}, hasTopupPacks: boolean): {
    subscribe_plus: boolean;
    top_up_pro: boolean;
    manage_subscription: boolean;
};
export declare function getConfiguredProTopupPacks(env: Env): BillingTopupPack[];
export declare function resolveConfiguredProTopupPack(env: Env, packId: string): BillingTopupPack;
export declare function toTopupPackResponse(pack: BillingTopupPack): {
    id: string;
    label: string;
    price_id: string;
    credits_cents: number;
    featured: boolean;
    badge: string | null;
};
export declare function isEventType<T extends StripeWebhookEventType>(event: StripeWebhookEvent, type: T): event is StripeWebhookEvent<T>;
//# sourceMappingURL=stripe.d.ts.map