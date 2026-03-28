import { useState, useEffect, useRef, useReducer } from 'react';
import type { OAuthClientDev } from './OAuthSettingsModal';
import { useI18n } from '../../store/i18n';
import { useConfirmDialog } from '../../store/confirm-dialog';
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

interface FormState {
  name: string;
  redirectUris: string[];
  clientType: 'confidential' | 'public';
  scopes: string[];
}

const INITIAL_FORM_STATE: FormState = {
  name: '',
  redirectUris: [''],
  clientType: 'confidential',
  scopes: [],
};

type AsyncAction =
  | { type: 'CREATE_START' }
  | { type: 'CREATE_END' }
  | { type: 'DELETE_START'; clientId: string }
  | { type: 'DELETE_END' }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' };

interface AsyncState {
  creating: boolean;
  deleting: string | null;
  error: string | null;
}

const INITIAL_ASYNC_STATE: AsyncState = {
  creating: false,
  deleting: null,
  error: null,
};

function asyncReducer(state: AsyncState, action: AsyncAction): AsyncState {
  switch (action.type) {
    case 'CREATE_START':
      return { ...state, creating: true, error: null };
    case 'CREATE_END':
      return { ...state, creating: false };
    case 'DELETE_START':
      return { ...state, deleting: action.clientId };
    case 'DELETE_END':
      return { ...state, deleting: null };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'RESET':
      return INITIAL_ASYNC_STATE;
  }
}

interface OAuthClientTabProps {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}

export function OAuthClientTab({ loading, onLoadingChange }: OAuthClientTabProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [clients, setClients] = useState<OAuthClientDev[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
  const [asyncState, dispatchAsync] = useReducer(asyncReducer, INITIAL_ASYNC_STATE);
  const [createdClient, setCreatedClient] = useState<{ client_id: string; client_secret?: string } | null>(null);
  const [copied, setCopied] = useState<'id' | 'secret' | null>(null);
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
    dispatchAsync({ type: 'DELETE_START', clientId });
    try {
      const res = await rpc.me.oauth.clients[':clientId'].$delete({ param: { clientId } });
      await rpcJson(res);
      setClients(prev => prev.filter(c => c.client_id !== clientId));
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      dispatchAsync({ type: 'DELETE_END' });
    }
  }

  async function handleCreateClient(): Promise<void> {
    if (!formState.name.trim()) {
      dispatchAsync({ type: 'SET_ERROR', error: t('appNameRequired') });
      return;
    }
    const validUris = formState.redirectUris.filter(u => u.trim());
    if (validUris.length === 0) {
      dispatchAsync({ type: 'SET_ERROR', error: t('redirectUriRequired') });
      return;
    }
    dispatchAsync({ type: 'CREATE_START' });
    try {
      const res = await rpc.me.oauth.clients.$post({
        json: {
          client_name: formState.name,
          redirect_uris: validUris,
          scope: formState.scopes.join(' '),
          token_endpoint_auth_method: formState.clientType === 'public' ? 'none' : 'client_secret_post',
        },
      });
      const data = await rpcJson<{ client_id: string; client_secret?: string }>(res);
      setCreatedClient(data);
      fetchClients();
    } catch {
      dispatchAsync({ type: 'SET_ERROR', error: t('failedToCreateClient') });
    } finally {
      dispatchAsync({ type: 'CREATE_END' });
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
    setFormState(INITIAL_FORM_STATE);
    dispatchAsync({ type: 'RESET' });
  }

  if (loading) return null;

  if (showCreate) {
    if (createdClient) {
      return (
        <div className="flex flex-col gap-4">
          <Card style={{ backgroundColor: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)' }}>
            <p className="text-sm text-[var(--color-warning)] m-0">
              {t('oauthClientSecretWarning')}
            </p>
          </Card>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientId')}</label>
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] font-mono text-sm overflow-x-auto">
                {createdClient.client_id}
              </code>
              <Button variant="secondary" size="sm" onClick={() => handleCopy(createdClient.client_id, 'id')}>
                {copied === 'id' ? t('copied') : t('copyToClipboard')}
              </Button>
            </div>
          </div>
          {createdClient.client_secret && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientSecret')}</label>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] font-mono text-sm overflow-x-auto">
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
      <div className="flex flex-col gap-4">
        {asyncState.error && (
          <Card style={{ backgroundColor: 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
            <p className="text-sm text-[var(--color-error)] m-0">{asyncState.error}</p>
          </Card>
        )}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientName')}</label>
          <Input type="text" value={formState.name} onChange={e => setFormState(prev => ({ ...prev, name: e.target.value }))} placeholder={t('oauthClientNamePlaceholder')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthRedirectUri')}</label>
          <div className="flex flex-col gap-2">
            {formState.redirectUris.map((uri, i) => (
              <div key={i} className="flex gap-2">
                <Input type="text" value={uri} onChange={e => { const u = [...formState.redirectUris]; u[i] = e.target.value; setFormState(prev => ({ ...prev, redirectUris: u })); }} placeholder={t('oauthRedirectUriPlaceholder')} className="flex-1" />
                {formState.redirectUris.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setFormState(prev => ({ ...prev, redirectUris: prev.redirectUris.filter((_, j) => j !== i) }))}>{t('removeRedirectUri')}</Button>
                )}
              </div>
            ))}
            <button className="bg-transparent border-none p-0 text-sm text-[var(--color-text-primary)] cursor-pointer text-left" onClick={() => setFormState(prev => ({ ...prev, redirectUris: [...prev.redirectUris, ''] }))}>
              + {t('addRedirectUri')}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientType')}</label>
          <div className="grid grid-cols-2 gap-2">
            {(['confidential', 'public'] as const).map(type => (
              <button key={type} className="p-3 rounded-lg text-left cursor-pointer transition-colors" style={{ border: `1px solid ${formState.clientType === type ? 'var(--color-text-primary)' : 'var(--color-border-primary)'}`, backgroundColor: formState.clientType === type ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)' }} onClick={() => setFormState(prev => ({ ...prev, clientType: type }))}>
                <div className="font-medium text-[var(--color-text-primary)]">{t(type === 'confidential' ? 'oauthClientTypeConfidential' : 'oauthClientTypePublic')}</div>
                <div className="text-xs text-[var(--color-text-tertiary)] mt-1">{t(type === 'confidential' ? 'oauthClientTypeConfidentialDesc' : 'oauthClientTypePublicDesc')}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthScopes')}</label>
          <div className="grid grid-cols-2 gap-2">
            {ALL_SCOPES.map(scope => (
              <label key={scope} className="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors" style={{ border: `1px solid ${formState.scopes.includes(scope) ? 'var(--color-text-primary)' : 'var(--color-border-primary)'}`, backgroundColor: formState.scopes.includes(scope) ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)' }}>
                <input type="checkbox" checked={formState.scopes.includes(scope)} onChange={() => setFormState(prev => ({ ...prev, scopes: prev.scopes.includes(scope) ? prev.scopes.filter(s => s !== scope) : [...prev.scopes, scope] }))} className="sr-only" aria-label={scope} />
                <span className="text-sm text-[var(--color-text-primary)]">{scope}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={resetCreateForm}>{t('cancel')}</Button>
          <Button variant="primary" onClick={handleCreateClient} isLoading={asyncState.creating}>{t('create')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--color-text-secondary)] m-0">{t('developerAppsDesc')}</p>
        <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => setShowCreate(true)}>{t('createOAuthClient')}</Button>
      </div>
      {clients.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-tertiary)]">
          <Icons.Code className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium text-[var(--color-text-primary)] m-0">{t('noDeveloperApps')}</p>
          <p className="text-sm mt-1">{t('noDeveloperAppsDesc')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {clients.map(client => (
            <Card key={client.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-[var(--color-text-primary)] m-0">{client.name}</h4>
                    <Badge variant={client.status === 'active' ? 'success' : 'error'}>{client.status}</Badge>
                    <Badge variant="default">{client.client_type}</Badge>
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    <span className="text-[var(--color-text-secondary)]">{t('oauthClientId')}:</span>{' '}
                    <code className="px-1 py-0.5 rounded-md bg-[var(--color-surface-secondary)] font-mono">{client.client_id}</code>
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    <span className="text-[var(--color-text-secondary)]">{t('oauthRedirectUri')}:</span> {client.redirect_uris.join(', ')}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                    {t('createdAt')}: {formatShortDate(client.created_at)}
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => handleDeleteClient(client.client_id)} disabled={asyncState.deleting === client.client_id} isLoading={asyncState.deleting === client.client_id}>{t('delete')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
