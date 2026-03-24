import { Fragment, useState, useEffect } from 'react';
import { Icons } from '../../../lib/Icons';
import type { RepoFile } from '../../../types';
import { useI18n } from '../../../providers/I18nProvider';
import { rpc, rpcJson } from '../../../lib/rpc';

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

export function FileTree({ repoId, branch, basePath = '', onFileSelect }: FileTreeProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(basePath);

  useEffect(() => {
    fetchFiles();
  }, [repoId, branch, currentPath]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (rpc.repos[':repoId'] as any).tree[':ref'].$get({
        param: { repoId, ref: branch },
        query: currentPath ? { path: currentPath } : {},
      });
      if (!res.ok) {
        let apiError = t('failedToFetchFiles');
        try {
          const body = await res.json() as { error?: string };
          if (body?.error) {
            apiError = body.error;
          }
        } catch { /* ignored */ }

        if (res.status === 404 && currentPath && apiError === 'Path not found') {
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
      const files: RepoFile[] = (data.entries || []).map((entry: TreeEntry) => ({
        name: entry.name,
        path: currentPath ? `${currentPath}/${entry.name}` : entry.name,
        type: entry.type,
        size: entry.size,
        sha: '',
      }));
      setFiles(files);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = (file: RepoFile) => {
    if (file.type === 'directory') {
      setCurrentPath(file.path);
    } else {
      onFileSelect(file.path);
    }
  };

  const getBreadcrumbs = (): BreadcrumbItem[] => {
    const items: BreadcrumbItem[] = [{ name: 'root', path: '' }];
    if (currentPath) {
      const parts = currentPath.split('/');
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
      return <Icons.Folder className="w-4 h-4" />;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return <Icons.Code className="w-4 h-4" />;
      case 'md':
      case 'txt':
        return <Icons.FileText className="w-4 h-4" />;
      case 'json':
      case 'yaml':
      case 'yml':
        return <Icons.Settings className="w-4 h-4" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return <Icons.Image className="w-4 h-4" />;
      default:
        return <Icons.File className="w-4 h-4" />;
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
        <div className="w-8 h-8 border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent rounded-full animate-spin" />
        <span>{t('loadingFiles')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
        <Icons.AlertTriangle className="w-12 h-12 text-zinc-700 dark:text-zinc-300" />
        <span>{error}</span>
        <button
          className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={fetchFiles}
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex flex-col bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 overflow-x-auto">
        {breadcrumbs.map((item, index) => (
          <Fragment key={item.path}>
            {index > 0 && <span className="text-zinc-500 dark:text-zinc-400">/</span>}
            <button
              className={`px-1.5 py-0.5 rounded text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${
                index === breadcrumbs.length - 1
                  ? 'text-zinc-900 dark:text-zinc-100 font-medium'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
              onClick={() => setCurrentPath(item.path)}
            >
              {item.name}
            </button>
          </Fragment>
        ))}
      </div>

      <div className="flex flex-col">
        <div className="grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800">
          <span>{t('name')}</span>
          <span>{t('lastCommitMessage')}</span>
          <span>{t('lastUpdate')}</span>
        </div>

        {currentPath && (
          <div
            className="grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2.5 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-800 transition-colors"
            onClick={() => {
              const parentPath = currentPath.split('/').slice(0, -1).join('/');
              setCurrentPath(parentPath);
            }}
          >
            <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Icons.ArrowLeft className="w-4 h-4" />
              <span>..</span>
            </span>
            <span className="text-zinc-500 dark:text-zinc-400"></span>
            <span className="text-zinc-500 dark:text-zinc-400"></span>
          </div>
        )}

        {sortedFiles.map(file => (
          <div
            key={file.path}
            className={`grid grid-cols-[1fr_2fr_auto] gap-4 px-4 py-2.5 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-800 transition-colors ${
              file.type === 'directory' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
            }`}
            onClick={() => handleItemClick(file)}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-zinc-500 dark:text-zinc-400 flex-shrink-0">{getFileIcon(file)}</span>
              <span className="truncate">{file.name}</span>
              {file.type === 'file' && file.size && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0">{formatFileSize(file.size)}</span>
              )}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate" title={file.last_commit?.message}>
              {file.last_commit?.message || ''}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              {formatCommitDate(file.last_commit?.date)}
            </span>
          </div>
        ))}

        {sortedFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
            <Icons.Folder className="w-12 h-12" />
            <span>{t('directoryEmpty')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
