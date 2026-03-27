import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';

interface StorageNewDropdownProps {
  onNewFolder: () => void;
  onUpload: () => void;
}

export function StorageNewDropdown({ onNewFolder, onUpload }: StorageNewDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-10 pl-4 pr-5 rounded-2xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-shadow text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        <Icons.Plus className="w-5 h-5" />
        {t('new') || 'New'}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg py-1 z-30">
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => { setOpen(false); onNewFolder(); }}
          >
            <Icons.FolderPlus className="w-4 h-4 text-zinc-500" />
            {t('newFolder')}
          </button>
          <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => { setOpen(false); onUpload(); }}
          >
            <Icons.Upload className="w-4 h-4 text-zinc-500" />
            {t('upload')}
          </button>
        </div>
      )}
    </div>
  );
}
