import { createEffect, onMount, onCleanup, createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { Button } from '../../components/ui/Button';
import { ConsentLayout, ConsentLogo } from './ConsentLayout';
import { ScopeList } from './ScopeList';
import { LoadingScreen } from '../../components/common/LoadingScreen';

/** Validate redirect URL before navigation (defense-in-depth). */
function safeRedirect(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      window.location.href = url;
      return;
    }
  } catch { /* invalid URL */ }
  console.error('Blocked redirect to unsafe URL:', url.slice(0, 100));
}

interface ConsentData {
  status: 'consent_required';
  client: { name: string; logo_uri: string | null };
  user: { email: string };
  scopes: { identity: string[]; resources: string[] };
  csrf_token: string;
  params: {
    client_id: string;
    redirect_uri: string;
    scope: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
  };
}

type ContextResponse =
  | ConsentData
  | { status: 'auto_approved'; redirect_url: string }
  | { status: 'error_redirect'; redirect_url: string }
  | { status: 'unauthenticated' }
  | { error: string; error_description?: string };

export function OAuthConsentView() {
  const { t } = useI18n();
  const [consentData, setConsentData] = createSignal<ConsentData | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  onMount(() => {
    const search = window.location.search;
    fetch(`/api/oauth/authorize/context${search}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json() as ContextResponse;

        if ('error' in data) {
          setError(data.error_description || data.error);
          return;
        }

        if (data.status === 'unauthenticated') {
          const returnTo = `/oauth/authorize${search}`;
          window.location.href = `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
          return;
        }

        if (data.status === 'auto_approved' || data.status === 'error_redirect') {
          safeRedirect(data.redirect_url);
          return;
        }

        if (data.status === 'consent_required') {
          setConsentData(data);
        }
      })
      .catch(() => setError('Failed to load authorization data'));
  });

  const handleDecision = async (action: 'allow' | 'deny') => {
    if (!consentData) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/oauth/authorize/decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          csrf_token: consentData()!.csrf_token,
          ...consentData()!.params,
        }),
      });

      const data = await res.json() as { redirect_url?: string; error?: string };

      if (data.redirect_url) {
        safeRedirect(data.redirect_url);
        return;
      }

      if (data.error) {
        setError(data.error);
        setSubmitting(false);
      }
    } catch {
      setError('Failed to submit decision');
      setSubmitting(false);
    }
  };

  if (error()) {
    return (
      <ConsentLayout>
        <ConsentLogo />
        <h1 class="text-lg font-bold text-[var(--color-error)] mb-2">{t('oauthConsentError')}</h1>
        <p class="text-sm text-[var(--color-text-tertiary)]">{error()}</p>
      </ConsentLayout>
    );
  }

  if (!consentData()) {
    return <LoadingScreen />;
  }

  return (() => {
    const cd = consentData()!;
    return (
    <ConsentLayout>
      <ConsentLogo src={cd.client.logo_uri} />
      <h1 class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
        {cd.client.name}
      </h1>
      <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
        {cd.user.email} {t('oauthConsentLoggedInAs')}
      </p>
      <p class="text-sm text-[var(--color-text-secondary)] mb-4">
        <strong class="text-[var(--color-text-primary)]">{cd.client.name}</strong>
        {t('oauthConsentRequesting')}
      </p>

      <div class="mb-4">
        <ScopeList
          identity={cd.scopes.identity}
          resources={cd.scopes.resources}
        />
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
  })();
}
