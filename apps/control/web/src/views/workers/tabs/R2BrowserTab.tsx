import { useState, useCallback, useRef, useEffect, Fragment } from 'react';
import { useI18n } from '../../../store/i18n';
import { useToast } from '../../../store/toast';
import { useConfirmDialog } from '../../../store/confirm-dialog';
import { Icons } from '../../../lib/Icons';
import { Button } from '../../../components/ui/Button';
import { rpc, rpcJson } from '../../../lib/rpc';
import type { Resource } from '../../../types';
import { formatFileSize, formatDateTime } from '../../../lib/format';

interface R2Object {
  key: string;
  size: number;
  uploaded: string;
  etag?: string;
}

interface R2BrowserTabProps {
  resource: Resource;
}

function getFileIcon(key: string): JSX.Element {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'];
  const codeExts = ['js', 'ts', 'tsx', 'jsx', 'html', 'css', 'json', 'md'];
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];

  if (imageExts.includes(ext)) {
    return <Icons.File className="w-5 h-5 text-purple-500" />;
  }
  if (codeExts.includes(ext)) {
    return <Icons.Code className="w-5 h-5 text-blue-500" />;
  }
  if (archiveExts.includes(ext)) {
    return <Icons.Archive className="w-5 h-5 text-orange-500" />;
  }
  return <Icons.File className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />;
}

function getDisplayName(key: string, prefix: string): string {
  const withoutPrefix = prefix ? key.slice(prefix.length) : key;
  return withoutPrefix || key;
}

function getFolders(objects: R2Object[], prefix: string): string[] {
  const folders = new Set<string>();
  for (const obj of objects) {
    const keyWithoutPrefix = prefix ? obj.key.slice(prefix.length) : obj.key;
    const slashIndex = keyWithoutPrefix.indexOf('/');
    if (slashIndex > 0) {
      folders.add(keyWithoutPrefix.slice(0, slashIndex + 1));
    }
  }
  return Array.from(folders).sort();
}

function getFiles(objects: R2Object[], prefix: string): R2Object[] {
  return objects.filter(obj => {
    const keyWithoutPrefix = prefix ? obj.key.slice(prefix.length) : obj.key;
    return !keyWithoutPrefix.includes('/');
  });
}

export function R2BrowserTab({ resource }: R2BrowserTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [objects, setObjects] = useState<R2Object[]>([]);
  const [prefix, setPrefix] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchObjects = useCallback(async (newPrefix: string = prefix, reset: boolean = true) => {
    if (!resource.cf_name) return;
    setLoading(true);
    try {
      const res = await rpc.resources[':id'].r2.objects.$get({
        param: { id: resource.id },
        query: { prefix: newPrefix || undefined, cursor: reset ? undefined : cursor, limit: '100' },
      });
      const result = await rpcJson<{ objects: R2Object[]; truncated: boolean; cursor?: string }>(res);
      if (reset) setObjects(result.objects || []);
      else setObjects(prev => [...prev, ...(result.objects || [])]);
      setHasMore(result.truncated);
      setCursor(result.cursor);
      setPrefix(newPrefix);
    } catch {
      showToast('error', t('failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [resource.name, resource.cf_name, prefix, cursor, showToast, t]);

  useEffect(() => {
    fetchObjects('', true);
  }, [resource.name]);

  const navigateToFolder = useCallback((folderName: string) => {
    fetchObjects(prefix + folderName, true);
  }, [prefix, fetchObjects]);

  const navigateUp = useCallback(() => {
    if (!prefix) return;
    const parts = prefix.slice(0, -1).split('/');
    parts.pop();
    fetchObjects(parts.length > 0 ? parts.join('/') + '/' : '', true);
  }, [prefix, fetchObjects]);

  const navigateToRoot = useCallback(() => {
    fetchObjects('', true);
  }, [fetchObjects]);

  const uploadFile = useCallback(async (file: File) => {
    const key = prefix + file.name;
    try {
      const urlRes = await rpc.resources[':id'].r2['upload-url'].$post({
        param: { id: resource.id },
        json: { key },
      });
      const { url } = await rpcJson<{ url: string }>(urlRes);
      const uploadRes = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      return uploadRes.ok;
    } catch {
      return false;
    }
  }, [resource.name, prefix]);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let success = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      if (await uploadFile(files[i])) success++;
      else fail++;
    }
    setUploading(false);
    if (success > 0) {
      showToast('success', t('uploadSuccess'));
      fetchObjects(prefix, true);
    }
    if (fail > 0) showToast('error', t('uploadFailed'));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFile, fetchObjects, prefix, showToast, t]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDelete = useCallback(async (key: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('r2DeleteConfirm').replace('{key}', key),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;
    setDeletingKey(key);
    try {
      const res = await rpc.resources[':id'].r2.objects[':key'].$delete({
        param: { id: resource.id, key: encodeURIComponent(key) },
      });
      if (!res.ok) throw new Error('Delete failed');
      showToast('success', t('deleted'));
      fetchObjects(prefix, true);
    } catch {
      showToast('error', t('failedToDelete'));
    } finally {
      setDeletingKey(null);
    }
  }, [resource.name, confirm, showToast, t, fetchObjects, prefix]);

  const handleDownload = useCallback(async (key: string) => {
    try {
      const res = await rpc.resources[':id'].r2['download-url'].$get({
        param: { id: resource.id },
        query: { key },
      });
      const { url } = await rpcJson<{ url: string }>(res);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      showToast('error', t('failedToLoad'));
    }
  }, [resource.name, showToast, t]);

  const breadcrumbParts = prefix ? prefix.slice(0, -1).split('/') : [];
  const folders = getFolders(objects, prefix);
  const files = getFiles(objects, prefix);

  return (
    <div
      className={'space-y-4 min-h-[400px] relative ' + (isDragOver ? 'ring-2 ring-blue-500 ring-inset rounded-lg' : '')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-600 dark:text-blue-400">
            <Icons.Upload className="w-12 h-12" />
            <span className="text-lg font-medium">{t('dragDropHint')}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
          <button
            onClick={navigateToRoot}
            className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex-shrink-0"
          >
            <Icons.Bucket className="w-4 h-4" />
            <span className="font-medium">{resource.name}</span>
          </button>
          {breadcrumbParts.map((part, index) => (
            <Fragment key={index}>
              <Icons.ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <button
                onClick={() => fetchObjects(breadcrumbParts.slice(0, index + 1).join('/') + '/', true)}
                className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
              >
                {part}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchObjects(prefix, true)}
            disabled={loading}
            leftIcon={<Icons.Refresh className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />}
          >
            {t('refresh')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            leftIcon={<Icons.Upload className="w-4 h-4" />}
            isLoading={uploading}
          >
            {t('upload')}
          </Button>
        </div>
      </div>
      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {loading && objects.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <Icons.Loader className="w-6 h-6 animate-spin text-zinc-500 dark:text-zinc-400" />
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-zinc-500 dark:text-zinc-400">
            <Icons.Bucket className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">{t('noObjects')}</p>
            <p className="text-xs mt-2">{t('dragDropHint')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  {t('name')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-28">
                  {t('size')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-44">
                  {t('r2LastModified')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-28">
                  {t('actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {prefix && (
                <tr className="hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer" onClick={navigateUp}>
                  <td className="px-4 py-3" colSpan={4}>
                    <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
                      <Icons.FolderOpen className="w-5 h-5 text-amber-500" />
                      <span>..</span>
                    </div>
                  </td>
                </tr>
              )}
              {folders.map(folder => (
                <tr
                  key={folder}
                  className="hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
                  onClick={() => navigateToFolder(folder)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
                      <Icons.Folder className="w-5 h-5 text-amber-500" />
                      <span>{folder}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">-</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">-</td>
                  <td className="px-4 py-3 text-right">-</td>
                </tr>
              ))}
              {files.map(obj => {
                const displayName = getDisplayName(obj.key, prefix);
                return (
                  <tr key={obj.key} className="hover:bg-zinc-100 dark:hover:bg-zinc-700">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
                        {getFileIcon(obj.key)}
                        <span className="truncate max-w-md" title={displayName}>
                          {displayName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{formatFileSize(obj.size)}</td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{formatDateTime(obj.uploaded)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownload(obj.key)}
                          className="p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                          title={t('download')}
                        >
                          <Icons.Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(obj.key);
                          }}
                          disabled={deletingKey === obj.key}
                          className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-zinc-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                          title={t('delete')}
                        >
                          {deletingKey === obj.key ? (
                            <Icons.Loader className="w-4 h-4 animate-spin" />
                          ) : (
                            <Icons.Trash className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasMore && (
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchObjects(prefix, false)}
              disabled={loading}
              isLoading={loading}
              className="w-full"
            >
              {t('r2LoadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
