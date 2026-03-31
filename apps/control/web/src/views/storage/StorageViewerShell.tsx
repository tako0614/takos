import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { formatFileSize, formatDateTime } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';
import type { ResolvedHandler } from './storageUtils';
import { handlerDisplayName } from './storageUtils';
import { StorageHandlerDropdown } from './StorageHandlerPicker';

export function StorageViewerShell(props: {
  file: StorageFile;
  downloadUrl: string | null;
  allHandlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  showHandlerMenu: boolean;
  setShowHandlerMenu: (v: boolean) => void;
  onSelectHandler: (h: ResolvedHandler, asDefault: boolean) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: any) => string;
  extraButtons?: JSX.Element;
  children: JSX.Element;
}) {
  const hasAlternatives = () => props.allHandlers.length > 1;

  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div class="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <button
            onClick={props.onClose}
            class="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={props.t('back')}
          >
            <Icons.ArrowLeft class="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <div class="min-w-0">
            <h2 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {props.file.name}
            </h2>
            <p class="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {props.file.path} &middot; {formatFileSize(props.file.size)} &middot; {formatDateTime(props.file.updated_at)}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          {props.extraButtons}

          {/* Handler switcher */}
          <Show when={hasAlternatives()}>
            <div class="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => props.setShowHandlerMenu(!props.showHandlerMenu)}
              >
                {handlerDisplayName(props.activeHandler, props.t)}
                <Icons.ChevronDown class="w-3 h-3 ml-1" />
              </Button>
              <Show when={props.showHandlerMenu}>
                <StorageHandlerDropdown
                  handlers={props.allHandlers}
                  activeHandler={props.activeHandler}
                  onSelect={(h) => props.onSelectHandler(h, false)}
                  onSetDefault={(h) => props.onSelectHandler(h, true)}
                  onClearDefault={props.onClearDefault}
                  onClose={() => props.setShowHandlerMenu(false)}
                  t={props.t}
                />
              </Show>
            </div>
          </Show>

          <Show when={props.downloadUrl}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(props.downloadUrl!, '_blank', 'noopener,noreferrer')}
              leftIcon={<Icons.Download class="w-4 h-4" />}
            >
              {props.t('download')}
            </Button>
          </Show>
        </div>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-hidden">
        {props.children}
      </div>
    </div>
  );
}
