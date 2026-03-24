import { useRef, useEffect } from 'react';
import { useI18n } from '../../providers/I18nProvider';
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

export function StorageContextMenu({
  state,
  onClose,
  onOpen,
  onDownload,
  onRename,
  onDelete,
}: StorageContextMenuProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: state.x,
    top: state.y,
    zIndex: 50,
  };

  return (
    <div ref={ref} style={style} className="w-52 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl py-1">
      {state.file.type === 'file' && (
        <button
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          onClick={() => { onClose(); onOpen(); }}
        >
          <Icons.Eye className="w-4 h-4 text-zinc-400" />
          {t('open') || 'Open'}
        </button>
      )}
      {state.file.type === 'file' && (
        <button
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          onClick={() => { onClose(); onDownload(); }}
        >
          <Icons.Download className="w-4 h-4 text-zinc-400" />
          {t('download')}
        </button>
      )}
      <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
      <button
        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        onClick={() => { onClose(); onRename(); }}
      >
        <Icons.Edit className="w-4 h-4 text-zinc-400" />
        {t('rename')}
      </button>
      <button
        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        onClick={() => { onClose(); onDelete(); }}
      >
        <Icons.Trash className="w-4 h-4" />
        {t('delete')}
      </button>
    </div>
  );
}
