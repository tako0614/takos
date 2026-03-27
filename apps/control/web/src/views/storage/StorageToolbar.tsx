import { useRef } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { formatFileSize } from '../../lib/format';
import { StorageNewDropdown } from './StorageNewDropdown';

interface StorageToolbarProps {
  loading: boolean;
  uploading: boolean;
  downloadingZip: boolean;
  downloadedZipBytes: number;
  onRefresh: () => void;
  onDownloadZip: () => void;
  onNewFolder: () => void;
  onFileSelect: (files: FileList | null) => void;
}

export function StorageToolbar({
  loading,
  uploading,
  downloadingZip,
  downloadedZipBytes,
  onRefresh,
  onDownloadZip,
  onNewFolder,
  onFileSelect,
}: StorageToolbarProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3">
      <StorageNewDropdown
        onNewFolder={onNewFolder}
        onUpload={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFileSelect(e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />

      {uploading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Icons.Loader className="w-4 h-4 animate-spin" />
          {t('uploading')}
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={onRefresh}
        disabled={loading}
        className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50"
        title={t('refresh')}
      >
        <Icons.Refresh className={'w-5 h-5 ' + (loading ? 'animate-spin' : '')} />
      </button>
      <button
        onClick={onDownloadZip}
        disabled={downloadingZip}
        className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50"
        title={t('downloadZip')}
      >
        {downloadingZip
          ? <Icons.Loader className="w-5 h-5 animate-spin" />
          : <Icons.Archive className="w-5 h-5" />
        }
      </button>
      {downloadingZip && (
        <span className="text-xs text-zinc-400 tabular-nums">
          {formatFileSize(downloadedZipBytes)}
        </span>
      )}
    </div>
  );
}
