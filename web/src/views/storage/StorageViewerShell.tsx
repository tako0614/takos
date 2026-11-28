import { createEffect, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { formatDateTime, formatFileSize } from "../../lib/format.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { TranslationKey } from "../../store/i18n.ts";
import type { StorageFile } from "../../types/index.ts";
import type { ResolvedHandler } from "./storageUtils.tsx";
import { handlerDisplayName } from "./storageUtils.tsx";
import { StorageHandlerDropdown } from "./StorageHandlerPicker.tsx";
import {
  focusDropdownMenuItem,
  handleMenuTriggerKeyDown,
  type MenuFocusTarget,
  shouldCloseOnFocusOut,
} from "./storage-new-dropdown-menu.ts";

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
  t: (key: TranslationKey) => string;
  extraButtons?: JSX.Element;
  children: JSX.Element;
}) {
  const hasAlternatives = () => props.allHandlers.length > 1;
  let handlerContainerRef: HTMLDivElement | undefined;
  let handlerTriggerRef: HTMLButtonElement | undefined;
  let handlerMenuRef: HTMLDivElement | undefined;
  let pendingFocusTarget: MenuFocusTarget | null = null;
  let pointerDownInside = false;

  const openMenuWithTarget = (target: MenuFocusTarget) => {
    pendingFocusTarget = target;
    props.setShowHandlerMenu(true);
  };

  createEffect(() => {
    if (!props.showHandlerMenu) return;
    if (pendingFocusTarget) {
      const target = pendingFocusTarget;
      pendingFocusTarget = null;
      queueMicrotask(() => focusDropdownMenuItem(handlerMenuRef, target));
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (
        handlerContainerRef &&
        e.target instanceof Node &&
        handlerContainerRef.contains(e.target)
      ) {
        pointerDownInside = true;
      } else {
        pointerDownInside = false;
        props.setShowHandlerMenu(false);
      }
    };
    const clearPointer = () => {
      pointerDownInside = false;
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        props.setShowHandlerMenu(false);
        handlerTriggerRef?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", clearPointer);
    document.addEventListener("pointercancel", clearPointer);
    document.addEventListener("keydown", handleEscape);
    onCleanup(() => {
      pointerDownInside = false;
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", clearPointer);
      document.removeEventListener("pointercancel", clearPointer);
      document.removeEventListener("keydown", handleEscape);
    });
  });

  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      {/* Header */}
      <div class="flex-shrink-0 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
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
        <div class="flex items-center gap-2 flex-shrink-0">
          {props.extraButtons}

          {/* Handler switcher */}
          <Show when={hasAlternatives()}>
            <div
              ref={handlerContainerRef}
              class="relative"
              onFocusOut={(e) => {
                if (
                  props.showHandlerMenu &&
                  shouldCloseOnFocusOut(
                    e,
                    handlerContainerRef,
                    pointerDownInside,
                  )
                ) {
                  props.setShowHandlerMenu(false);
                }
              }}
            >
              <Button
                ref={(el) => {
                  handlerTriggerRef = el;
                }}
                variant="secondary"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={props.showHandlerMenu}
                onClick={(e) => {
                  if (props.showHandlerMenu) {
                    props.setShowHandlerMenu(false);
                  } else if (e.detail === 0) {
                    openMenuWithTarget("first");
                  } else {
                    props.setShowHandlerMenu(true);
                  }
                }}
                onKeyDown={(e) => {
                  handleMenuTriggerKeyDown(e, {
                    isOpen: props.showHandlerMenu,
                    getMenu: () => handlerMenuRef,
                    openWithTarget: openMenuWithTarget,
                  });
                }}
              >
                {handlerDisplayName(props.activeHandler, props.t)}
                <Icons.ChevronDown class="w-3 h-3 ml-1" aria-hidden="true" />
              </Button>
              <Show when={props.showHandlerMenu}>
                <StorageHandlerDropdown
                  menuRef={(el) => {
                    handlerMenuRef = el;
                  }}
                  getTrigger={() => handlerTriggerRef}
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
            {(url) => (
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
            )}
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
