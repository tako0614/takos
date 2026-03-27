import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../store/i18n';
import { Button } from '../../components/ui/Button';
import { ConsentLayout, ConsentLogo } from './ConsentLayout';
import { ScopeList } from './ScopeList';
import { LoadingScreen } from '../../components/common/LoadingScreen';

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
  const [state, setState] = useState<DeviceContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  const fetchContext = useCallback(async (userCode?: string) => {
    setLoading(true);
    try {
      const params = userCode ? `?user_code=${encodeURIComponent(userCode)}` : '';
      const res = await fetch(`/api/oauth/device/context${params}`, { credentials: 'include' });
      const data = await res.json() as DeviceContextResponse;

      if (data.status === 'unauthenticated') {
        const search = window.location.search;
        const returnTo = `/oauth/device${search}`;
        window.location.href = `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
        return;
      }

      setState(data);
    } catch {
      setState({ status: 'error', title: 'Error', message: 'Failed to load.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userCode = params.get('user_code') || undefined;
    if (userCode) setCodeInput(userCode);
    fetchContext(userCode);
  }, [fetchContext]);

  const handleCodeSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    // Update URL and fetch context
    const newUrl = `/oauth/device?user_code=${encodeURIComponent(trimmed)}`;
    window.history.replaceState(null, '', newUrl);
    fetchContext(trimmed);
  }, [codeInput, fetchContext]);

  const handleDecision = useCallback(async (action: 'allow' | 'deny') => {
    if (!state || state.status !== 'consent_required') return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/oauth/device/decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_code: state.user_code,
          action,
          csrf_token: state.csrf_token,
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
  }, [state]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!state) {
    return <LoadingScreen />;
  }

  // Code entry screen
  if (state.status === 'code_entry') {
    return (
      <ConsentLayout>
        <ConsentLogo />
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
          {t('deviceAuthTitle')}
        </h1>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
          {state.user.email} {t('oauthConsentLoggedInAs')}
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          {t('deviceAuthCodePrompt')}
        </p>
        <form onSubmit={handleCodeSubmit} className="text-left">
          <label className="block text-xs text-[var(--color-text-tertiary)] mb-2">
            {t('deviceAuthCodeLabel')}
          </label>
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            placeholder={t('deviceAuthCodePlaceholder')}
            required
            className="w-full px-3 py-3 rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-base tracking-wider uppercase placeholder:text-[var(--color-text-tertiary)] placeholder:normal-case placeholder:tracking-normal"
          />
          <div className="mt-4">
            <Button variant="primary" className="w-full" type="submit">
              {t('deviceAuthContinue')}
            </Button>
          </div>
        </form>
      </ConsentLayout>
    );
  }

  // Consent screen
  if (state.status === 'consent_required') {
    return (
      <ConsentLayout>
        <ConsentLogo src={state.client.logo_uri} />
        <h1 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">
          {state.client.name}
        </h1>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
          {state.user.email} {t('oauthConsentLoggedInAs')}
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-2">
          <strong className="text-[var(--color-text-primary)]">{state.client.name}</strong>
          {t('oauthConsentDeviceRequesting')}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
          {t('deviceAuthCode')}: <span className="tracking-wider uppercase text-[var(--color-text-secondary)]">{state.user_code}</span>
        </p>

        <div className="mb-4">
          <ScopeList identity={state.scopes.identity} resources={state.scopes.resources} />
        </div>

        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={submitting}
            onClick={() => handleDecision('deny')}
          >
            {t('oauthConsentDeny')}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            isLoading={submitting}
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
  const resultState = state as DeviceResultState;
  return (
    <ConsentLayout>
      <ConsentLogo />
      <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
        {resultState.title}
      </h1>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        {resultState.message}
      </p>
      <a href="/" className="text-sm text-[var(--color-primary)] hover:underline">
        Home
      </a>
    </ConsentLayout>
  );
}
