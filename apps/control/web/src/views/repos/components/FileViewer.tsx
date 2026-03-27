import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../../../lib/Icons';
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

const languageMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  dockerfile: 'dockerfile',
  toml: 'toml',
};

export function FileViewer({ repoId, branch, filePath, initialLine, onBack }: FileViewerProps) {
  const { t } = useI18n();
  const [file, setFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [blameEnabled, setBlameEnabled] = useState(false);
  const [blameLoading, setBlameLoading] = useState(false);
  const [blameError, setBlameError] = useState<string | null>(null);
  const [blameData, setBlameData] = useState<BlameResponse | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<FileHistoryResponse | null>(null);
  const [copyResetTimer, setCopyResetTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

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
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return languageMap[ext] || 'text';
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
    setBlameEnabled(false);
    setBlameError(null);
    setBlameData(null);
    setHistoryOpen(false);
    setHistoryError(null);
    setHistoryData(null);
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
    } catch (_err) {
      // download failed silently
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(decodedContent);
      setCopied(true);
      if (copyResetTimer) {
        clearTimeout(copyResetTimer);
      }
      const timer = setTimeout(() => {
        setCopied(false);
        setCopyResetTimer(null);
      }, 2000);
      setCopyResetTimer(timer);
    } catch (_err) {
      // copy failed silently
    }
  };

  useEffect(() => () => {
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
    }
  }, [copyResetTimer]);

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
    if (!blameEnabled) return;
    if (!canShowTextTools) return;

    const controller = new AbortController();
    void (async () => {
      try {
        setBlameLoading(true);
        setBlameError(null);

        const url = `/api/repos/${encodeURIComponent(repoId)}/blame/${encodeURIComponent(branch)}?path=${encodeURIComponent(filePath)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        const data = await rpcJson<BlameResponse>(res);
        setBlameData(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setBlameError(err instanceof Error ? err.message : t('failedToLoadBlame'));
        setBlameData(null);
      } finally {
        if (!controller.signal.aborted) {
          setBlameLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [blameEnabled, canShowTextTools, repoId, branch, filePath]);

  useEffect(() => {
    if (!historyOpen) return;
    if (!canShowTextTools) return;

    const controller = new AbortController();
    void (async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);

        const url = `/api/repos/${encodeURIComponent(repoId)}/log/${encodeURIComponent(branch)}?path=${encodeURIComponent(filePath)}&limit=50`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        const data = await rpcJson<FileHistoryResponse>(res);
        setHistoryData(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setHistoryError(err instanceof Error ? err.message : t('failedToLoadHistory'));
        setHistoryData(null);
      } finally {
        if (!controller.signal.aborted) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [historyOpen, canShowTextTools, repoId, branch, filePath]);

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
        blameEnabled={blameEnabled} blameLoading={blameLoading} copied={copied}
        onBack={onBack} onToggleBlame={() => setBlameEnabled(v => !v)}
        onOpenHistory={() => setHistoryOpen(true)} onCopy={handleCopy} onDownload={handleDownload}
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
          blameEnabled={blameEnabled} blameError={blameError} blameData={blameData}
        />
      </div>

      <FileHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        filePath={filePath}
        branch={branch}
        loading={historyLoading}
        error={historyError}
        data={historyData}
      />
    </div>
  );
}
