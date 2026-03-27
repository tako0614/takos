import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { useI18n } from '../store/i18n';
import { useToast } from './useToast';

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

  const [showShareModal, setShowShareModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shares, setShares] = useState<ThreadShare[]>([]);
  const [shareMode, setShareMode] = useState<'public' | 'password'>('public');
  const [sharePassword, setSharePassword] = useState('');
  const [shareExpiresInDays, setShareExpiresInDays] = useState<string>('');
  const [shareError, setShareError] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);

  const fetchShares = useCallback(async () => {
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
  }, [threadId, t]);

  useEffect(() => {
    if (showShareModal) {
      fetchShares();
    }
  }, [showShareModal, fetchShares]);

  const createShare = useCallback(async () => {
    setCreatingShare(true);
    setShareError(null);
    try {
      const expires_in_days = shareExpiresInDays.trim() ? Number.parseInt(shareExpiresInDays.trim(), 10) : undefined;
      const res = await rpc.threads[':id'].share.$post({
        param: { id: threadId },
        json: {
          mode: shareMode,
          password: shareMode === 'password' ? sharePassword : undefined,
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
  }, [fetchShares, shareExpiresInDays, shareMode, sharePassword, showToast, t, threadId]);

  const revokeShare = useCallback(async (shareId: string) => {
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
  }, [fetchShares, showToast, t, threadId]);

  const downloadExport = useCallback(async (format: 'markdown' | 'json' | 'pdf') => {
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
  }, [showToast, t, threadId]);

  return {
    showShareModal,
    setShowShareModal,
    showExportModal,
    setShowExportModal,
    sharesLoading,
    shares,
    shareMode,
    setShareMode,
    sharePassword,
    setSharePassword,
    shareExpiresInDays,
    setShareExpiresInDays,
    shareError,
    creatingShare,
    fetchShares,
    createShare,
    revokeShare,
    downloadExport,
  };
}
