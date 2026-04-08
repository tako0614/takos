import { createSignal, onMount, onCleanup } from 'solid-js';
import { Show, For } from 'solid-js';
import type { PersonalAccessToken } from './OAuthSettingsModal.tsx';
import { formatShortDate } from '../../lib/format.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { useI18n } from '../../store/i18n.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';

/**
 * Full row returned by POST /api/me/personal-access-tokens.
 *
 * NOTE: the `token` field is the plaintext PAT value. It is ONLY populated
 * in the POST response — subsequent GETs only return the metadata fields
 * defined in {@link PersonalAccessToken}. The UI captures the plaintext
 * once for display and never persists it beyond the modal session.
 */
interface PersonalAccessTokenCreated extends PersonalAccessToken {
  token: string;
}

interface OAuthTokenTabProps {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

export function OAuthTokenTab(props: OAuthTokenTabProps) {
  const { t } = useI18n();
  const [tokens, setTokens] = createSignal<PersonalAccessToken[]>([]);
  const [showCreateToken, setShowCreateToken] = createSignal(false);
  const [newTokenName, setNewTokenName] = createSignal('');
  const [creatingToken, setCreatingToken] = createSignal(false);
  const [createdToken, setCreatedToken] = createSignal<string | null>(null);
  const [deletingToken, setDeletingToken] = createSignal<string | null>(null);
  const [tokenError, setTokenError] = createSignal<string | null>(null);
  const [tokenCopied, setTokenCopied] = createSignal(false);
  let tokenCopyTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    fetchTokens();
  });

  onCleanup(() => {
    if (tokenCopyTimer) clearTimeout(tokenCopyTimer);
  });

  async function fetchTokens(): Promise<void> {
    props.onLoadingChange(true);
    try {
      const res = await rpc.me['personal-access-tokens'].$get();
      const data = await rpcJson<{ tokens: PersonalAccessToken[] }>(res);
      setTokens(data.tokens || []);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      props.onLoadingChange(false);
    }
  }

  async function handleCreateToken(): Promise<void> {
    if (!newTokenName().trim()) {
      setTokenError(t('tokenNameRequired'));
      return;
    }
    setCreatingToken(true);
    setTokenError(null);
    try {
      const res = await rpc.me['personal-access-tokens'].$post({
        json: { name: newTokenName().trim() },
      });
      // The POST response includes the full record *plus* the plaintext
      // `token` field, which only exists on creation. We surface it once
      // via setCreatedToken and rely on fetchTokens() to refresh the list
      // with the metadata-only rows.
      const data = await rpcJson<PersonalAccessTokenCreated>(res);
      setCreatedToken(data.token);
      fetchTokens();
    } catch (err) {
      setTokenError(err instanceof Error && err.message ? err.message : t('failedToCreateToken'));
    } finally {
      setCreatingToken(false);
    }
  }

  async function handleDeleteToken(tokenId: string): Promise<void> {
    setDeletingToken(tokenId);
    try {
      const res = await rpc.me['personal-access-tokens'][':id'].$delete({
        param: { id: tokenId },
      });
      await rpcJson(res);
      setTokens(prev => prev.filter(tk => tk.id !== tokenId));
    } catch (err) {
      console.error('Failed to delete token:', err);
    } finally {
      setDeletingToken(null);
    }
  }

  async function handleCopyToken(token: string): Promise<void> {
    await navigator.clipboard.writeText(token);
    setTokenCopied(true);
    if (tokenCopyTimer) clearTimeout(tokenCopyTimer);
    tokenCopyTimer = setTimeout(() => {
      setTokenCopied(false);
      tokenCopyTimer = null;
    }, 2000);
  }

  function resetCreateTokenForm(): void {
    setShowCreateToken(false);
    setCreatedToken(null);
    setNewTokenName('');
    setTokenError(null);
  }

  return (
    <Show when={!props.loading}>
      <Show when={showCreateToken()} fallback={
        <div>
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '1rem' }}>
            <p style={{ 'font-size': '0.875rem', color: 'var(--color-text-secondary)', margin: '0' }}>
              {t('patDescription')}
            </p>
            <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => setShowCreateToken(true)}>
              {t('generateNewToken')}
            </Button>
          </div>
          <Show when={tokens().length > 0} fallback={
            <div style={{ 'text-align': 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)' }}>
              <Icons.Key style={{ width: '3rem', height: '3rem', margin: '0 auto 1rem', opacity: 0.5 }} />
              <p style={{ 'font-weight': 500, color: 'var(--color-text-primary)', margin: '0' }}>{t('noPersonalAccessTokens')}</p>
              <p style={{ 'font-size': '0.875rem', 'margin-top': '0.25rem' }}>{t('generateTokenHint')}</p>
            </div>
          }>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.75rem' }}>
              <For each={tokens()}>
                {(token) => (
                  <Card>
                    <div style={{ display: 'flex', 'align-items': 'flex-start', 'justify-content': 'space-between', gap: '1rem' }}>
                      <div style={{ flex: 1, 'min-width': '0' }}>
                        <h4 style={{ 'font-weight': 500, color: 'var(--color-text-primary)', margin: '0' }}>{token.name}</h4>
                        <p style={{ 'font-size': '0.75rem', color: 'var(--color-text-tertiary)', 'margin-top': '0.25rem' }}>
                          <code style={{ padding: '0.125rem 0.25rem', 'border-radius': 'var(--radius-sm)', 'background-color': 'var(--color-surface-secondary)', 'font-family': 'monospace' }}>
                            {token.token_prefix}...
                          </code>
                        </p>
                        <Show when={token.last_used_at}>
                          <p style={{ 'font-size': '0.75rem', color: 'var(--color-text-tertiary)', 'margin-top': '0.25rem' }}>
                            {t('lastUsed', { date: formatShortDate(token.last_used_at!) })}
                          </p>
                        </Show>
                        <p style={{ 'font-size': '0.75rem', color: 'var(--color-text-tertiary)', 'margin-top': '0.25rem' }}>
                          {t('createdDate', { date: formatShortDate(token.created_at) })}
                          {token.expires_at && ` · ${t('expiresDate', { date: formatShortDate(token.expires_at) })}`}
                        </p>
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeleteToken(token.id)}
                        disabled={deletingToken() === token.id}
                        isLoading={deletingToken() === token.id}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        </div>
      }>
        <Show when={createdToken()} fallback={
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
            <Show when={tokenError()}>
              <Card style={{ 'background-color': 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
                <p style={{ 'font-size': '0.875rem', color: 'var(--color-error)', margin: '0' }}>{tokenError()}</p>
              </Card>
            </Show>
            <div>
              <label style={{ display: 'block', 'font-size': '0.875rem', 'font-weight': 500, color: 'var(--color-text-secondary)', 'margin-bottom': '0.5rem' }}>
                {t('tokenName')}
              </label>
              <Input
                type="text"
                value={newTokenName()}
                onInput={e => setNewTokenName(e.currentTarget.value)}
                placeholder={t('tokenNamePlaceholder')}
              />
            </div>
            <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '0.75rem', 'padding-top': '1rem' }}>
              <Button variant="secondary" onClick={resetCreateTokenForm}>{t('cancel')}</Button>
              <Button variant="primary" onClick={handleCreateToken} isLoading={creatingToken()}>{t('generateToken')}</Button>
            </div>
          </div>
        }>
          {(token) => (
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
              <Card style={{ 'background-color': 'var(--color-warning-bg)', border: '1px solid var(--color-warning)' }}>
                <p style={{ 'font-size': '0.875rem', color: 'var(--color-warning)', margin: '0' }}>
                  {t('tokenCopyWarning')}
                </p>
              </Card>
              <div>
                <label style={{ display: 'block', 'font-size': '0.875rem', 'font-weight': 500, color: 'var(--color-text-secondary)', 'margin-bottom': '0.5rem' }}>
                  {t('personalAccessToken')}
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <code style={{ flex: 1, padding: '0.5rem 0.75rem', 'border-radius': 'var(--radius-md)', 'background-color': 'var(--color-surface-secondary)', 'font-family': 'monospace', 'font-size': '0.875rem', 'overflow-x': 'auto' }}>
                    {token()}
                  </code>
                  <Button variant="secondary" size="sm" onClick={() => handleCopyToken(token())}>
                    {tokenCopied() ? t('copied') : t('copy')}
                  </Button>
                </div>
              </div>
              <Button variant="primary" onClick={resetCreateTokenForm}>{t('done')}</Button>
            </div>
          )}
        </Show>
      </Show>
    </Show>
  );
}
