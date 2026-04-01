import { createEffect, createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Button } from '../../components/ui/Button.tsx';
import { ConsentLayout, ConsentLogo } from './ConsentLayout.tsx';
import { ScopeList } from './ScopeList.tsx';
import { LoadingScreen } from '../../components/common/LoadingScreen.tsx';

type DeviceResultState = { status: 'auto_approved' | 'result' | 'error'; title: string; message: string };

type DeviceContextResponse =
  | { status: 'code_entry'; user: { email: string } }
  | {
      status: 'consent_required';
      client: { name: string; logo_uri: string | null };
      user: { email: string };
      user_code: string;
      scopes: { identity: string[]; resources: string[] };
      csrf_token: string;
    }
  | DeviceResultState
  | { status: 'unauthenticated' };

type DeviceDecisionResponse =
  | { status: 'approved' | 'denied'; title: string; message: string }
  | { status: 'error'; title: string; message: string }
  | { error: string };

export function DeviceAuthView() {
  const { t } = useI18n();
  const [state, setState] = createSignal<DeviceContextResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [submitting, setSubmitting] = createSignal(false);
  const [codeInput, setCodeInput] = createSignal('');

  const fetchContext = async (userCode?: string) => {
    setLoading(true);
    try {
      const params = userCode ? `?user_code=${encodeURIComponent(userCode)}` : '';
      const res = await fetch(`/api/oauth/device/context${params}`, { credentials: 'include' });
      const data = await res.json() as DeviceContextResponse;

      if (data.status === 'unauthenticated') {
        const search = globalThis.location.search;
        const returnTo = `/oauth/device${search}`;
        globalThis.location.href = `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
        return;
      }

      setState(data);
    } catch {
      setState({ status: 'error', title: 'Error', message: 'Failed to load.' });
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const userCode = params.get('user_code') || undefined;
    if (userCode) setCodeInput(userCode);
    fetchContext(userCode);
  });

  const handleCodeSubmit = (e: Event & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    const trimmed = codeInput().trim();
    if (!trimmed) return;
    // Update URL and fetch context
    const newUrl = `/oauth/device?user_code=${encodeURIComponent(trimmed)}`;
    globalThis.history.replaceState(null, '', newUrl);
    fetchContext(trimmed);
  };

  const handleDecision = async (action: 'allow' | 'deny') => {
    const s = state();
    if (!s || s.status !== 'consent_required') return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/oauth/device/decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_code: s.user_code,
          action,
          csrf_token: s.csrf_token,
        }),
      });

      const data = await res.json() as DeviceDecisionResponse;

      if ('error' in data) {
        setState({ status: 'error', title: 'Error', message: data.error });
      } else {
        setState({ status: 'result', title: data.title, message: data.message });
      }
    } catch {
      setState({ status: 'error', title: 'Error', message: 'Failed to submit.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading()) {
    return <LoadingScreen />;
  }

  if (!state()) {
    return <LoadingScreen />;
  }

  // Code entry screen
  if (state()!.status === 'code_entry') {
    const s = state() as Extract<DeviceContextResponse, { status: 'code_entry' }>;
    return (
      <ConsentLayout>
        <ConsentLogo />
        <h1 class="text-xl font-bold text-[var(--color-text-primary)] mb-2">
          {t('deviceAuthTitle')}
        </h1>
        <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
          {s.user.email} {t('oauthConsentLoggedInAs')}
        </p>
        <p class="text-sm text-[var(--color-text-secondary)] mb-4">
          {t('deviceAuthCodePrompt')}
        </p>
        <form onSubmit={handleCodeSubmit} class="text-left">
          <label class="block text-xs text-[var(--color-text-tertiary)] mb-2">
            {t('deviceAuthCodeLabel')}
          </label>
          <input
            type="text"
            value={codeInput()}
            onInput={(e) => setCodeInput(e.target.value)}
            autocomplete="one-time-code"
            inputmode="text"
            placeholder={t('deviceAuthCodePlaceholder')}
            required
            class="w-full px-3 py-3 rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-base tracking-wider uppercase placeholder:text-[var(--color-text-tertiary)] placeholder:normal-case placeholder:tracking-normal"
          />
          <div class="mt-4">
            <Button variant="primary" class="w-full" type="submit">
              {t('deviceAuthContinue')}
            </Button>
          </div>
        </form>
      </ConsentLayout>
    );
  }

  // Consent screen
  if (state()!.status === 'consent_required') {
    const s = state() as Extract<DeviceContextResponse, { status: 'consent_required' }>;
    return (
      <ConsentLayout>
        <ConsentLogo src={s.client.logo_uri} />
        <h1 class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
          {s.client.name}
        </h1>
        <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
          {s.user.email} {t('oauthConsentLoggedInAs')}
        </p>
        <p class="text-sm text-[var(--color-text-secondary)] mb-2">
          <strong class="text-[var(--color-text-primary)]">{s.client.name}</strong>
          {t('oauthConsentDeviceRequesting')}
        </p>
        <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
          {t('deviceAuthCode')}: <span class="tracking-wider uppercase text-[var(--color-text-secondary)]">{s.user_code}</span>
        </p>

        <div class="mb-4">
          <ScopeList identity={s.scopes.identity} resources={s.scopes.resources} />
        </div>

        <div class="flex gap-3">
          <Button
            variant="secondary"
            class="flex-1"
            disabled={submitting()}
            onClick={() => handleDecision('deny')}
          >
            {t('oauthConsentDeny')}
          </Button>
          <Button
            variant="primary"
            class="flex-1"
            isLoading={submitting()}
            onClick={() => handleDecision('allow')}
          >
            {t('oauthConsentAllow')}
          </Button>
        </div>
      </ConsentLayout>
    );
  }

  // Result / Error / Auto-approved screens
  // At this point, code_entry / consent_required / unauthenticated are already handled above
  const resultState = state() as unknown as DeviceResultState;
  return (
    <ConsentLayout>
      <ConsentLogo />
      <h1 class="text-xl font-bold text-[var(--color-text-primary)] mb-2">
        {resultState.title}
      </h1>
      <p class="text-sm text-[var(--color-text-secondary)] mb-4">
        {resultState.message}
      </p>
      <a href="/" class="text-sm text-[var(--color-primary)] hover:underline">
        Home
      </a>
    </ConsentLayout>
  );
}
