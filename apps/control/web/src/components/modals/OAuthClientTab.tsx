import { createSignal, onMount, onCleanup } from 'solid-js';
import { Show, For } from 'solid-js';
import type { OAuthClientDev } from './OAuthSettingsModal.tsx';
import { useI18n } from '../../store/i18n.ts';
import { useConfirmDialog } from '../../store/confirm-dialog.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';
import { formatShortDate } from '../../lib/format.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Card } from '../ui/Card.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

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

export function OAuthClientTab(props: OAuthClientTabProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [clients, setClients] = createSignal<OAuthClientDev[]>([]);
  const [showCreate, setShowCreate] = createSignal(false);
  const [formName, setFormName] = createSignal('');
  const [formRedirectUris, setFormRedirectUris] = createSignal<string[]>(['']);
  const [formClientType, setFormClientType] = createSignal<'confidential' | 'public'>('confidential');
  const [formScopes, setFormScopes] = createSignal<string[]>([]);
  const [creating, setCreating] = createSignal(false);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [createdClient, setCreatedClient] = createSignal<{ client_id: string; client_secret?: string } | null>(null);
  const [copied, setCopied] = createSignal<'id' | 'secret' | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    fetchClients();
  });

  onCleanup(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  async function fetchClients(): Promise<void> {
    props.onLoadingChange(true);
    try {
      const res = await rpc.me.oauth.clients.$get();
      const data = await rpcJson<{ clients: OAuthClientDev[] }>(res);
      setClients(data.clients || []);
    } catch (err) {
      console.error('Failed to fetch clients:', err);
    } finally {
      props.onLoadingChange(false);
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
    if (!formName().trim()) {
      setError(t('appNameRequired'));
      return;
    }
    const validUris = formRedirectUris().filter(u => u.trim());
    if (validUris.length === 0) {
      setError(t('redirectUriRequired'));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await rpc.me.oauth.clients.$post({
        json: {
          client_name: formName(),
          redirect_uris: validUris,
          scope: formScopes().join(' '),
          token_endpoint_auth_method: formClientType() === 'public' ? 'none' : 'client_secret_post',
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
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      setCopied(null);
      copyResetTimer = null;
    }, 2000);
  }

  function resetCreateForm(): void {
    setShowCreate(false);
    setCreatedClient(null);
    setFormName('');
    setFormRedirectUris(['']);
    setFormClientType('confidential');
    setFormScopes([]);
    setCreating(false);
    setDeleting(null);
    setError(null);
  }

  return (
    <Show when={!props.loading}>
      <Show when={showCreate()} fallback={
        <div>
          <div class="flex items-center justify-between mb-4">
            <p class="text-sm text-[var(--color-text-secondary)] m-0">{t('developerAppsDesc')}</p>
            <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => setShowCreate(true)}>{t('createOAuthClient')}</Button>
          </div>
          <Show when={clients().length === 0} fallback={
            <div class="flex flex-col gap-3">
              <For each={clients()}>
                {(client) => (
                  <Card>
                    <div class="flex items-start justify-between gap-4">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <h4 class="font-medium text-[var(--color-text-primary)] m-0">{client.name}</h4>
                          <Badge variant={client.status === 'active' ? 'success' : 'error'}>{client.status}</Badge>
                          <Badge variant="default">{client.client_type}</Badge>
                        </div>
                        <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                          <span class="text-[var(--color-text-secondary)]">{t('oauthClientId')}:</span>{' '}
                          <code class="px-1 py-0.5 rounded-md bg-[var(--color-surface-secondary)] font-mono">{client.client_id}</code>
                        </p>
                        <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                          <span class="text-[var(--color-text-secondary)]">{t('oauthRedirectUri')}:</span> {client.redirect_uris.join(', ')}
                        </p>
                        <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                          {t('createdAt')}: {formatShortDate(client.created_at)}
                        </p>
                      </div>
                      <Button variant="danger" size="sm" onClick={() => handleDeleteClient(client.client_id)} disabled={deleting() === client.client_id} isLoading={deleting() === client.client_id}>{t('delete')}</Button>
                    </div>
                  </Card>
                )}
              </For>
            </div>
          }>
            <div class="text-center py-12 text-[var(--color-text-tertiary)]">
              <Icons.Code class="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p class="font-medium text-[var(--color-text-primary)] m-0">{t('noDeveloperApps')}</p>
              <p class="text-sm mt-1">{t('noDeveloperAppsDesc')}</p>
            </div>
          </Show>
        </div>
      }>
        <Show when={createdClient()} fallback={
          <div class="flex flex-col gap-4">
            <Show when={error()}>
              <Card style={{ 'background-color': 'var(--color-error-bg)', border: '1px solid var(--color-error)' }}>
                <p class="text-sm text-[var(--color-error)] m-0">{error()}</p>
              </Card>
            </Show>
            <div>
              <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientName')}</label>
              <Input type="text" value={formName()} onInput={e => setFormName(e.currentTarget.value)} placeholder={t('oauthClientNamePlaceholder')} />
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthRedirectUri')}</label>
              <div class="flex flex-col gap-2">
                <For each={formRedirectUris()}>
                  {(uri, i) => (
                    <div class="flex gap-2">
                      <Input type="text" value={uri} onInput={e => { const u = [...formRedirectUris()]; u[i()] = e.currentTarget.value; setFormRedirectUris(u); }} placeholder={t('oauthRedirectUriPlaceholder')} class="flex-1" />
                      <Show when={formRedirectUris().length > 1}>
                        <Button variant="ghost" size="sm" onClick={() => setFormRedirectUris(prev => prev.filter((_, j) => j !== i()))}>{t('removeRedirectUri')}</Button>
                      </Show>
                    </div>
                  )}
                </For>
                <button type="button" class="bg-transparent border-none p-0 text-sm text-[var(--color-text-primary)] cursor-pointer text-left" onClick={() => setFormRedirectUris(prev => [...prev, ''])}>
                  + {t('addRedirectUri')}
                </button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientType')}</label>
              <div class="grid grid-cols-2 gap-2">
                <For each={['confidential', 'public'] as const}>
                  {(type) => (
                    <button type="button" class="p-3 rounded-lg text-left cursor-pointer transition-colors" style={{ border: `1px solid ${formClientType() === type ? 'var(--color-text-primary)' : 'var(--color-border-primary)'}`, 'background-color': formClientType() === type ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)' }} onClick={() => setFormClientType(type)}>
                      <div class="font-medium text-[var(--color-text-primary)]">{t(type === 'confidential' ? 'oauthClientTypeConfidential' : 'oauthClientTypePublic')}</div>
                      <div class="text-xs text-[var(--color-text-tertiary)] mt-1">{t(type === 'confidential' ? 'oauthClientTypeConfidentialDesc' : 'oauthClientTypePublicDesc')}</div>
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthScopes')}</label>
              <div class="grid grid-cols-2 gap-2">
                <For each={ALL_SCOPES}>
                  {(scope) => (
                    <label class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors" style={{ border: `1px solid ${formScopes().includes(scope) ? 'var(--color-text-primary)' : 'var(--color-border-primary)'}`, 'background-color': formScopes().includes(scope) ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)' }}>
                      <input type="checkbox" checked={formScopes().includes(scope)} onInput={() => setFormScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope])} class="sr-only" aria-label={scope} />
                      <span class="text-sm text-[var(--color-text-primary)]">{scope}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <div class="flex justify-end gap-3 pt-4">
              <Button variant="secondary" onClick={resetCreateForm}>{t('cancel')}</Button>
              <Button variant="primary" onClick={handleCreateClient} isLoading={creating()}>{t('create')}</Button>
            </div>
          </div>
        }>
          {(client) => (
            <div class="flex flex-col gap-4">
              <Card style={{ 'background-color': 'var(--color-warning-bg)', border: '1px solid var(--color-warning)' }}>
                <p class="text-sm text-[var(--color-warning)] m-0">
                  {t('oauthClientSecretWarning')}
                </p>
              </Card>
              <div>
                <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientId')}</label>
                <div class="flex gap-2">
                  <code class="flex-1 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] font-mono text-sm overflow-x-auto">
                    {client().client_id}
                  </code>
                  <Button variant="secondary" size="sm" onClick={() => handleCopy(client().client_id, 'id')}>
                    {copied() === 'id' ? t('copied') : t('copyToClipboard')}
                  </Button>
                </div>
              </div>
              <Show when={client().client_secret}>
                <div>
                  <label class="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('oauthClientSecret')}</label>
                  <div class="flex gap-2">
                    <code class="flex-1 px-3 py-2 rounded-lg bg-[var(--color-surface-secondary)] font-mono text-sm overflow-x-auto">
                      {client().client_secret}
                    </code>
                    <Button variant="secondary" size="sm" onClick={() => handleCopy(client().client_secret!, 'secret')}>
                      {copied() === 'secret' ? t('copied') : t('copyToClipboard')}
                    </Button>
                  </div>
                </div>
              </Show>
              <Button variant="primary" onClick={resetCreateForm}>{t('close')}</Button>
            </div>
          )}
        </Show>
      </Show>
    </Show>
  );
}
