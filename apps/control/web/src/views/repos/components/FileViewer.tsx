import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Icons } from '../../../lib/Icons';
import { detectLanguage } from '../../../lib/languageMap';
import { useI18n } from '../../../store/i18n';
import type { FileContent } from '../../../types';
import { formatDateTime } from '../../../lib/format';
import { rpcJson, repoBlob } from '../../../lib/rpc';
import type { BlameResponse } from './CodeViewer';
import { FileHistoryModal } from './FileHistoryModal';
import type { FileHistoryResponse } from './FileHistoryModal';
import { FileViewerToolbar } from './FileViewerToolbar';
import { FileContentRenderer } from './FileContentRenderer';

interface FileViewerProps {
  repoId: string;
  branch: string;
  filePath: string;
  initialLine?: number;
  onBack: () => void;
}

interface BlobResponse {
  path: string;
  size: number;
  content: string;
  is_binary: boolean;
  encoding?: 'utf-8' | 'base64';
  mime_type?: string;
}

/* ── Blame state ─────────────────────────────────────────────── */

interface BlameState {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  data: BlameResponse | null;
}

type BlameAction =
  | { type: 'toggle' }
  | { type: 'fetch_start' }
  | { type: 'fetch_ok'; data: BlameResponse }
  | { type: 'fetch_fail'; error: string }
  | { type: 'reset' };

function blameReducer(state: BlameState, action: BlameAction): BlameState {
  switch (action.type) {
    case 'toggle':
      return { ...state, enabled: !state.enabled };
    case 'fetch_start':
      return { ...state, loading: true, error: null };
    case 'fetch_ok':
      return { ...state, loading: false, data: action.data };
    case 'fetch_fail':
      return { ...state, loading: false, error: action.error, data: null };
    case 'reset':
      return { enabled: false, loading: false, error: null, data: null };
  }
}

const blameInit: BlameState = { enabled: false, loading: false, error: null, data: null };

/* ── History state ───────────────────────────────────────────── */

interface HistoryState {
  open: boolean;
  loading: boolean;
  error: string | null;
  data: FileHistoryResponse | null;
}

type HistoryAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'fetch_start' }
  | { type: 'fetch_ok'; data: FileHistoryResponse }
  | { type: 'fetch_fail'; error: string }
  | { type: 'reset' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true };
    case 'close':
      return { ...state, open: false };
    case 'fetch_start':
      return { ...state, loading: true, error: null };
    case 'fetch_ok':
      return { ...state, loading: false, data: action.data };
    case 'fetch_fail':
      return { ...state, loading: false, error: action.error, data: null };
    case 'reset':
      return { open: false, loading: false, error: null, data: null };
  }
}

const historyInit: HistoryState = { open: false, loading: false, error: null, data: null };

export function FileViewer({ repoId, branch, filePath, initialLine, onBack }: FileViewerProps) {
  const { t } = useI18n();
  const [file, setFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [blame, blameDispatch] = useReducer(blameReducer, blameInit);
  const [history, historyDispatch] = useReducer(historyReducer, historyInit);

  useEffect(() => {
    fetchFile();
  }, [repoId, branch, filePath]);

  const fetchFile = async () => {
    try {
      setLoading(true);
      const res = await repoBlob(repoId, branch, { path: filePath });
      const data = await rpcJson<BlobResponse>(res);
      const fileContent: FileContent = {
        path: data.path,
        name: data.path.split('/').pop() || '',
        size: data.size,
        content: data.content,
        encoding: data.encoding || (data.is_binary ? 'base64' : 'utf-8'),
        mime_type: data.mime_type,
        sha: '',
      };
      setFile(fileContent);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const language = useMemo(() => {
    if (!file) return 'text';
    return detectLanguage(file.name);
  }, [file]);

  const decodedContent = useMemo(() => {
    if (!file) return '';
    if (file.encoding === 'base64') {
      try {
        return atob(file.content);
      } catch {
        return file.content;
      }
    }
    return file.content;
  }, [file]);

  const lines = useMemo(() => decodedContent.split('\n'), [decodedContent]);

  const mimeType = useMemo(() => {
    if (!file) return 'text/plain';
    if (file.mime_type) return file.mime_type;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
      pdf: 'application/pdf',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      mp4: 'video/mp4',
      webm: 'video/webm',
    };
    return map[ext] || 'text/plain';
  }, [file]);

  const isImage = !!file && mimeType.startsWith('image/');
  const isPdf = !!file && mimeType === 'application/pdf';
  const isAudio = !!file && mimeType.startsWith('audio/');
  const isVideo = !!file && mimeType.startsWith('video/');

  const isBinary = useMemo(() => {
    if (!file || isImage || isPdf || isAudio || isVideo) return false;
    if (file.encoding === 'base64') return true;
    const sample = decodedContent.slice(0, 1000);
    const nonPrintable = sample.split('').filter(c => {
      const code = c.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    return nonPrintable / sample.length > 0.1;
  }, [file, decodedContent, isImage, isPdf, isAudio, isVideo]);

  const canShowTextTools = !loading && !error && !!file && !isBinary && !isImage && !isPdf && !isAudio && !isVideo;

  useEffect(() => {
    if (canShowTextTools) return;
    blameDispatch({ type: 'reset' });
    historyDispatch({ type: 'reset' });
  }, [canShowTextTools, repoId, branch, filePath]);

  const handleDownload = () => {
    if (!file) return;
    try {
      let blob: Blob;
      if (file.encoding === 'base64') {
        const binary = atob(file.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: mimeType });
      } else {
        blob = new Blob([file.content], { type: mimeType });
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('File download failed:', err);
      setError(err instanceof Error ? err.message : t('unknownError'));
    }
  };

  const copyTimerRef = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(decodedContent);
      setCopied(true);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  }, [decodedContent, copyTimerRef]);

  useEffect(() => () => {
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
  }, [copyTimerRef]);

  useEffect(() => {
    if (!initialLine) return;
    if (loading) return;
    if (error || !file) return;
    if (isBinary || isImage || isPdf || isAudio || isVideo) return;

    const id = `line-${initialLine}`;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'center' });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [initialLine, loading, error, file, filePath, decodedContent, isBinary, isImage, isPdf, isAudio, isVideo]);

  useEffect(() => {
    if (!blame.enabled) return;
    if (!canShowTextTools) return;

    const controller = new AbortController();
    void (async () => {
      try {
        blameDispatch({ type: 'fetch_start' });

        const url = `/api/repos/${encodeURIComponent(repoId)}/blame/${encodeURIComponent(branch)}?path=${encodeURIComponent(filePath)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        const data = await rpcJson<BlameResponse>(res);
        blameDispatch({ type: 'fetch_ok', data });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        blameDispatch({ type: 'fetch_fail', error: err instanceof Error ? err.message : t('failedToLoadBlame') });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [blame.enabled, canShowTextTools, repoId, branch, filePath]);

  useEffect(() => {
    if (!history.open) return;
    if (!canShowTextTools) return;

    const controller = new AbortController();
    void (async () => {
      try {
        historyDispatch({ type: 'fetch_start' });

        const url = `/api/repos/${encodeURIComponent(repoId)}/log/${encodeURIComponent(branch)}?path=${encodeURIComponent(filePath)}&limit=50`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        const data = await rpcJson<FileHistoryResponse>(res);
        historyDispatch({ type: 'fetch_ok', data });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        historyDispatch({ type: 'fetch_fail', error: err instanceof Error ? err.message : t('failedToLoadHistory') });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [history.open, canShowTextTools, repoId, branch, filePath]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
        <span>{t('loadingFile')}</span>
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
        <Icons.AlertTriangle className="w-12 h-12 text-zinc-700 dark:text-zinc-300" />
        <span>{error || t('fileNotFound')}</span>
        <button
          className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={onBack}
        >
          {t('goBack')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      <FileViewerToolbar
        filePath={filePath} fileSize={file.size} canShowTextTools={canShowTextTools}
        blameEnabled={blame.enabled} blameLoading={blame.loading} copied={copied}
        onBack={onBack} onToggleBlame={() => blameDispatch({ type: 'toggle' })}
        onOpenHistory={() => historyDispatch({ type: 'open' })} onCopy={handleCopy} onDownload={handleDownload}
      />

      {file.last_commit && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{file.last_commit.author}</span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{file.last_commit.message}</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 flex-shrink-0">
            <span className="font-mono">{file.last_commit.sha.slice(0, 7)}</span>
            <span>{formatDateTime(file.last_commit.date)}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <FileContentRenderer
          fileName={file.name} fileContent={file.content} fileSize={file.size}
          mimeType={mimeType} isImage={isImage} isPdf={isPdf} isAudio={isAudio} isVideo={isVideo} isBinary={isBinary}
          lines={lines} language={language} initialLine={initialLine}
          blameEnabled={blame.enabled} blameError={blame.error} blameData={blame.data}
        />
      </div>

      <FileHistoryModal
        isOpen={history.open}
        onClose={() => historyDispatch({ type: 'close' })}
        filePath={filePath}
        branch={branch}
        loading={history.loading}
        error={history.error}
        data={history.data}
      />
    </div>
  );
}
