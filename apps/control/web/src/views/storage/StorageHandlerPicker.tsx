import { onMount, onCleanup, For, Show } from 'solid-js';
import { formatFileSize, formatDateTime } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';
import type { ResolvedHandler } from './storageUtils';
import { handlerDisplayName } from './storageUtils';

// ── Handler picker (shown when no default and multiple handlers) ──

export function StorageHandlerPicker(props: {
  file: StorageFile;
  downloadUrl: string | null;
  handlers: ResolvedHandler[];
  onSelect: (h: ResolvedHandler, asDefault: boolean) => void;
  onClose: () => void;
  t: (key: any) => string;
}) {
  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div class="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
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

      {/* Picker */}
      <div class="flex-1 flex items-center justify-center p-8">
        <div class="w-full max-w-sm">
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4 text-center">
            {props.t('openWith') || 'Open with...'}
          </p>
          <div class="space-y-2">
            <For each={props.handlers}>{(h) => (
              <div class="flex items-center gap-2">
                <button
                  onClick={() => props.onSelect(h, false)}
                  class="flex-1 text-left px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {handlerDisplayName(h, props.t)}
                  </span>
                  <Show when={h.type === 'builtin'}>
                    <span class="ml-2 text-xs text-zinc-400">{props.t('builtin') || 'Built-in'}</span>
                  </Show>
                </button>
                <button
                  onClick={() => props.onSelect(h, true)}
                  class="px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap"
                  title={props.t('setAsDefault') || 'Set as default'}
                >
                  {props.t('setAsDefault') || 'Set as default'}
                </button>
              </div>
            )}</For>
          </div>
          <Show when={props.downloadUrl}>
            <div class="mt-4 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(props.downloadUrl!, '_blank', 'noopener,noreferrer')}
                leftIcon={<Icons.Download class="w-4 h-4" />}
              >
                {props.t('download')}
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ── Handler dropdown menu ──

export function StorageHandlerDropdown(props: {
  handlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  onSelect: (h: ResolvedHandler) => void;
  onSetDefault: (h: ResolvedHandler) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: any) => string;
}) {
  onMount(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-handler-dropdown]')) props.onClose();
    };
    document.addEventListener('click', handler, true);
    onCleanup(() => document.removeEventListener('click', handler, true));
  });

  return (
    <div
      data-handler-dropdown
      class="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-20 min-w-[220px]"
    >
      <div class="px-3 py-1.5 text-xs text-zinc-400 uppercase tracking-wider">
        {props.t('openWith') || 'Open with'}
      </div>
      <For each={props.handlers}>{(h) => {
        const isActive = () => h.type === props.activeHandler.type &&
          (h.type === 'builtin'
            ? h.builtinId === (props.activeHandler as typeof h).builtinId
            : h.handler.id === (props.activeHandler as typeof h).handler.id);
        return (
          <div class="flex items-center group">
            <button
              onClick={() => props.onSelect(h)}
              class={
                'flex-1 text-left px-3 py-2 text-sm transition-colors ' +
                (isActive()
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700')
              }
            >
              {handlerDisplayName(h, props.t)}
              <Show when={h.type === 'builtin'}>
                <span class="ml-1 text-xs text-zinc-400">{props.t('builtin') || 'Built-in'}</span>
              </Show>
            </button>
            <button
              onClick={() => props.onSetDefault(h)}
              class="px-2 py-2 text-xs text-zinc-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title={props.t('setAsDefault') || 'Set as default'}
            >
              <Icons.Star class="w-3.5 h-3.5" />
            </button>
          </div>
        );
      }}</For>
      <div class="border-t border-zinc-200 dark:border-zinc-700 mt-1 pt-1">
        <button
          onClick={props.onClearDefault}
          class="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          {props.t('clearDefault') || 'Clear default'}
        </button>
      </div>
    </div>
  );
}
