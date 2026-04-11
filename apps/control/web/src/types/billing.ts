export type BillingPlanTier = 'free' | 'plus' | 'pro';

export type BillingMode = 'free' | 'plus_subscription' | 'pro_prepaid';

export interface BillingAvailableActions {
  subscribe_plus: boolean;
  top_up_pro: boolean;
  manage_subscription: boolean;
}

export interface BillingTopupPack {
  id: string;
  label: string;
  credits_cents: number;
  featured: boolean;
  badge: string | null;
}

export interface BillingSummary {
  plan: {
    id: string;
    name: string;
    display_name: string;
  };
  plan_tier: BillingPlanTier;
  billing_mode: BillingMode;
  available_actions: BillingAvailableActions;
  topup_packs: BillingTopupPack[];
  runtime_limit_7d_seconds: number;
  balance_cents: number;
  status: string;
  // Backend exposes only presence flags, never the raw provider IDs.
  // (packages/control/src/server/routes/billing/account-routes.ts)
  has_payment_account: boolean;
  has_subscription: boolean;
  subscription_period_end: string | null;
}

export interface BillingInvoice {
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
}
