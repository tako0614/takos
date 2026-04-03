import { createEffect, onCleanup, createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { useToast } from '../../store/toast.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Button } from '../../components/ui/index.ts';
import type { BillingInvoice, BillingSummary, User } from '../../types/index.ts';
import {
  formatBillingCurrency,
  formatBillingDate,
  sortBillingTopupPacks,
} from './settings-billing.ts';
import { Section } from './SettingsShared.tsx';

export function SettingsBilling(props: { user: User | null }) {
  const { t, lang } = useI18n();
  const { showToast } = useToast();

  const [billingSummary, setBillingSummary] = createSignal<BillingSummary | null>(null);
  const [billingInvoices, setBillingInvoices] = createSignal<BillingInvoice[]>([]);
  const [billingLoading, setBillingLoading] = createSignal(true);
  const [billingError, setBillingError] = createSignal<string | null>(null);
  const [billingReloadNonce, setBillingReloadNonce] = createSignal(0);
  const [billingAction, setBillingAction] = createSignal<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = createSignal(false);
  const [invoiceError, setInvoiceError] = createSignal<string | null>(null);

  const sortedTopupPacks = () => {
    const bs = billingSummary();
    return bs ? sortBillingTopupPacks(bs.topup_packs) : [];
  };
  const billingModeLabel = () => {
    const bs = billingSummary();
    return bs
      ? bs.billing_mode === 'plus_subscription'
        ? t('billingModePlus')
        : bs.billing_mode === 'pro_prepaid'
          ? t('billingModePro')
          : t('billingModeFree')
      : '';
  };

  createEffect(() => {
    billingReloadNonce();

    if (!props.user) {
      setBillingSummary(null);
      setBillingInvoices([]);
      setBillingLoading(false);
      setBillingError(null);
      setInvoiceError(null);
      return;
    }

    let cancelled = false;

    const loadBilling = async () => {
      setBillingLoading(true);
      setBillingError(null);
      setInvoiceError(null);

      try {
        const billingRes = await rpc.billing.$get();
        const nextBilling = await rpcJson<BillingSummary>(billingRes);
        if (cancelled) {
          return;
        }

        if (nextBilling.billing_enabled === false) {
          setBillingSummary(null);
          setBillingLoading(false);
          return;
        }

        setBillingSummary(nextBilling);

        if (!nextBilling.stripe_customer_id) {
          setBillingInvoices([]);
          setInvoiceLoading(false);
          return;
        }

        try {
          setInvoiceLoading(true);
          const invoicesRes = await rpc.billing.invoices.$get();
          const invoicesData = await rpcJson<{ invoices: BillingInvoice[] }>(invoicesRes);
          if (cancelled) {
            return;
          }
          setBillingInvoices(invoicesData.invoices);
        } catch (err) {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : t('billingInvoicesLoadFailed');
            setBillingInvoices([]);
            setInvoiceError(message);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('billingLoadFailed');
          setBillingSummary(null);
          setBillingInvoices([]);
          setBillingError(message);
        }
      } finally {
        if (!cancelled) {
          setBillingLoading(false);
          setInvoiceLoading(false);
        }
      }
    };

    void loadBilling();

    onCleanup(() => {
      cancelled = true;
    });
  });

  const handleSubscribePlus = async () => {
    setBillingAction('subscribe_plus');
    try {
      const res = await rpc.billing.subscribe.$post();
      const data = await rpcJson<{ url: string }>(res);
      globalThis.location.assign(data.url);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('billingSubscribeFailed'));
      setBillingAction(null);
    }
  };

  const handleManageSubscription = async () => {
    setBillingAction('manage_subscription');
    try {
      const res = await rpc.billing.portal.$post();
      const data = await rpcJson<{ url: string }>(res);
      globalThis.location.assign(data.url);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('billingPortalFailed'));
      setBillingAction(null);
    }
  };

  const handleTopupCheckout = async (packId: string) => {
    setBillingAction(`topup:${packId}`);
    try {
      const res = await rpc.billing.credits.checkout.$post({
        json: { pack_id: packId },
      });
      const data = await rpcJson<{ url: string }>(res);
      globalThis.location.assign(data.url);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('billingTopupFailed'));
      setBillingAction(null);
    }
  };

  const handleSendInvoice = async (invoiceId: string) => {
    setBillingAction(`send:${invoiceId}`);
    try {
      const res = await rpc.billing.invoices[':id'].send.$post({
        param: { id: invoiceId },
      });
      await rpcJson<{ success: boolean }>(res);
      showToast('success', t('billingInvoiceSent'));
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('billingInvoiceSendFailed'));
    } finally {
      setBillingAction(null);
    }
  };

  const handleDownloadInvoice = (invoiceId: string) => {
    globalThis.open(`/api/billing/invoices/${invoiceId}/pdf`, '_blank', 'noopener,noreferrer');
  };

  // Hide billing section entirely when billing is disabled
  if (!billingLoading() && !billingError() && !billingSummary()) {
    return null;
  }

  return (
    <Section title={t('billingTitle')}>
      {billingLoading() && (
        <div class="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <Icons.Loader class="h-4 w-4 animate-spin" />
          <span>{t('loading')}</span>
        </div>
      )}

      {!billingLoading() && billingError() && (
        <div class="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <p>{billingError()}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setBillingReloadNonce((current) => current + 1)}
          >
            {t('refresh')}
          </Button>
        </div>
      )}

      {!billingLoading() && !billingError() && billingSummary() && (() => {
        const bs = billingSummary()!;
        return (
        <div class="space-y-4">
          <div class="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('billingCurrentPlan')}
                </div>
                <div class="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {bs.plan.display_name}
                </div>
              </div>
              <div class="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                {billingModeLabel()}
              </div>
            </div>
            <div class="grid gap-3 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2">
              <div>
                <div class="text-zinc-500 dark:text-zinc-400">{t('billingStatus')}</div>
                <div class="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{bs.status}</div>
              </div>
              <div>
                <div class="text-zinc-500 dark:text-zinc-400">{t('billingBalance')}</div>
                <div class="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                  {formatBillingCurrency(bs.balance_cents, lang)}
                </div>
              </div>
              <div>
                <div class="text-zinc-500 dark:text-zinc-400">{t('billingPeriodEnd')}</div>
                <div class="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                  {formatBillingDate(bs.subscription_period_end, lang)}
                </div>
              </div>
              <div>
                <div class="text-zinc-500 dark:text-zinc-400">{t('billingRuntimeLimit')}</div>
                <div class="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                  {t('billingRuntimeLimitValue', {
                    hours: String(Math.round(bs.runtime_limit_7d_seconds / 3600)),
                  })}
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div class="mb-3">
              <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('billingPlans')}</div>
              <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {t('billingPlansHint')}
              </p>
            </div>
            <div class="grid gap-3 md:grid-cols-3">
              <div class={`rounded-2xl border p-4 ${bs.plan_tier === 'free' ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('billingPlanFreeTitle')}</div>
                <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('billingPlanFreeDesc')}</p>
                <div class="mt-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {bs.plan_tier === 'free' ? t('billingCurrentBadge') : t('billingIncludedBadge')}
                </div>
              </div>

              <div class={`rounded-2xl border p-4 ${bs.plan_tier === 'plus' ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('billingPlanPlusTitle')}</div>
                <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('billingPlanPlusDesc')}</p>
                <div class="mt-4">
                  {bs.available_actions.subscribe_plus ? (
                    <Button
                      size="sm"
                      onClick={() => void handleSubscribePlus()}
                      isLoading={billingAction() === 'subscribe_plus'}
                    >
                      {t('billingSubscribePlus')}
                    </Button>
                  ) : bs.available_actions.manage_subscription ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleManageSubscription()}
                      isLoading={billingAction() === 'manage_subscription'}
                    >
                      {t('billingManageSubscription')}
                    </Button>
                  ) : (
                    <div class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {bs.plan_tier === 'plus' ? t('billingCurrentBadge') : t('billingUnavailable')}
                    </div>
                  )}
                </div>
              </div>

              <div class={`rounded-2xl border p-4 ${bs.plan_tier === 'pro' ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'}`}>
                <div class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('billingPlanProTitle')}</div>
                <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('billingPlanProDesc')}</p>
                <div class="mt-4 space-y-2">
                  {sortedTopupPacks().map((pack) => (
                    <div
                      class="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {pack.label}
                          </div>
                          <div class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                            {formatBillingCurrency(pack.credits_cents, lang)}
                          </div>
                        </div>
                        {pack.badge && (
                          <span class="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {pack.badge}
                          </span>
                        )}
                      </div>
                      <div class="mt-3">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!bs.available_actions.top_up_pro}
                          isLoading={billingAction() === `topup:${pack.id}`}
                          onClick={() => void handleTopupCheckout(pack.id)}
                        >
                          {t('billingTopupPack')}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!bs.available_actions.top_up_pro && (
                    <div class="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('billingTopupBlocked')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('billingCredits')}</div>
            <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('billingCreditsHint')}
            </p>
            <div class="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {formatBillingCurrency(bs.balance_cents, lang)}
            </div>
            {bs.plan_tier === 'plus' && bs.balance_cents > 0 && (
              <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {t('billingDormantBalanceNote')}
              </p>
            )}
          </div>

          <div class="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div class="mb-3">
              <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('billingInvoices')}</div>
              <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {t('billingInvoicesHint')}
              </p>
            </div>

            {!bs.stripe_customer_id && (
              <div class="text-sm text-zinc-500 dark:text-zinc-400">
                {t('billingNoCustomer')}
              </div>
            )}

            {bs.stripe_customer_id && invoiceLoading() && (
              <div class="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                <Icons.Loader class="h-4 w-4 animate-spin" />
                <span>{t('loading')}</span>
              </div>
            )}

            {bs.stripe_customer_id && !invoiceLoading() && invoiceError() && (
              <div class="text-sm text-amber-700 dark:text-amber-300">{invoiceError()}</div>
            )}

            {bs.stripe_customer_id && !invoiceLoading() && !invoiceError() && billingInvoices().length === 0 && (
              <div class="text-sm text-zinc-500 dark:text-zinc-400">
                {t('billingNoInvoices')}
              </div>
            )}

            {bs.stripe_customer_id && !invoiceLoading() && billingInvoices().length > 0 && (
              <div class="space-y-3">
                {billingInvoices().map((invoice: BillingInvoice) => (
                  <div
                    class="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {invoice.number || invoice.id}
                      </div>
                      <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatBillingDate(invoice.created, lang)}
                        {' · '}
                        {invoice.status || t('unknown')}
                        {' · '}
                        {formatBillingCurrency(invoice.total ?? invoice.amount_paid ?? 0, lang, (invoice.currency || 'usd').toUpperCase())}
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDownloadInvoice(invoice.id)}
                      >
                        {t('billingDownloadInvoice')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleSendInvoice(invoice.id)}
                        isLoading={billingAction() === `send:${invoice.id}`}
                      >
                        {t('billingSendInvoice')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </Section>
  );
}
