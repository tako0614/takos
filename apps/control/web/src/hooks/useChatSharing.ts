import { createSignal, createEffect } from 'solid-js';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { useI18n } from '../store/i18n.ts';
import { useToast } from '../store/toast.ts';

export type ThreadShare = {
  id: string;
  thread_id: string;
  space_id: string;
  created_by: string | null;
  token: string;
  mode: 'public' | 'password';
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
  share_path: string;
  share_url: string;
};

export interface UseChatSharingReturn {
  showShareModal: boolean;
  setShowShareModal: (v: boolean) => void;
  showExportModal: boolean;
  setShowExportModal: (v: boolean) => void;
  sharesLoading: boolean;
  shares: ThreadShare[];
  shareMode: 'public' | 'password';
  setShareMode: (v: 'public' | 'password') => void;
  sharePassword: string;
  setSharePassword: (v: string) => void;
  shareExpiresInDays: string;
  setShareExpiresInDays: (v: string) => void;
  shareError: string | null;
  creatingShare: boolean;
  fetchShares: () => Promise<void>;
  createShare: () => Promise<void>;
  revokeShare: (shareId: string) => Promise<void>;
  downloadExport: (format: 'markdown' | 'json' | 'pdf') => Promise<void>;
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1] || null;
}

export function useChatSharing(threadId: string): UseChatSharingReturn {
  const { t } = useI18n();
  const { showToast } = useToast();

  const [showShareModal, setShowShareModal] = createSignal(false);
  const [showExportModal, setShowExportModal] = createSignal(false);
  const [sharesLoading, setSharesLoading] = createSignal(false);
  const [shares, setShares] = createSignal<ThreadShare[]>([]);
  const [shareMode, setShareMode] = createSignal<'public' | 'password'>('public');
  const [sharePassword, setSharePassword] = createSignal('');
  const [shareExpiresInDays, setShareExpiresInDays] = createSignal<string>('');
  const [shareError, setShareError] = createSignal<string | null>(null);
  const [creatingShare, setCreatingShare] = createSignal(false);

  const fetchShares = async () => {
    setSharesLoading(true);
    setShareError(null);
    try {
      const res = await rpc.threads[':id'].shares.$get({ param: { id: threadId } });
      const data = await rpcJson<{ shares: ThreadShare[] }>(res);
      setShares(data.shares || []);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : t('failedToLoadShares'));
    } finally {
      setSharesLoading(false);
    }
  };

  createEffect(() => {
    if (showShareModal()) {
      fetchShares();
    }
  });

  const createShare = async () => {
    setCreatingShare(true);
    setShareError(null);
    try {
      const expiresStr = shareExpiresInDays().trim();
      const expires_in_days = expiresStr ? Number.parseInt(expiresStr, 10) : undefined;
      const res = await rpc.threads[':id'].share.$post({
        param: { id: threadId },
        json: {
          mode: shareMode(),
          password: shareMode() === 'password' ? sharePassword() : undefined,
          expires_in_days: typeof expires_in_days === 'number' && Number.isFinite(expires_in_days) ? expires_in_days : undefined,
        },
      });
      const data = await rpcJson<{ share: ThreadShare; share_url: string }>(res);
      showToast('success', t('created') || 'Created');
      if (data.share_url) {
        try {
          await navigator.clipboard.writeText(data.share_url);
          showToast('success', t('copied') || 'Copied');
        } catch { /* ignored */ }
      }
      setSharePassword('');
      setShareExpiresInDays('');
      await fetchShares();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : t('failedToCreateShare'));
    } finally {
      setCreatingShare(false);
    }
  };

  const revokeShare = async (shareId: string) => {
    try {
      const res = await rpc.threads[':id'].shares[':shareId'].revoke.$post({
        param: { id: threadId, shareId },
      });
      await rpcJson(res);
      showToast('success', t('revoked') || 'Revoked');
      await fetchShares();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToRevoke'));
    }
  };

  const downloadExport = async (format: 'markdown' | 'json' | 'pdf') => {
    try {
      const res = await rpc.threads[':id'].export.$get({
        param: { id: threadId },
        query: { format },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || t('exportFailed'));
      }
      const filename =
        parseContentDispositionFilename(res.headers.get('Content-Disposition')) ||
        `thread-${threadId}.${format === 'markdown' ? 'md' : format}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      showToast('success', t('download') || 'Download');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('exportFailed'));
    }
  };

  return {
    get showShareModal() { return showShareModal(); },
    setShowShareModal,
    get showExportModal() { return showExportModal(); },
    setShowExportModal,
    get sharesLoading() { return sharesLoading(); },
    get shares() { return shares(); },
    get shareMode() { return shareMode(); },
    setShareMode,
    get sharePassword() { return sharePassword(); },
    setSharePassword,
    get shareExpiresInDays() { return shareExpiresInDays(); },
    setShareExpiresInDays,
    get shareError() { return shareError(); },
    get creatingShare() { return creatingShare(); },
    fetchShares,
    createShare,
    revokeShare,
    downloadExport,
  };
}
