import { createSignal, createEffect, on, Show, For } from 'solid-js';
import { Icons } from '../../../lib/Icons';
import type { RepoFile } from '../../../types';
import { useI18n } from '../../../store/i18n';
import { rpcJson, repoTree } from '../../../lib/rpc';

interface FileTreeProps {
  repoId: string;
  branch: string;
  basePath?: string;
  onFileSelect: (path: string) => void;
}

interface BreadcrumbItem {
  name: string;
  path: string;
}

export function FileTree(props: FileTreeProps) {
  const { t } = useI18n();
  const [files, setFiles] = createSignal<RepoFile[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [currentPath, setCurrentPath] = createSignal(props.basePath ?? '');

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const path = currentPath();
      const res = await repoTree(props.repoId, props.branch, path ? { path } : undefined);
      if (!res.ok) {
        let apiError = t('failedToFetchFiles');
        try {
          const body = await res.json() as { error?: string };
          if (body?.error) {
            apiError = body.error;
          }
        } catch { /* ignored */ }

        if (res.status === 404 && path && apiError === 'Path not found') {
          setFiles([]);
          setError(null);
          return;
        }
        throw new Error(apiError);
      }
      interface TreeEntry {
        name: string;
        type: 'file' | 'directory';
        size?: number;
        mode: string;
      }
      const data = await rpcJson<{ entries?: TreeEntry[] }>(res);
      const newFiles: RepoFile[] = (data.entries || []).map((entry: TreeEntry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        type: entry.type,
        size: entry.size,
        sha: '',
      }));
      setFiles(newFiles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(
    () => [props.repoId, props.branch, currentPath()],
    () => { fetchFiles(); },
  ));

  const handleItemClick = (file: RepoFile) => {
    if (file.type === 'directory') {
      setCurrentPath(file.path);
    } else {
      props.onFileSelect(file.path);
    }
  };

  const getBreadcrumbs = (): BreadcrumbItem[] => {
    const items: BreadcrumbItem[] = [{ name: 'root', path: '' }];
    const path = currentPath();
    if (path) {
      const parts = path.split('/');
      let accPath = '';
      for (const part of parts) {
        accPath = accPath ? `${accPath}/${part}` : part;
        items.push({ name: part, path: accPath });
      }
    }
    return items;
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatCommitDate = (dateString?: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t('today');
    if (diffDays === 1) return t('yesterday');
    if (diffDays < 7) return t('daysAgo', { count: diffDays });
    if (diffDays < 30) return t('weeksAgo', { count: Math.floor(diffDays / 7) });
    return date.toLocaleDateString();
  };

  const getFileIcon = (file: RepoFile) => {
    if (file.type === 'directory') {
      return <Icons.Folder class="w-4 h-4" />;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return <Icons.Code class="w-4 h-4" />;
      case 'md':
      case 'txt':
        return <Icons.FileText class="w-4 h-4" />;
      case 'json':
      case 'yaml':
      case 'yml':
        return <Icons.Settings class="w-4 h-4" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return <Icons.Image class="w-4 h-4" />;
      default:
        return <Icons.File class="w-4 h-4" />;
    }
  };

  const sortedFiles = () => [...files()].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <Show when={loading()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
          <div class="w-8 h-8 border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent rounded-full animate-spin" />
          <span>{t('loadingFiles')}</span>
        </div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
          <Icons.AlertTriangle class="w-12 h-12 text-zinc-700 dark:text-zinc-300" />
          <span>{error()}</span>
          <button
            class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={fetchFiles}
          >
            {t('retry')}
          </button>
        </div>
      </Show>

      <Show when={!loading() && !error()}>
        {(() => {
          const breadcrumbs = getBreadcrumbs();
          return (
            <div class="flex flex-col bg-white dark:bg-zinc-900">
              <div class="flex items-center gap-1 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 overflow-x-auto">
                <For each={breadcrumbs}>{(item, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span class="text-zinc-500 dark:text-zinc-400">/</span>
                    </Show>
                    <button
                      class={`px-1.5 py-0.5 rounded text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
                        index() === breadcrumbs.length - 1
                          ? 'text-zinc-900 dark:text-zinc-100 font-medium'
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                      onClick={() => setCurrentPath(item.path)}
                    >
                      {item.name}
                    </button>
                  </>
                )}</For>
              </div>

              <div class="flex flex-col">
                <div class="grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800">
                  <span>{t('name')}</span>
                  <span>{t('lastCommitMessage')}</span>
                  <span>{t('lastUpdate')}</span>
                </div>

                <Show when={currentPath()}>
                  <div
                    class="grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2.5 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-800 transition-colors"
                    onClick={() => {
                      const parentPath = currentPath().split('/').slice(0, -1).join('/');
                      setCurrentPath(parentPath);
                    }}
                  >
                    <span class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      <Icons.ArrowLeft class="w-4 h-4" />
                      <span>..</span>
                    </span>
                    <span class="text-zinc-500 dark:text-zinc-400"></span>
                    <span class="text-zinc-500 dark:text-zinc-400"></span>
                  </div>
                </Show>

                <For each={sortedFiles()}>{(file) => (
                  <div
                    class={`grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2.5 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-800 transition-colors ${
                      file.type === 'directory' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                    onClick={() => handleItemClick(file)}
                  >
                    <span class="flex items-center gap-2 min-w-0">
                      <span class="text-zinc-500 dark:text-zinc-400 flex-shrink-0">{getFileIcon(file)}</span>
                      <span class="truncate">{file.name}</span>
                      <Show when={file.type === 'file' && file.size}>
                        <span class="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0">{formatFileSize(file.size)}</span>
                      </Show>
                    </span>
                    <span class="text-sm text-zinc-500 dark:text-zinc-400 truncate" title={file.last_commit?.message}>
                      {file.last_commit?.message || ''}
                    </span>
                    <span class="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {formatCommitDate(file.last_commit?.date)}
                    </span>
                  </div>
                )}</For>

                <Show when={sortedFiles().length === 0}>
                  <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
                    <Icons.Folder class="w-12 h-12" />
                    <span>{t('directoryEmpty')}</span>
                  </div>
                </Show>
              </div>
            </div>
          );
        })()}
      </Show>
    </>
  );
}
