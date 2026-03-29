/**
 * Billing API Routes
 *
 * Endpoints for subscription management, usage viewing, and Stripe integration.
 */
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../route-auth';
export { getConfiguredProTopupPacks, resolveConfiguredProTopupPack, } from './stripe';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: BaseVariables;
}, {
    "/": {
        $get: {
            input: {};
            output: {
                plan: {
                    id: string;
                    name: string;
                    display_name: string;
                };
                plan_tier: import("../../../application/services/billing/billing-plans").BillingPlanTier;
                billing_mode: import("../../../application/services/billing/billing-plans").BillingMode;
                available_actions: {
                    subscribe_plus: boolean;
                    top_up_pro: boolean;
                    manage_subscription: boolean;
                };
                topup_packs: {
                    id: string;
                    label: string;
                    price_id: string;
                    credits_cents: number;
                    featured: boolean;
                    badge: string | null;
                }[];
                runtime_limit_7d_seconds: number;
                balance_cents: number;
                status: string;
                has_stripe_customer: boolean;
                has_subscription: boolean;
                subscription_period_end: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/usage": {
        $get: {
            input: {};
            output: {
                period_start: string;
                meters: {
                    meter_type: string;
                    units: number;
                    cost_cents: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/subscribe": {
        $post: {
            input: {};
            output: {
                url: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/credits/checkout": {
        $post: {
            input: {};
            output: {
                url: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/portal": {
        $post: {
            input: {};
            output: {
                url: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/invoices": {
        $get: {
            input: {};
            output: {
                invoices: {
                    id: string;
                    number: string | null;
                    status: string | null;
                    currency: string | null;
                    amount_due: number | null;
                    amount_paid: number | null;
                    total: number | null;
                    created: number | null;
                    period_start: number | null;
                    period_end: number | null;
                    hosted_invoice_url: string | null;
                    invoice_pdf: string | null;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/invoices/:id/pdf": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/invoices/:id/send": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/invoices/:id/send">;
export default _default;
export declare const billingWebhookHandler: import("hono/hono-base").HonoBase<{
    Bindings: Env;
}, {
    "/": {
        $post: {
            input: {};
            output: {
                received: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/">;
//# sourceMappingURL=routes.d.ts.map