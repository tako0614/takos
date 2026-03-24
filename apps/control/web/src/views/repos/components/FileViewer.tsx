import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../../../lib/Icons';
import { useI18n } from '../../../providers/I18nProvider';
import type { FileContent } from '../../../types';
import { formatDateTime, formatFileSize } from '../../../lib/format';
import { rpc, rpcJson } from '../../../lib/rpc';
import { Modal } from '../../../components/ui/Modal';

interface FileViewerProps {
  repoId: string;
  branch: string;
  filePath: string;
  initialLine?: number;
  onBack: () => void;
}

type BlameLine = {
  line: number;
  content: string;
  commit_sha: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
};

type BlameResponse = {
  path: string;
  ref: string;
  truncated: boolean;
  lines: BlameLine[];
};

type FileHistoryCommit = {
  sha: string;
  message: string;
  author: { name: string; email: string };
  date: string;
  status: 'added' | 'modified' | 'deleted';
};

type FileHistoryResponse = {
  path: string;
  ref: string;
  commits: FileHistoryCommit[];
};

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (rpc.repos[':repoId'] as any).blob[':ref'].$get({
        param: { repoId, ref: branch },
        query: { path: filePath },
      });
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
    } catch (err) {
      console.error('Failed to download file:', err);
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
    } catch (err) {
      console.error('Failed to copy:', err);
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
        if ((err as Error).name === 'AbortError') return;
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
        if ((err as Error).name === 'AbortError') return;
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

  const blameByLine = useMemo(() => {
    if (!blameData?.lines) return null;
    const map = new Map<number, BlameLine>();
    for (const ln of blameData.lines) {
      map.set(ln.line, ln);
    }
    return map;
  }, [blameData]);

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
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
            onClick={onBack}
            aria-label={t('goBack')}
          >
            <Icons.ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Icons.File className="w-4 h-4 text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
            <span className="text-zinc-900 dark:text-zinc-100 truncate">{filePath}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatFileSize(file.size)}</span>
          {canShowTextTools && (
            <>
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                  blameEnabled
                    ? 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800'
                    : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
                onClick={() => setBlameEnabled((v) => !v)}
                disabled={blameLoading}
                title={t('toggleBlame')}
              >
                <Icons.User className="w-4 h-4" />
                <span>{blameLoading ? t('blameLoading') : t('blame')}</span>
              </button>

              <button
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                onClick={() => setHistoryOpen(true)}
                title={t('fileHistory')}
              >
                <Icons.Clock className="w-4 h-4" />
                <span>{t('history')}</span>
              </button>
            </>
          )}
          {canShowTextTools && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              onClick={handleCopy}
            >
              {copied ? <Icons.Check className="w-4 h-4 text-zinc-900 dark:text-zinc-100" /> : <Icons.Copy className="w-4 h-4" />}
              <span>{copied ? t('copied') : t('copy')}</span>
            </button>
          )}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={handleDownload}
          >
            <Icons.Download className="w-4 h-4" />
            <span>{t('download')}</span>
          </button>
        </div>
      </div>

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
        {isImage ? (
          <div className="flex items-center justify-center p-8">
            <img
              src={`data:${mimeType};base64,${file.content}`}
              alt={file.name}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        ) : isPdf ? (
          <div className="w-full h-full">
            <iframe
              title={file.name}
              src={`data:${mimeType};base64,${file.content}`}
              sandbox=""
              className="w-full h-full"
            />
          </div>
        ) : isAudio ? (
          <div className="flex items-center justify-center p-8">
            <audio controls src={`data:${mimeType};base64,${file.content}`} />
          </div>
        ) : isVideo ? (
          <div className="flex items-center justify-center p-8">
            <video controls className="max-w-full max-h-full" src={`data:${mimeType};base64,${file.content}`} />
          </div>
        ) : isBinary ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
            <Icons.File className="w-12 h-12" />
            <p>{t('binaryFileNotDisplayed')}</p>
            <span>{t('sizeLabel', { size: formatFileSize(file.size) })}</span>
          </div>
        ) : (
          <div className="flex text-sm font-mono">
            {blameEnabled && (
              <div className="flex flex-col py-3 px-3 bg-zinc-50 dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 select-none w-64">
                {blameError ? (
                  <div className="text-xs text-red-600 leading-5">
                    {blameError}
                  </div>
                ) : (
                  lines.map((_, index) => {
                    const lineNo = index + 1;
                    const blame = blameByLine?.get(lineNo);
                    const shaShort = blame?.commit_sha ? blame.commit_sha.slice(0, 7) : '';
                    const author = blame?.author_name || '';
                    const title = blame ? `${blame.commit_sha}\n${blame.author_name} <${blame.author_email}>\n${blame.message}` : '';
                    return (
                      <div
                        key={index}
                        className="leading-6 flex items-center gap-2 min-w-0"
                        title={title}
                      >
                        <span className="font-mono text-zinc-400 w-14 flex-shrink-0">{shaShort}</span>
                        <span className="truncate text-zinc-500 dark:text-zinc-400">{author}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
            <div className="flex flex-col py-3 px-3 bg-zinc-50 dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 text-right text-zinc-500 dark:text-zinc-400 select-none">
              {lines.map((_, index) => (
                <span
                  key={index}
                  className={`leading-6 ${initialLine === index + 1 ? 'text-zinc-900 dark:text-zinc-100 font-semibold' : ''}`}
                >
                  {index + 1}
                </span>
              ))}
            </div>
            <pre className={`flex-1 py-3 px-4 overflow-x-auto language-${language}`}>
              <code className="text-zinc-900 dark:text-zinc-100">
                {lines.map((line, index) => (
                  <div
                    key={index}
                    id={`line-${index + 1}`}
                    className={`leading-6 ${initialLine === index + 1 ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}`}
                  >
                    {line || ' '}
                  </div>
                ))}
              </code>
            </pre>
          </div>
        )}
      </div>

      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        size="lg"
        title={t('fileHistoryTitle')}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">{t('path')}</div>
            <div className="font-mono text-sm text-zinc-900 dark:text-zinc-100 truncate">{filePath}</div>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0">
            {t('ref')}: <span className="font-mono">{branch}</span>
          </div>
        </div>

        {historyLoading ? (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
            <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            <span className="mt-3">{t('loadingHistory')}</span>
          </div>
        ) : historyError ? (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
            <Icons.AlertTriangle className="w-10 h-10 text-zinc-700 dark:text-zinc-300" />
            <span className="mt-3 text-zinc-700 dark:text-zinc-300">{historyError}</span>
          </div>
        ) : (historyData?.commits?.length ?? 0) === 0 ? (
          <div className="text-zinc-500 text-sm">{t('noHistoryEntries')}</div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {(historyData?.commits || []).map((cmt) => (
              <div key={cmt.sha} className="py-3 flex items-start gap-3">
                <div
                  className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                    cmt.status === 'added'
                      ? 'bg-green-500'
                      : cmt.status === 'deleted'
                        ? 'bg-red-500'
                        : 'bg-blue-500'
                  }`}
                  title={cmt.status}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">
                      {cmt.sha.slice(0, 7)}
                    </span>
                    <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{cmt.message}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 flex-wrap">
                    <span className="truncate">{cmt.author.name}</span>
                    <span className="text-zinc-300 dark:text-zinc-600">|</span>
                    <span>{formatDateTime(cmt.date)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
