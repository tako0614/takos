import { Show } from 'solid-js';
import { formatFileSize } from '../../lib/format.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import type { StorageFile } from '../../types/index.ts';

export function StorageEmptyState(props: {
  file: StorageFile;
  downloadUrl: string | null;
  t: (key: any) => string;
  label?: string;
}) {
  return (
    <div class="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400 gap-4">
      <Icons.File class="w-16 h-16 opacity-50" />
      <p class="text-lg font-medium">{props.label || props.file.name}</p>
      <p class="text-sm">{formatFileSize(props.file.size)} &middot; {props.file.mime_type || props.t('unknownType')}</p>
      <Show when={props.downloadUrl}>
        <Button
          variant="primary"
          onClick={() => window.open(props.downloadUrl!, '_blank', 'noopener,noreferrer')}
          leftIcon={<Icons.Download class="w-4 h-4" />}
        >
          {props.t('download')}
        </Button>
      </Show>
    </div>
  );
}
