import { useEffect, useState } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { rpc, rpcJson } from '../../lib/rpc';
import { Icons } from '../../lib/Icons';
import { OAuthSettingsModal } from '../../components/modals/OAuthSettingsModal';
import { Button, Input } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { BillingInvoice, BillingSummary, User, UserSettings } from '../../types';
import { normalizeUsernameInput, syncRouteWithUsernameChange } from './settings-username';
import {
  formatBillingCurrency,
  formatBillingDate,
  sortBillingTopupPacks,
} from './settings-billing';

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${checked ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-600'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform dark:bg-zinc-900 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </div>
  );
}

export function SettingsView({
  user,
  userSettings,
  onSettingsChange,
  onBack,
  embedded = false,
}: {
  user: User | null;
  userSettings: UserSettings | null;
  onSettingsChange?: (settings: UserSettings) => void;
  onBack?: () => void;
  embedded?: boolean;
}) {
  const { t, lang, setLang } = useI18n();
  const { showToast } = useToast();
  const { fetchUser } = useAuth();
  const { route, replace } = useNavigation();
  const [saving, setSaving] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(user?.username ?? '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([]);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingReloadNonce, setBillingReloadNonce] = useState(0);
  const [billingAction, setBillingAction] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const currentUsername = user?.username ?? '';
  const normalizedDraft = normalizeUsernameInput(usernameDraft);
  const sortedTopupPacks = billingSummary ? sortBillingTopupPacks(billingSummary.topup_packs) : [];
  const billingModeLabel = billingSummary
    ? billingSummary.billing_mode === 'plus_subscription'
      ? t('billingModePlus')
      : billingSummary.billing_mode === 'pro_prepaid'
        ? t('billingModePro')
        : t('billingModeFree')
    : '';
  const canSaveUsername = Boolean(user)
    && normalizedDraft.length >= 3
    && normalizedDraft !== currentUsername
    && !checkingUsername
    && !savingUsername
    && usernameAvailable !== false
    && !usernameError;

  useEffect(() => {
    if (!editingUsername) {
      setUsernameDraft(currentUsername);
      setUsernameError(null);
      setUsernameAvailable(null);
      setCheckingUsername(false);
    }
  }, [currentUsername, editingUsername]);

  useEffect(() => {
    if (!editingUsername) {
      return;
    }

    if (!normalizedDraft) {
      setCheckingUsername(false);
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    if (normalizedDraft.length < 3) {
      setCheckingUsername(false);
      setUsernameAvailable(null);
      setUsernameError(t('usernameTooShort'));
      return;
    }

    if (normalizedDraft === currentUsername) {
      setCheckingUsername(false);
      setUsernameAvailable(true);
      setUsernameError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await rpc.setup['check-username'].$post({
          json: { username: normalizedDraft },
        });
        const data = await rpcJson<{ available: boolean; error?: string }>(res);
        if (cancelled) {
          return;
        }
        setUsernameAvailable(data.available);
        setUsernameError(data.error || null);
      } catch {
        if (!cancelled) {
          setUsernameAvailable(null);
          setUsernameError(t('failedToCheckUsername'));
        }
      } finally {
        if (!cancelled) {
          setCheckingUsername(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentUsername, editingUsername, normalizedDraft, t]);

  useEffect(() => {
    if (!user) {
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

    return () => {
      cancelled = true;
    };
  }, [billingReloadNonce, t, user?.email]);

  const updateSetting = async (patch: Partial<UserSettings>) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await rpc.me.settings.$patch({ json: patch });
      const settings = await rpcJson<UserSettings>(res);
      onSettingsChange?.(settings);
    } catch (err) {
      console.error('Failed to update settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleUsernameEditCancel = () => {
    setEditingUsername(false);
  };

  const handleUsernameSave = async () => {
    if (!user || !canSaveUsername) {
      return;
    }

    setSavingUsername(true);
    try {
      const res = await rpc.me.username.$patch({
        json: { username: normalizedDraft },
      });
      const data = await rpcJson<{ success: boolean; username: string }>(res);
      const nextRoute = syncRouteWithUsernameChange(route, currentUsername, data.username);

      if (nextRoute !== route) {
        replace(nextRoute);
      }

      await fetchUser();
      setEditingUsername(false);
      setUsernameDraft(data.username);
      setUsernameAvailable(true);
      setUsernameError(null);
      showToast('success', t('saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failedToSave');
      setUsernameError(message);
      setUsernameAvailable(false);
      showToast('error', message);
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSubscribePlus = async () => {
    setBillingAction('subscribe_plus');
    try {
      const res = await rpc.billing.subscribe.$post();
      const data = await rpcJson<{ url: string }>(res);
      window.location.assign(data.url);
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
      window.location.assign(data.url);
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
      window.location.assign(data.url);
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
    window.open(`/api/billing/invoices/${invoiceId}/pdf`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      {!embedded && (
        <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <Icons.ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t('settingsTitle')}
          </h1>
        </header>
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pb-10 pt-6">

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="space-y-3 text-sm">
              <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-zinc-500 dark:text-zinc-400">{t('username')}</div>
                    <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                      {currentUsername ? `@${currentUsername}` : '-'}
                    </div>
                  </div>
                  {!editingUsername && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingUsername(true)}
                      disabled={!user}
                    >
                      {t('edit')}
                    </Button>
                  )}
                </div>

                {editingUsername && (
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleUsernameSave();
                    }}
                  >
                    <Input
                      value={usernameDraft}
                      onChange={(event) => setUsernameDraft(normalizeUsernameInput(event.target.value))}
                      placeholder={t('usernamePlaceholder')}
                      autoFocus
                      maxLength={30}
                      error={usernameError || undefined}
                      leftIcon={<span className="text-sm font-medium">@</span>}
                      rightIcon={
                        checkingUsername
                          ? <Icons.Loader className="h-4 w-4 animate-spin" />
                          : usernameAvailable === true && normalizedDraft !== currentUsername
                            ? <Icons.Check className="h-4 w-4" />
                            : usernameAvailable === false
                              ? <Icons.X className="h-4 w-4" />
                              : null
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleUsernameEditCancel}
                        disabled={savingUsername}
                      >
                        {t('cancel')}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        isLoading={savingUsername}
                        disabled={!canSaveUsername}
                      >
                        {t('save')}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">{t('name')}</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{user?.name || '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">{t('email')}</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{user?.email || '-'}</span>
              </div>
            </div>
          </div>

          <Section title={t('language')}>
            <div className="flex gap-2">
              <Button
                variant={lang === 'ja' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setLang('ja')}
              >
                日本語
              </Button>
              <Button
                variant={lang === 'en' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setLang('en')}
              >
                English
              </Button>
            </div>
          </Section>

          {userSettings && (
            <Section title={t('autoUpdateSettings')}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t('autoUpdateHint')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {saving && <Icons.Loader className="h-4 w-4 animate-spin text-zinc-400" />}
                  <Toggle
                    checked={userSettings.auto_update_enabled}
                    onChange={(v) => updateSetting({ auto_update_enabled: v })}
                    disabled={saving}
                  />
                </div>
              </div>
            </Section>
          )}

          {userSettings && (
            <Section title={t('privacyTitle')}>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('privateAccount')}</div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t('requireApprovalForFollowers')}
                    </div>
                  </div>
                  <Toggle
                    checked={userSettings.private_account}
                    onChange={(v) => updateSetting({ private_account: v })}
                    disabled={saving}
                  />
                </div>

                <div>
                  <div className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
                    {t('activityVisibility')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['public', 'followers', 'private'] as const).map((v) => (
                      <Button
                        key={v}
                        variant={userSettings.activity_visibility === v ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => updateSetting({ activity_visibility: v })}
                        disabled={saving}
                      >
                        {v === 'public' ? t('visibilityPublic') : v === 'followers' ? t('visibilityFollowers') : t('visibilityPrivate')}
                      </Button>
                    ))}
                    {saving && <Icons.Loader className="h-4 w-4 animate-spin text-zinc-400" />}
                  </div>
                </div>
              </div>
            </Section>
          )}

          <Section title={t('oauthSettings')}>
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              {t('authorizedAppsDesc')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icons.Key className="h-4 w-4" />}
              onClick={() => setShowOAuthModal(true)}
            >
              {t('oauthSettings')}
            </Button>
          </Section>

          <Section title={t('billingTitle')}>
            {billingLoading && (
              <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                <Icons.Loader className="h-4 w-4 animate-spin" />
                <span>{t('loading')}</span>
              </div>
            )}

            {!billingLoading && billingError && (
              <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                <p>{billingError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setBillingReloadNonce((current) => current + 1)}
                >
                  {t('refresh')}
                </Button>
              </div>
            )}

            {!billingLoading && !billingError && billingSummary && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        {t('billingCurrentPlan')}
                      </div>
                      <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {billingSummary.plan.display_name}
                      </div>
                    </div>
                    <div className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                      {billingModeLabel}
                    </div>
                  </div>
                  <div className="grid gap-3 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2">
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">{t('billingStatus')}</div>
                      <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{billingSummary.status}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">{t('billingBalance')}</div>
                      <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                        {formatBillingCurrency(billingSummary.balance_cents, lang)}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">{t('billingPeriodEnd')}</div>
                      <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                        {formatBillingDate(billingSummary.subscription_period_end, lang)}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500 dark:text-zinc-400">{t('billingRuntimeLimit')}</div>
                      <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">
                        {t('billingRuntimeLimitValue', {
                          hours: String(Math.round(billingSummary.runtime_limit_7d_seconds / 3600)),
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="mb-3">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('billingPlans')}</div>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {t('billingPlansHint')}
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className={`rounded-2xl border p-4 ${billingSummary.plan_tier === 'free' ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'}`}>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('billingPlanFreeTitle')}</div>
                      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('billingPlanFreeDesc')}</p>
                      <div className="mt-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {billingSummary.plan_tier === 'free' ? t('billingCurrentBadge') : t('billingIncludedBadge')}
                      </div>
                    </div>

                    <div className={`rounded-2xl border p-4 ${billingSummary.plan_tier === 'plus' ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'}`}>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('billingPlanPlusTitle')}</div>
                      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('billingPlanPlusDesc')}</p>
                      <div className="mt-4">
                        {billingSummary.available_actions.subscribe_plus ? (
                          <Button
                            size="sm"
                            onClick={() => void handleSubscribePlus()}
                            isLoading={billingAction === 'subscribe_plus'}
                          >
                            {t('billingSubscribePlus')}
                          </Button>
                        ) : billingSummary.available_actions.manage_subscription ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleManageSubscription()}
                            isLoading={billingAction === 'manage_subscription'}
                          >
                            {t('billingManageSubscription')}
                          </Button>
                        ) : (
                          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {billingSummary.plan_tier === 'plus' ? t('billingCurrentBadge') : t('billingUnavailable')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`rounded-2xl border p-4 ${billingSummary.plan_tier === 'pro' ? 'border-zinc-900 dark:border-zinc-100' : 'border-zinc-200 dark:border-zinc-800'}`}>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('billingPlanProTitle')}</div>
                      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('billingPlanProDesc')}</p>
                      <div className="mt-4 space-y-2">
                        {sortedTopupPacks.map((pack) => (
                          <div
                            key={pack.id}
                            className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                  {pack.label}
                                </div>
                                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                  {formatBillingCurrency(pack.credits_cents, lang)}
                                </div>
                              </div>
                              {pack.badge && (
                                <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                  {pack.badge}
                                </span>
                              )}
                            </div>
                            <div className="mt-3">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!billingSummary.available_actions.top_up_pro}
                                isLoading={billingAction === `topup:${pack.id}`}
                                onClick={() => void handleTopupCheckout(pack.id)}
                              >
                                {t('billingTopupPack')}
                              </Button>
                            </div>
                          </div>
                        ))}
                        {!billingSummary.available_actions.top_up_pro && (
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {t('billingTopupBlocked')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('billingCredits')}</div>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {t('billingCreditsHint')}
                  </p>
                  <div className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {formatBillingCurrency(billingSummary.balance_cents, lang)}
                  </div>
                  {billingSummary.plan_tier === 'plus' && billingSummary.balance_cents > 0 && (
                    <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      {t('billingDormantBalanceNote')}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="mb-3">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('billingInvoices')}</div>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {t('billingInvoicesHint')}
                    </p>
                  </div>

                  {!billingSummary.stripe_customer_id && (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t('billingNoCustomer')}
                    </div>
                  )}

                  {billingSummary.stripe_customer_id && invoiceLoading && (
                    <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                      <Icons.Loader className="h-4 w-4 animate-spin" />
                      <span>{t('loading')}</span>
                    </div>
                  )}

                  {billingSummary.stripe_customer_id && !invoiceLoading && invoiceError && (
                    <div className="text-sm text-amber-700 dark:text-amber-300">{invoiceError}</div>
                  )}

                  {billingSummary.stripe_customer_id && !invoiceLoading && !invoiceError && billingInvoices.length === 0 && (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t('billingNoInvoices')}
                    </div>
                  )}

                  {billingSummary.stripe_customer_id && !invoiceLoading && billingInvoices.length > 0 && (
                    <div className="space-y-3">
                      {billingInvoices.map((invoice) => (
                        <div
                          key={invoice.id}
                          className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800 md:flex-row md:items-center md:justify-between"
                        >
                          <div>
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {invoice.number || invoice.id}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {formatBillingDate(invoice.created, lang)}
                              {' · '}
                              {invoice.status || t('unknown')}
                              {' · '}
                              {formatBillingCurrency(invoice.total ?? invoice.amount_paid ?? 0, lang, (invoice.currency || 'usd').toUpperCase())}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
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
                              isLoading={billingAction === `send:${invoice.id}`}
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
            )}
          </Section>

        </div>
      </main>

      {showOAuthModal && (
        <OAuthSettingsModal onClose={() => setShowOAuthModal(false)} />
      )}
    </div>
  );
}
