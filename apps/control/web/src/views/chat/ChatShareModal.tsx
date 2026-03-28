import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Icons } from '../../lib/Icons';
import type { ThreadShare } from '../../hooks/useChatSharing';

export interface ChatShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  sharesLoading: boolean;
  shares: ThreadShare[];
  shareMode: 'public' | 'password';
  onShareModeChange: (v: 'public' | 'password') => void;
  sharePassword: string;
  onSharePasswordChange: (v: string) => void;
  shareExpiresInDays: string;
  onShareExpiresInDaysChange: (v: string) => void;
  shareError: string | null;
  creatingShare: boolean;
  onFetchShares: () => void;
  onCreateShare: () => void;
  onRevokeShare: (shareId: string) => void;
}

export function ChatShareModal({
  isOpen,
  onClose,
  sharesLoading,
  shares,
  shareMode,
  onShareModeChange,
  sharePassword,
  onSharePasswordChange,
  shareExpiresInDays,
  onShareExpiresInDaysChange,
  shareError,
  creatingShare,
  onFetchShares,
  onCreateShare,
  onRevokeShare,
}: ChatShareModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('shareResource')}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('shareMode')}</div>
            <select
              value={shareMode}
              onChange={(e) => onShareModeChange(e.target.value === 'password' ? 'password' : 'public')}
              className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
            >
              <option value="public">{t('sharePublic')}</option>
              <option value="password">{t('sharePasswordLabel')}</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('shareExpiresDays')}</div>
            <Input
              value={shareExpiresInDays}
              onChange={(e) => onShareExpiresInDaysChange(e.target.value)}
              placeholder="e.g. 7"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('sharePasswordLabel')}</div>
            <Input
              type="password"
              value={sharePassword}
              onChange={(e) => onSharePasswordChange(e.target.value)}
              placeholder={shareMode === 'password' ? 'min 8 chars' : '(optional)'}
              disabled={shareMode !== 'password'}
            />
          </div>
        </div>

        {shareError && (
          <div className="text-sm text-red-600 dark:text-red-400">
            {shareError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={onFetchShares}
            disabled={sharesLoading}
            leftIcon={<Icons.Refresh className={'w-4 h-4 ' + (sharesLoading ? 'animate-spin' : '')} />}
          >
            {t('refresh')}
          </Button>
          <Button
            variant="primary"
            onClick={onCreateShare}
            disabled={creatingShare || (shareMode === 'password' && sharePassword.trim().length < 8)}
            isLoading={creatingShare}
            leftIcon={<Icons.Link className="w-4 h-4" />}
          >
            {t('create')}
          </Button>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('shareLinks')}</h3>
            {sharesLoading && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                <Icons.Loader className="w-4 h-4 animate-spin" />
                {t('loading')}
              </span>
            )}
          </div>

          {shares.length === 0 && !sharesLoading ? (
            <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              {t('noShareLinks')}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {shares.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {s.share_url}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                        {s.mode}
                      </span>
                      {s.revoked_at && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                          {t('revoked') || 'Revoked'}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {s.expires_at ? t('shareExpiresAt', { date: s.expires_at }) : t('shareNoExpiry')}
                      {s.last_accessed_at ? ` \u00B7 ${t('shareLastAccessed', { date: s.last_accessed_at })}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(s.share_url);
                          showToast('success', t('copied') || 'Copied');
                        } catch {
                          showToast('error', t('failedToCopy'));
                        }
                      }}
                      disabled={!!s.revoked_at}
                      title={t('copy')}
                    >
                      <Icons.Copy className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
                      onClick={() => onRevokeShare(s.id)}
                      disabled={!!s.revoked_at}
                      title={t('revoke') || 'Revoke'}
                    >
                      <Icons.Trash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
