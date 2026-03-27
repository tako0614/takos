import { useEffect } from 'react';
import { formatFileSize, formatDateTime } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';
import type { ResolvedHandler } from './storageUtils';
import { handlerDisplayName } from './storageUtils';

// ── Handler picker (shown when no default and multiple handlers) ──

export function StorageHandlerPicker({
  file,
  downloadUrl,
  handlers,
  onSelect,
  onClose,
  t,
}: {
  file: StorageFile;
  downloadUrl: string | null;
  handlers: ResolvedHandler[];
  onSelect: (h: ResolvedHandler, asDefault: boolean) => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('back')}
        >
          <Icons.ArrowLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
        </button>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {file.name}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {file.path} &middot; {formatFileSize(file.size)} &middot; {formatDateTime(file.updated_at)}
          </p>
        </div>
      </div>

      {/* Picker */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4 text-center">
            {t('openWith') || 'Open with...'}
          </p>
          <div className="space-y-2">
            {handlers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  onClick={() => onSelect(h, false)}
                  className="flex-1 text-left px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {handlerDisplayName(h, t)}
                  </span>
                  {h.type === 'builtin' && (
                    <span className="ml-2 text-xs text-zinc-400">{t('builtin') || 'Built-in'}</span>
                  )}
                </button>
                <button
                  onClick={() => onSelect(h, true)}
                  className="px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap"
                  title={t('setAsDefault') || 'Set as default'}
                >
                  {t('setAsDefault') || 'Set as default'}
                </button>
              </div>
            ))}
          </div>
          {downloadUrl && (
            <div className="mt-4 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
                leftIcon={<Icons.Download className="w-4 h-4" />}
              >
                {t('download')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Handler dropdown menu ──

export function StorageHandlerDropdown({
  handlers,
  activeHandler,
  onSelect,
  onSetDefault,
  onClearDefault,
  onClose,
  t,
}: {
  handlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  onSelect: (h: ResolvedHandler) => void;
  onSetDefault: (h: ResolvedHandler) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-handler-dropdown]')) onClose();
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [onClose]);

  return (
    <div
      data-handler-dropdown
      className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-20 min-w-[220px]"
    >
      <div className="px-3 py-1.5 text-xs text-zinc-400 uppercase tracking-wider">
        {t('openWith') || 'Open with'}
      </div>
      {handlers.map((h, i) => {
        const isActive = h.type === activeHandler.type &&
          (h.type === 'builtin'
            ? h.builtinId === (activeHandler as typeof h).builtinId
            : h.handler.id === (activeHandler as typeof h).handler.id);
        return (
          <div key={i} className="flex items-center group">
            <button
              onClick={() => onSelect(h)}
              className={
                'flex-1 text-left px-3 py-2 text-sm transition-colors ' +
                (isActive
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700')
              }
            >
              {handlerDisplayName(h, t)}
              {h.type === 'builtin' && (
                <span className="ml-1 text-xs text-zinc-400">{t('builtin') || 'Built-in'}</span>
              )}
            </button>
            <button
              onClick={() => onSetDefault(h)}
              className="px-2 py-2 text-xs text-zinc-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title={t('setAsDefault') || 'Set as default'}
            >
              <Icons.Star className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      <div className="border-t border-zinc-200 dark:border-zinc-700 mt-1 pt-1">
        <button
          onClick={onClearDefault}
          className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          {t('clearDefault') || 'Clear default'}
        </button>
      </div>
    </div>
  );
}
