import { onMount, onCleanup, Show } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import type { ContextMenuState } from './storageUtils';

interface StorageContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function StorageContextMenu(props: StorageContextMenuProps) {
  const { t } = useI18n();
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (ref && e.target instanceof Node && !ref.contains(e.target)) props.onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    onCleanup(() => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    });
  });

  const style = () => ({
    position: 'fixed' as const,
    left: `${props.state.x}px`,
    top: `${props.state.y}px`,
    'z-index': 50,
  });

  return (
    <div ref={ref} style={style()} class="w-52 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl py-1">
      <Show when={props.state.file.type === 'file'}>
        <button
          class="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          onClick={() => { props.onClose(); props.onOpen(); }}
        >
          <Icons.Eye class="w-4 h-4 text-zinc-400" />
          {t('open') || 'Open'}
        </button>
      </Show>
      <Show when={props.state.file.type === 'file'}>
        <button
          class="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          onClick={() => { props.onClose(); props.onDownload(); }}
        >
          <Icons.Download class="w-4 h-4 text-zinc-400" />
          {t('download')}
        </button>
      </Show>
      <div class="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
      <button
        class="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        onClick={() => { props.onClose(); props.onRename(); }}
      >
        <Icons.Edit class="w-4 h-4 text-zinc-400" />
        {t('rename')}
      </button>
      <button
        class="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        onClick={() => { props.onClose(); props.onDelete(); }}
      >
        <Icons.Trash class="w-4 h-4" />
        {t('delete')}
      </button>
    </div>
  );
}
