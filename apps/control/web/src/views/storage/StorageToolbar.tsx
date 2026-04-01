import { Show } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Icons } from '../../lib/Icons.tsx';
import { formatFileSize } from '../../lib/format.ts';
import { StorageNewDropdown } from './StorageNewDropdown.tsx';

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

export function StorageToolbar(props: StorageToolbarProps) {
  const { t } = useI18n();
  let fileInputRef: HTMLInputElement | undefined;

  return (
    <div class="flex-shrink-0 flex items-center gap-3 px-4 py-3">
      <StorageNewDropdown
        onNewFolder={props.onNewFolder}
        onUpload={() => fileInputRef?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        class="hidden"
        onInput={(e) => {
          props.onFileSelect(e.currentTarget.files);
          if (fileInputRef) fileInputRef.value = '';
        }}
      />

      <Show when={props.uploading}>
        <div class="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Icons.Loader class="w-4 h-4 animate-spin" />
          {t('uploading')}
        </div>
      </Show>

      <div class="flex-1" />

      <button type="button"
        onClick={props.onRefresh}
        disabled={props.loading}
        class="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50"
        title={t('refresh')}
      >
        <Icons.Refresh class={'w-5 h-5 ' + (props.loading ? 'animate-spin' : '')} />
      </button>
      <button type="button"
        onClick={props.onDownloadZip}
        disabled={props.downloadingZip}
        class="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors disabled:opacity-50"
        title={t('downloadZip')}
      >
        <Show when={props.downloadingZip} fallback={<Icons.Archive class="w-5 h-5" />}>
          <Icons.Loader class="w-5 h-5 animate-spin" />
        </Show>
      </button>
      <Show when={props.downloadingZip}>
        <span class="text-xs text-zinc-400 tabular-nums">
          {formatFileSize(props.downloadedZipBytes)}
        </span>
      </Show>
    </div>
  );
}
