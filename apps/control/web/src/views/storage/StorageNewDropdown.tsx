import { createSignal, onCleanup, createEffect, Show } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';

interface StorageNewDropdownProps {
  onNewFolder: () => void;
  onUpload: () => void;
}

export function StorageNewDropdown(props: StorageNewDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;

  createEffect(() => {
    if (!open()) return;
    const handler = (e: MouseEvent) => {
      if (ref && e.target instanceof Node && !ref.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  return (
    <div class="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open())}
        class="flex items-center gap-2 h-10 pl-4 pr-5 rounded-2xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-shadow text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        <Icons.Plus class="w-5 h-5" />
        {t('new') || 'New'}
      </button>
      <Show when={open()}>
        <div class="absolute top-full left-0 mt-1 w-48 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg py-1 z-30">
          <button
            class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => { setOpen(false); props.onNewFolder(); }}
          >
            <Icons.FolderPlus class="w-4 h-4 text-zinc-500" />
            {t('newFolder')}
          </button>
          <div class="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
          <button
            class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => { setOpen(false); props.onUpload(); }}
          >
            <Icons.Upload class="w-4 h-4 text-zinc-500" />
            {t('upload')}
          </button>
        </div>
      </Show>
    </div>
  );
}
