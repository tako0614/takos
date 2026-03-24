import { useState, useEffect, useRef } from 'react';
import type { OAuthClientDev } from './OAuthSettingsModal';
import { useI18n } from '../../providers/I18nProvider';
import { useConfirmDialog } from '../../providers/ConfirmDialogProvider';
import { rpc, rpcJson } from '../../lib/rpc';
import { formatShortDate } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

/**
 * Frontend-local scope list. The authoritative scope list lives in
 * src/types/oauth.ts (OAUTH_SCOPES). Keep these two in sync.
 */
const ALL_SCOPES = [
  'openid',
  'profile',
  'email',
  'spaces:read',
  'spaces:write',
  'files:read',
  'files:write',
  'memories:read',
  'memories:write',
  'threads:read',
  'threads:write',
  'agents:execute',
  'repos:read',
  'repos:write',
];

interface OAuthClientTabProps {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

export function OAuthClientTab({ loading, onLoadingChange }: OAuthClientTabProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [clients, setClients] = useState<OAuthClientDev[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newRedirectUris, setNewRedirectUris] = useState(['']);
  const [newClientType, setNewClientType] = useState<'confidential' | 'public'>('confidential');
  const [newScopes, setNewScopes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdClient, setCreatedClient] = useState<{ client_id: string; client_secret?: string } | null>(null);
  const [copied, setCopied] = useState<'id' | 'secret' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => () => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
  }, []);

  async function fetchClients(): Promise<void> {
    onLoadingChange(true);
    try {
      const res = await rpc.me.oauth.clients.$get();
      const data = await rpcJson<{ clients: OAuthClientDev[] }>(res);
      setClients(data.clients || []);
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    } finally {
      onLoadingChange(false);
    }
  }

  async function handleDeleteClient(clientId: string): Promise<void> {
    const confirmed = await confirm({
      title: t('deleteOAuthClient'),
      message: t('deleteOAuthClientConfirm'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;
    setDeleting(clientId);
    try {
      const res = await rpc.me.oauth.clients[':clientId'].$delete({ param: { clientId } });
      await rpcJson(res);
      setClients(prev => prev.filter(c => c.client_id !== clientId));
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleting(null);
    }
  }

  async function handleCreateClient(): Promise<void> {
    if (!newName.trim()) {
      setError(t('appNameRequired'));
      return;
    }
    const validUris = newRedirectUris.filter(u => u.trim());
    if (validUris.length === 0) {
      setError(t('redirectUriRequired'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await rpc.me.oauth.clients.$post({
        json: {
          client_name: newName,
          redirect_uris: validUris,
          scope: newScopes.join(' '),
          token_endpoint_auth_method: newClientType === 'public' ? 'none' : 'client_secret_post',
        },
      });
      const data = await rpcJson<{ client_id: string; client_secret?: string }>(res);
      setCreatedClient(data);
      fetchClients();
    } catch {
      setError(t('failedToCreateClient'));
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(text: string, type: 'id' | 'secret'): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => {
      setCopied(null);
      copyResetTimerRef.current = null;
    }, 2000);
  }

  function resetCreateForm(): void {
    setShowCreate(false);
    setCreatedClient(null);
    setNewName('');
    setNewRedirectUris(['']);
    setNewClientType('confidential');
    setNewScopes([]);
    setError(null);
  }

  if (loading) return null;

  if (showCreate) {
    if (createdClient) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Card style={{ backgroundColor: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-warning)', margin: 0 }}>
              {t('oauthClientSecretWarning')}
            </p>
          </Card>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{t('oauthClientId')}</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <code style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-secondary)', fontFamily: 'monospace', fontSize: '0.875rem', overflowX: 'auto' }}>
                {createdClient.client_id}
              </code>
              <Button variant="secondary" size="sm" onClick={() => handleCopy(createdClient.client_id, 'id')}>
                {copied === 'id' ? t('copied') : t('copyToClipboard')}
              </Button>
            </div>
          </div>
          {createdClient.client_secret && (
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{t('oauthClientSecret')}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <code style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-surface-secondary)', fontFamily: 'monospace', fontSize: '0.875rem', overflowX: 'auto' }}>
                  {createdClient.client_secret}
                </code>
                <Button variant="secondary" size="sm" onClick={() => handleCopy(createdClient.client_secret!, 'secret')}>
                  {copied === 'secret' ? t('copied') : t('copyToClipboard')}
                </Button>
              </div>
            </div>
          )}
          <Button variant="primary" onClick={resetCreateForm}>{t('close')}</Button>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && (
          <Card style={{ backgroundColor: 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-error)', margin: 0 }}>{error}</p>
          </Card>
        )}
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{t('oauthClientName')}</label>
          <Input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('oauthClientNamePlaceholder')} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{t('oauthRedirectUri')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {newRedirectUris.map((uri, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
                <Input type="text" value={uri} onChange={e => { const u = [...newRedirectUris]; u[i] = e.target.value; setNewRedirectUris(u); }} placeholder={t('oauthRedirectUriPlaceholder')} style={{ flex: 1 }} />
                {newRedirectUris.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setNewRedirectUris(newRedirectUris.filter((_, j) => j !== i))}>{t('removeRedirectUri')}</Button>
                )}
              </div>
            ))}
            <button style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer', textAlign: 'left' }} onClick={() => setNewRedirectUris([...newRedirectUris, ''])}>
              + {t('addRedirectUri')}
            </button>
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{t('oauthClientType')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {(['confidential', 'public'] as const).map(type => (
              <button key={type} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: `1px solid ${newClientType === type ? 'var(--color-text-primary)' : 'var(--color-border-primary)'}`, backgroundColor: newClientType === type ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)', textAlign: 'left', cursor: 'pointer', transition: 'var(--transition-colors)' }} onClick={() => setNewClientType(type)}>
                <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{t(type === 'confidential' ? 'oauthClientTypeConfidential' : 'oauthClientTypePublic')}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>{t(type === 'confidential' ? 'oauthClientTypeConfidentialDesc' : 'oauthClientTypePublicDesc')}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>{t('oauthScopes')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {ALL_SCOPES.map(scope => (
              <label key={scope} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: `1px solid ${newScopes.includes(scope) ? 'var(--color-text-primary)' : 'var(--color-border-primary)'}`, backgroundColor: newScopes.includes(scope) ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)', cursor: 'pointer', transition: 'var(--transition-colors)' }}>
                <input type="checkbox" checked={newScopes.includes(scope)} onChange={() => setNewScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope])} style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }} aria-label={scope} />
                <span style={{ fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>{scope}</span>
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem' }}>
          <Button variant="secondary" onClick={resetCreateForm}>{t('cancel')}</Button>
          <Button variant="primary" onClick={handleCreateClient} isLoading={creating}>{t('create')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: 0 }}>{t('developerAppsDesc')}</p>
        <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => setShowCreate(true)}>{t('createOAuthClient')}</Button>
      </div>
      {clients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)' }}>
          <Icons.Code style={{ width: '3rem', height: '3rem', margin: '0 auto 1rem', opacity: 0.5 }} />
          <p style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{t('noDeveloperApps')}</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>{t('noDeveloperAppsDesc')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {clients.map(client => (
            <Card key={client.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h4 style={{ fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{client.name}</h4>
                    <Badge variant={client.status === 'active' ? 'success' : 'error'}>{client.status}</Badge>
                    <Badge variant="default">{client.client_type}</Badge>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{t('oauthClientId')}:</span>{' '}
                    <code style={{ padding: '0.125rem 0.25rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-surface-secondary)', fontFamily: 'monospace' }}>{client.client_id}</code>
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{t('oauthRedirectUri')}:</span> {client.redirect_uris.join(', ')}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
                    {t('createdAt')}: {formatShortDate(client.created_at)}
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => handleDeleteClient(client.client_id)} disabled={deleting === client.client_id} isLoading={deleting === client.client_id}>{t('delete')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
