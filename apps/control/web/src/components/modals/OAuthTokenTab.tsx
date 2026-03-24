import { useState, useEffect, useRef } from 'react';
import type { PersonalAccessToken } from './OAuthSettingsModal';
import { formatShortDate } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useI18n } from '../../providers/I18nProvider';

interface OAuthTokenTabProps {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

export function OAuthTokenTab({ loading, onLoadingChange }: OAuthTokenTabProps) {
  const { t } = useI18n();
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [showCreateToken, setShowCreateToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [deletingToken, setDeletingToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const tokenCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchTokens();
  }, []);

  useEffect(() => () => {
    if (tokenCopyTimerRef.current) clearTimeout(tokenCopyTimerRef.current);
  }, []);

  async function fetchTokens(): Promise<void> {
    onLoadingChange(true);
    try {
      const res = await fetch('/api/me/personal-access-tokens');
      const data = await res.json() as { tokens: PersonalAccessToken[] };
      setTokens(data.tokens || []);
    } catch (err) {
      console.error('Failed to fetch tokens:', err);
    } finally {
      onLoadingChange(false);
    }
  }

  async function handleCreateToken(): Promise<void> {
    if (!newTokenName.trim()) {
      setTokenError(t('tokenNameRequired'));
      return;
    }
    setCreatingToken(true);
    setTokenError(null);
    try {
      const res = await fetch('/api/me/personal-access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });
      if (!res.ok) {
        setTokenError(t('failedToCreateToken'));
        return;
      }
      const data = await res.json() as { token: string };
      setCreatedToken(data.token);
      fetchTokens();
    } catch {
      setTokenError(t('failedToCreateToken'));
    } finally {
      setCreatingToken(false);
    }
  }

  async function handleDeleteToken(tokenId: string): Promise<void> {
    setDeletingToken(tokenId);
    try {
      await fetch(`/api/me/personal-access-tokens/${tokenId}`, { method: 'DELETE' });
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
    if (tokenCopyTimerRef.current) clearTimeout(tokenCopyTimerRef.current);
    tokenCopyTimerRef.current = setTimeout(() => {
      setTokenCopied(false);
      tokenCopyTimerRef.current = null;
    }, 2000);
  }

  function resetCreateTokenForm(): void {
    setShowCreateToken(false);
    setCreatedToken(null);
    setNewTokenName('');
    setTokenError(null);
  }

  if (loading) return null;

  if (showCreateToken) {
    if (createdToken) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Card style={{ backgroundColor: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-warning)', margin: 0 }}>
              {t('tokenCopyWarning')}
            </p>
          </Card>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
              {t('personalAccessToken')}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <code style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-secondary)', fontFamily: 'monospace', fontSize: '0.875rem', overflowX: 'auto' }}>
                {createdToken}
              </code>
              <Button variant="secondary" size="sm" onClick={() => handleCopyToken(createdToken)}>
                {tokenCopied ? t('copied') : t('copy')}
              </Button>
            </div>
          </div>
          <Button variant="primary" onClick={resetCreateTokenForm}>{t('done')}</Button>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {tokenError && (
          <Card style={{ backgroundColor: 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-error)', margin: 0 }}>{tokenError}</p>
          </Card>
        )}
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            {t('tokenName')}
          </label>
          <Input
            type="text"
            value={newTokenName}
            onChange={e => setNewTokenName(e.target.value)}
            placeholder={t('tokenNamePlaceholder')}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem' }}>
          <Button variant="secondary" onClick={resetCreateTokenForm}>{t('cancel')}</Button>
          <Button variant="primary" onClick={handleCreateToken} isLoading={creatingToken}>{t('generateToken')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: 0 }}>
          {t('patDescription')}
        </p>
        <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => setShowCreateToken(true)}>
          {t('generateNewToken')}
        </Button>
      </div>
      {tokens.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)' }}>
          <Icons.Key style={{ width: '3rem', height: '3rem', margin: '0 auto 1rem', opacity: 0.5 }} />
          <p style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{t('noPersonalAccessTokens')}</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>{t('generateTokenHint')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {tokens.map(token => (
            <Card key={token.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{token.name}</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                    <code style={{ padding: '0.125rem 0.25rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-surface-secondary)', fontFamily: 'monospace' }}>
                      {token.tokenPrefix}...
                    </code>
                  </p>
                  {token.lastUsedAt && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                      {t('lastUsed', { date: formatShortDate(token.lastUsedAt) })}
                    </p>
                  )}
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                    {t('createdDate', { date: formatShortDate(token.createdAt) })}
                    {token.expiresAt && ` · ${t('expiresDate', { date: formatShortDate(token.expiresAt) })}`}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDeleteToken(token.id)}
                  disabled={deletingToken === token.id}
                  isLoading={deletingToken === token.id}
                >
                  {t('delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
