import { For, Show } from "solid-js";
import { formatDateTime, formatFileSize } from "../../lib/format.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { TranslationKey } from "../../store/i18n.ts";
import type { StorageFile } from "../../types/index.ts";
import type { ResolvedHandler } from "./storageUtils.tsx";
import { handlerDisplayName } from "./storageUtils.tsx";
import {
  activateDropdownMenuItem,
  handleDropdownMenuKeyDown,
} from "./storage-new-dropdown-menu.ts";

// ── Handler picker (shown when no default and multiple handlers) ──

export function StorageHandlerPicker(props: {
  file: StorageFile;
  downloadUrl: string | null;
  handlers: ResolvedHandler[];
  onSelect: (h: ResolvedHandler, asDefault: boolean) => void;
  onClose: () => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div class="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-3">
        <button
          type="button"
          onClick={props.onClose}
          class="min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={props.t("back")}
          aria-label={props.t("back")}
        >
          <Icons.ArrowLeft
            class="w-5 h-5 text-zinc-600 dark:text-zinc-400"
            aria-hidden="true"
          />
        </button>
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {props.file.name}
          </h2>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {props.file.path} &middot; {formatFileSize(props.file.size)}{" "}
            &middot; {formatDateTime(props.file.updated_at)}
          </p>
        </div>
      </div>

      {/* Picker */}
      <div class="flex-1 flex items-center justify-center p-8">
        <div class="w-full max-w-sm">
          <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4 text-center">
            {props.t("openWith")}
          </p>
          <div class="space-y-2">
            <For each={props.handlers}>
              {(h) => (
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => props.onSelect(h, false)}
                    class="min-h-[44px] flex-1 text-left px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <span class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {handlerDisplayName(h, props.t)}
                    </span>
                    <Show when={h.type === "local"}>
                      <span class="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
                        {props.t("included")}
                      </span>
                    </Show>
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onSelect(h, true)}
                    class="min-h-[44px] px-3 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-xs text-zinc-600 dark:text-zinc-300 hover:text-blue-700 dark:hover:text-blue-400 whitespace-nowrap"
                    title={props.t("setAsDefault")}
                  >
                    {props.t("setAsDefault")}
                  </button>
                </div>
              )}
            </For>
          </div>
          <Show when={props.downloadUrl}>
            {(url) => (
              <div class="mt-4 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    globalThis.open(
                      url(),
                      "_blank",
                      "noopener,noreferrer",
                    )}
                  leftIcon={<Icons.Download class="w-4 h-4" />}
                >
                  {props.t("download")}
                </Button>
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

// ── Handler dropdown menu ──

export function StorageHandlerDropdown(props: {
  menuRef?: (el: HTMLDivElement) => void;
  getTrigger?: () => HTMLElement | undefined;
  handlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  onSelect: (h: ResolvedHandler) => void;
  onSetDefault: (h: ResolvedHandler) => void;
  onClearDefault: () => void;
  onClose: () => void;
  t: (key: TranslationKey) => string;
}) {
  let menuEl: HTMLDivElement | undefined;

  return (
    <div
      ref={(el) => {
        menuEl = el;
        props.menuRef?.(el);
      }}
      data-handler-dropdown
      role="menu"
      aria-label={props.t("openWith")}
      class="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 z-20 min-w-[220px]"
      onKeyDown={(e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          props.onClose();
          props.getTrigger?.()?.focus();
          return;
        }
        handleDropdownMenuKeyDown(e, {
          getMenu: () => menuEl,
          getTrigger: () => props.getTrigger?.(),
          close: props.onClose,
        });
      }}
    >
      <div class="px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
        {props.t("openWith")}
      </div>
      <For each={props.handlers}>
        {(h) => {
          const isActive = () =>
            h.type === props.activeHandler.type &&
            (h.type === "local"
              ? h.localId === (props.activeHandler as typeof h).localId
              : h.handler.id === (props.activeHandler as typeof h).handler.id);
          const name = () => handlerDisplayName(h, props.t);
          return (
            <div class="flex items-center group">
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  activateDropdownMenuItem({
                    close: props.onClose,
                    getTrigger: () => props.getTrigger?.(),
                    action: () => props.onSelect(h),
                  })}
                class={"min-h-[44px] sm:min-h-0 flex-1 text-left px-3 py-2 text-sm transition-colors " +
                  (isActive()
                    ? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700")}
              >
                {name()}
                <Show when={h.type === "local"}>
                  <span class="ml-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {props.t("included")}
                  </span>
                </Show>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  activateDropdownMenuItem({
                    close: props.onClose,
                    getTrigger: () => props.getTrigger?.(),
                    action: () => props.onSetDefault(h),
                  })}
                class="inline-flex min-w-[44px] min-h-[44px] sm:min-w-8 sm:min-h-8 items-center justify-center text-xs text-zinc-600 dark:text-zinc-400 hover:text-blue-700 dark:hover:text-blue-300 opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                title={props.t("setAsDefault")}
                aria-label={`${props.t("setAsDefault")}: ${name()}`}
              >
                <Icons.Star class="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        }}
      </For>
      <div class="border-t border-zinc-200 dark:border-zinc-700 mt-1 pt-1">
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            activateDropdownMenuItem({
              close: props.onClose,
              getTrigger: () => props.getTrigger?.(),
              action: props.onClearDefault,
            })}
          class="min-h-[44px] sm:min-h-0 w-full text-left px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          {props.t("clearDefault")}
        </button>
      </div>
    </div>
  );
}
