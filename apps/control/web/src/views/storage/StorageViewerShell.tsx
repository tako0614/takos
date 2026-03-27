import { formatFileSize, formatDateTime } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';
import type { ResolvedHandler } from './storageUtils';
import { handlerDisplayName } from './storageUtils';
import { StorageHandlerDropdown } from './StorageHandlerPicker';

export function StorageViewerShell({
  file,
  downloadUrl,
  allHandlers,
  activeHandler,
  showHandlerMenu,
  setShowHandlerMenu,
  onSelectHandler,
  onClearDefault,
  onClose,
  t,
  extraButtons,
  children,
}: {
  file: StorageFile;
  downloadUrl: string | null;
  allHandlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  showHandlerMenu: boolean;
  setShowHandlerMenu: (v: boolean) => void;
  onSelectHandler: (h: ResolvedHandler, asDefault: boolean) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: string) => string;
  extraButtons?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasAlternatives = allHandlers.length > 1;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
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
        <div className="flex items-center gap-2 flex-shrink-0">
          {extraButtons}

          {/* Handler switcher */}
          {hasAlternatives && (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowHandlerMenu(!showHandlerMenu)}
              >
                {handlerDisplayName(activeHandler, t)}
                <Icons.ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              {showHandlerMenu && (
                <StorageHandlerDropdown
                  handlers={allHandlers}
                  activeHandler={activeHandler}
                  onSelect={(h) => onSelectHandler(h, false)}
                  onSetDefault={(h) => onSelectHandler(h, true)}
                  onClearDefault={onClearDefault}
                  onClose={() => setShowHandlerMenu(false)}
                  t={t}
                />
              )}
            </div>
          )}

          {downloadUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
              leftIcon={<Icons.Download className="w-4 h-4" />}
            >
              {t('download')}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
