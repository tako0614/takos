import { createSignal } from 'solid-js';
import { useI18n } from '../../../store/i18n.ts';
import { Icons } from '../../../lib/Icons.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Modal, ModalFooter } from '../../../components/ui/Modal.tsx';
import type { Resource } from '../../../types/index.ts';
import { useResourceAccessTokens } from '../../../hooks/useResourceAccessTokens.ts';
import type { ResourceAccessToken, ResourceConnectionInfo } from '../../../hooks/useResourceAccessTokens.ts';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard.ts';

interface ResourceOverviewTabProps {
  resource: Resource;
}

export function ResourceOverviewTab({ resource }: ResourceOverviewTabProps) {
  const { t } = useI18n();
  const {
    connectionInfo,
    loadingConnection,
    tokens,
    loadingTokens,
    creatingToken,
    deletingTokenId,
    createToken,
    deleteToken,
  } = useResourceAccessTokens(resource);

  const [showCreateTokenModal, setShowCreateTokenModal] = createSignal(false);

  return (
    <div class="space-y-6" role="region" aria-label={t('overview')}>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Cloudflare ID</h4>
          <code class="text-sm text-zinc-900 dark:text-zinc-100 font-mono bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded">{resource.provider_resource_id || '-'}</code>
        </div>
        <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('createdAt')}</h4>
          <span class="text-sm text-zinc-900 dark:text-zinc-100">{resource.created_at ? new Date(resource.created_at).toLocaleDateString() : '-'}</span>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
        <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
          <Icons.Link class="w-4 h-4" aria-hidden="true" />
          {t('connectionInfo')}
        </h4>
        <ConnectionInfoDisplay connectionInfo={connectionInfo()} loading={loadingConnection()} />
      </div>

      <div class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
        <h4 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
          <Icons.Key class="w-4 h-4" aria-hidden="true" />
          {t('accessTokens')}
        </h4>
        <AccessTokensList
          tokens={tokens()}
          loading={loadingTokens()}
          deletingTokenId={deletingTokenId()}
          onDelete={deleteToken}
          onCreate={() => setShowCreateTokenModal(true)}
        />
      </div>

      <CreateTokenModal
        isOpen={showCreateTokenModal()}
        onClose={() => setShowCreateTokenModal(false)}
        onCreate={createToken}
        creating={creatingToken()}
      />
    </div>
  );
}

// --- Internal sub-components (moved from ResourceDetail.tsx) ---

function ConnectionInfoDisplay({
  connectionInfo,
  loading,
}: {
  connectionInfo: ResourceConnectionInfo | null;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = async (key: string, value: string) => {
    await copy(value);
    setCopiedKey(key);
  };

  if (loading) {
    return (
      <div class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400" role="status">
        <Icons.Loader class="w-4 h-4 animate-spin" aria-hidden="true" />
        <span>{t('loadingConnectionInfo')}</span>
      </div>
    );
  }

  if (!connectionInfo) {
    return <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('connectionInfoNotAvailable')}</p>;
  }

  return (
    <div class="space-y-3">
      {Object.entries(connectionInfo.connection).map(([key, value]) => (
        <div class="flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
              {key.replace(/_/g, ' ')}
            </label>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-sm text-zinc-900 dark:text-zinc-100 font-mono bg-zinc-100 dark:bg-zinc-700 px-3 py-2 rounded-lg truncate">
                {value}
              </code>
              <button type="button"
                onClick={() => handleCopy(key, value)}
                class="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                aria-label={`Copy ${key.replace(/_/g, ' ')} to clipboard`}
              >
                {copied() && copiedKey() === key ? (
                  <Icons.Check class="w-4 h-4 text-green-600" aria-hidden="true" />
                ) : (
                  <Icons.Copy class="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccessTokensList({
  tokens,
  loading,
  deletingTokenId,
  onDelete,
  onCreate,
}: {
  tokens: ResourceAccessToken[];
  loading: boolean;
  deletingTokenId: string | null;
  onDelete: (tokenId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400" role="status">
        <Icons.Loader class="w-4 h-4 animate-spin" aria-hidden="true" />
        <span>{t('loadingTokens')}</span>
      </div>
    );
  }

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {tokens.length === 0
            ? t('noAccessTokens')
            : t('tokensCreatedCount', { count: String(tokens.length) })}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icons.Plus class="w-4 h-4" />}
          onClick={onCreate}
          aria-label={t('generateTokenButton')}
        >
          {t('generateTokenButton')}
        </Button>
      </div>

      {tokens.length > 0 && (
        <ul class="space-y-2" aria-label="Access tokens">
          {tokens.map((token) => (
            <li

              class="flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <Icons.Key class="w-4 h-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
                  <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{token.name}</span>
                  <span class={`px-2 py-0.5 text-xs rounded-full ${
                    token.permission === 'write'
                      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                  }`}>
                    {token.permission}
                  </span>
                </div>
                <div class="mt-1 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <code class="font-mono">{token.token_prefix}...</code>
                  <span>{t('createdDate', { date: new Date(token.created_at).toLocaleDateString() })}</span>
                  {token.expires_at && (
                    <span>{t('expiresDate', { date: new Date(token.expires_at).toLocaleDateString() })}</span>
                  )}
                </div>
              </div>
              <button type="button"
                onClick={() => onDelete(token.id)}
                disabled={deletingTokenId === token.id}
                class="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-zinc-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                aria-label={`Delete token ${token.name}`}
              >
                {deletingTokenId === token.id ? (
                  <Icons.Loader class="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Icons.Trash class="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateTokenModal({
  isOpen,
  onClose,
  onCreate,
  creating,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, permission: 'read' | 'write', expiresInDays?: number) => Promise<ResourceAccessToken | null>;
  creating: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = createSignal('');
  const [permission, setPermission] = createSignal<'read' | 'write'>('read');
  const [expiresInDays, setExpiresInDays] = createSignal<string>('');
  const [newToken, setNewToken] = createSignal<string | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const handleCreate = async () => {
    const result = await onCreate(
      name(),
      permission(),
      expiresInDays() ? parseInt(expiresInDays(), 10) : undefined,
    );
    if (result?.token) {
      setNewToken(result.token);
    }
  };

  const handleCopyToken = async () => {
    if (newToken()) {
      await copy(newToken()!);
    }
  };

  const handleClose = () => {
    setName('');
    setPermission('read');
    setExpiresInDays('');
    setNewToken(null);
    onClose();
  };

  if (newToken()) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title={t('tokenCreatedTitle')} size="md">
        <div class="space-y-4">
          <div class="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" role="alert">
            <div class="flex items-start gap-3">
              <Icons.Check class="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" aria-hidden="true" />
              <div>
                <p class="text-sm font-medium text-green-800 dark:text-green-200">{t('tokenCreatedSuccessfully')}</p>
                <p class="mt-1 text-xs text-green-700 dark:text-green-300">
                  {t('copyTokenNow')}
                </p>
              </div>
            </div>
          </div>

          <div>
            <label for="new-token-value" class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              {t('accessTokenLabel')}
            </label>
            <div class="flex items-center gap-2">
              <code id="new-token-value" class="flex-1 text-sm text-zinc-900 dark:text-zinc-100 font-mono bg-zinc-100 dark:bg-zinc-700 px-3 py-2 rounded-lg break-all">
                {newToken()}
              </code>
              <button type="button"
                onClick={handleCopyToken}
                class="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                aria-label="Copy token to clipboard"
              >
                {copied() ? (
                  <Icons.Check class="w-4 h-4 text-green-600" aria-hidden="true" />
                ) : (
                  <Icons.Copy class="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button variant="primary" onClick={handleClose}>
            {t('done')}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('generateAccessTokenTitle')} size="md">
      <div class="space-y-4">
        <div>
          <label for="token-name" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('tokenNameLabel')}
          </label>
          <input
            id="token-name"
            type="text"
            value={name()}
            onInput={(e) => setName(e.target.value)}
            placeholder="e.g., Production API"
            class="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          />
        </div>

        <div>
          <label for="token-permission" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('permissionLabel')}
          </label>
          <select
            id="token-permission"
            value={permission()}
            onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
            class="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          >
            <option value="read">{t('readOnly')}</option>
            <option value="write">{t('readWrite')}</option>
          </select>
        </div>

        <div>
          <label for="token-expiration" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('expirationLabel')}
          </label>
          <select
            id="token-expiration"
            value={expiresInDays()}
            onChange={(e) => setExpiresInDays(e.target.value)}
            class="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
          >
            <option value="">{t('neverExpires')}</option>
            <option value="7">{t('days7')}</option>
            <option value="30">{t('days30')}</option>
            <option value="90">{t('days90')}</option>
            <option value="365">{t('year1')}</option>
          </select>
        </div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={handleClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={!name().trim() || creating}
          isLoading={creating}
        >
          {t('generateTokenButton')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
