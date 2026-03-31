import { createSignal, createEffect, on, onCleanup, Show } from 'solid-js';
import { Icons } from '../../../lib/Icons.tsx';
import { detectLanguage } from '../../../lib/languageMap.ts';
import { useI18n } from '../../../store/i18n.ts';
import type { FileContent } from '../../../types/index.ts';
import { formatDateTime } from '../../../lib/format.ts';
import { rpcJson, repoBlob } from '../../../lib/rpc.ts';
import type { BlameResponse } from './CodeViewer.tsx';
import { FileHistoryModal } from './FileHistoryModal.tsx';
import type { FileHistoryResponse } from './FileHistoryModal.tsx';
import { FileViewerToolbar } from './FileViewerToolbar.tsx';
import { FileContentRenderer } from './FileContentRenderer.tsx';

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

/* -- Blame state -- */

interface BlameState {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  data: BlameResponse | null;
}

const blameInit: BlameState = { enabled: false, loading: false, error: null, data: null };

/* -- History state -- */

interface HistoryState {
  open: boolean;
  loading: boolean;
  error: string | null;
  data: FileHistoryResponse | null;
}

const historyInit: HistoryState = { open: false, loading: false, error: null, data: null };

export function FileViewer(props: FileViewerProps) {
  const { t } = useI18n();
  const [file, setFile] = createSignal<FileContent | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [blame, setBlame] = createSignal<BlameState>(blameInit);
  const [history, setHistory] = createSignal<HistoryState>(historyInit);

  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  const fetchFile = async () => {
    try {
      setLoading(true);
      const res = await repoBlob(props.repoId, props.branch, { path: props.filePath });
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

  createEffect(on(
    () => [props.repoId, props.branch, props.filePath],
    () => { fetchFile(); },
  ));

  const language = () => {
    const f = file();
    if (!f) return 'text';
    return detectLanguage(f.name);
  };

  const decodedContent = () => {
    const f = file();
    if (!f) return '';
    if (f.encoding === 'base64') {
      try {
        return atob(f.content);
      } catch {
        return f.content;
      }
    }
    return f.content;
  };

  const lines = () => decodedContent().split('\n');

  const mimeType = () => {
    const f = file();
    if (!f) return 'text/plain';
    if (f.mime_type) return f.mime_type;
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
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
  };

  const isImage = () => !!file() && mimeType().startsWith('image/');
  const isPdf = () => !!file() && mimeType() === 'application/pdf';
  const isAudio = () => !!file() && mimeType().startsWith('audio/');
  const isVideo = () => !!file() && mimeType().startsWith('video/');

  const isBinary = () => {
    const f = file();
    if (!f || isImage() || isPdf() || isAudio() || isVideo()) return false;
    if (f.encoding === 'base64') return true;
    const sample = decodedContent().slice(0, 1000);
    const nonPrintable = sample.split('').filter(c => {
      const code = c.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    return nonPrintable / sample.length > 0.1;
  };

  const canShowTextTools = () => !loading() && !error() && !!file() && !isBinary() && !isImage() && !isPdf() && !isAudio() && !isVideo();

  createEffect(on(
    () => [canShowTextTools(), props.repoId, props.branch, props.filePath],
    () => {
      if (!canShowTextTools()) {
        setBlame(blameInit);
        setHistory(historyInit);
      }
    },
  ));

  const handleDownload = () => {
    const f = file();
    if (!f) return;
    try {
      let blob: Blob;
      if (f.encoding === 'base64') {
        const binary = atob(f.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: mimeType() });
      } else {
        blob = new Blob([f.content], { type: mimeType() });
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = f.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('File download failed:', err);
      setError(err instanceof Error ? err.message : t('unknownError'));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(decodedContent());
      setCopied(true);
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        setCopied(false);
        copyTimer = null;
      }, 2000);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  // Scroll to initial line
  createEffect(on(
    () => [props.initialLine, loading(), error(), file(), props.filePath, decodedContent(), isBinary(), isImage(), isPdf(), isAudio(), isVideo()],
    () => {
      if (!props.initialLine) return;
      if (loading()) return;
      if (error() || !file()) return;
      if (isBinary() || isImage() || isPdf() || isAudio() || isVideo()) return;

      const id = `line-${props.initialLine}`;
      const raf = requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ block: 'center' });
        }
      });
      onCleanup(() => cancelAnimationFrame(raf));
    },
  ));

  // Fetch blame data
  createEffect(on(
    () => [blame().enabled, canShowTextTools(), props.repoId, props.branch, props.filePath],
    () => {
      if (!blame().enabled) return;
      if (!canShowTextTools()) return;

      const controller = new AbortController();
      void (async () => {
        try {
          setBlame(prev => ({ ...prev, loading: true, error: null }));

          const url = `/api/repos/${encodeURIComponent(props.repoId)}/blame/${encodeURIComponent(props.branch)}?path=${encodeURIComponent(props.filePath)}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
          const data = await rpcJson<BlameResponse>(res);
          setBlame(prev => ({ ...prev, loading: false, data }));
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          setBlame(prev => ({ ...prev, loading: false, error: err instanceof Error ? err.message : t('failedToLoadBlame'), data: null }));
        }
      })();

      onCleanup(() => {
        controller.abort();
      });
    },
  ));

  // Fetch history data
  createEffect(on(
    () => [history().open, canShowTextTools(), props.repoId, props.branch, props.filePath],
    () => {
      if (!history().open) return;
      if (!canShowTextTools()) return;

      const controller = new AbortController();
      void (async () => {
        try {
          setHistory(prev => ({ ...prev, loading: true, error: null }));

          const url = `/api/repos/${encodeURIComponent(props.repoId)}/log/${encodeURIComponent(props.branch)}?path=${encodeURIComponent(props.filePath)}&limit=50`;
          const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
          const data = await rpcJson<FileHistoryResponse>(res);
          setHistory(prev => ({ ...prev, loading: false, data }));
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          setHistory(prev => ({ ...prev, loading: false, error: err instanceof Error ? err.message : t('failedToLoadHistory'), data: null }));
        }
      })();

      onCleanup(() => {
        controller.abort();
      });
    },
  ));

  return (
    <>
      <Show when={loading()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
          <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          <span>{t('loadingFile')}</span>
        </div>
      </Show>

      <Show when={!loading() && (error() || !file())}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
          <Icons.AlertTriangle class="w-12 h-12 text-zinc-700 dark:text-zinc-300" />
          <span>{error() || t('fileNotFound')}</span>
          <button
            class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={props.onBack}
          >
            {t('goBack')}
          </button>
        </div>
      </Show>

      <Show when={!loading() && !error() && file()}>
        {(f) => (
          <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
            <FileViewerToolbar
              filePath={props.filePath} fileSize={f().size} canShowTextTools={canShowTextTools()}
              blameEnabled={blame().enabled} blameLoading={blame().loading} copied={copied()}
              onBack={props.onBack} onToggleBlame={() => setBlame(prev => ({ ...prev, enabled: !prev.enabled }))}
              onOpenHistory={() => setHistory(prev => ({ ...prev, open: true }))} onCopy={handleCopy} onDownload={handleDownload}
            />

            <Show when={f().last_commit}>
              <div class="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">{f().last_commit!.author}</span>
                  <span class="text-sm text-zinc-500 dark:text-zinc-400 truncate">{f().last_commit!.message}</span>
                </div>
                <div class="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                  <span class="font-mono">{f().last_commit!.sha.slice(0, 7)}</span>
                  <span>{formatDateTime(f().last_commit!.date)}</span>
                </div>
              </div>
            </Show>

            <div class="flex-1 overflow-auto">
              <FileContentRenderer
                fileName={f().name} fileContent={f().content} fileSize={f().size}
                mimeType={mimeType()} isImage={isImage()} isPdf={isPdf()} isAudio={isAudio()} isVideo={isVideo()} isBinary={isBinary()}
                lines={lines()} language={language()} initialLine={props.initialLine}
                blameEnabled={blame().enabled} blameError={blame().error} blameData={blame().data}
              />
            </div>

            <FileHistoryModal
              isOpen={history().open}
              onClose={() => setHistory(prev => ({ ...prev, open: false }))}
              filePath={props.filePath}
              branch={props.branch}
              loading={history().loading}
              error={history().error}
              data={history().data}
            />
          </div>
        )}
      </Show>
    </>
  );
}
