import { onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { ContextMenuState } from "./storageUtils.tsx";

interface StorageContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const MENU_WIDTH = 208;
const MENU_MAX_HEIGHT = 240;

export function StorageContextMenu(props: StorageContextMenuProps) {
  const { t } = useI18n();
  let ref: HTMLDivElement | undefined;

  const menuItems = () =>
    ref
      ? Array.from(ref.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      : [];

  onMount(() => {
    // Move focus into the menu so keyboard users (who opened it via the
    // focusable trigger) can operate it and Escape returns control.
    menuItems()[0]?.focus();

    const handler = (e: MouseEvent) => {
      if (ref && e.target instanceof Node && !ref.contains(e.target)) {
        props.onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    onCleanup(() => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    });
  });

  // Roving focus across menu items with the arrow / Home / End keys.
  const handleMenuKeyDown = (e: KeyboardEvent) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const items = menuItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else next = items.length - 1;
    e.preventDefault();
    items[next]?.focus();
  };

  // Keep the menu inside the viewport instead of overflowing off the right or
  // bottom edge (common when triggered near a screen edge).
  const style = () => {
    const maxLeft = globalThis.innerWidth - MENU_WIDTH - 8;
    const maxTop = globalThis.innerHeight - MENU_MAX_HEIGHT - 8;
    return {
      position: "fixed" as const,
      left: `${Math.max(8, Math.min(props.state.x, maxLeft))}px`,
      top: `${Math.max(8, Math.min(props.state.y, maxTop))}px`,
      "z-index": 50,
    };
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("moreActions")}
      style={style()}
      onKeyDown={handleMenuKeyDown}
      class="w-52 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl py-1"
    >
      <Show when={props.state.file.type === "file"}>
        <button
          type="button"
          role="menuitem"
          class="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          onClick={() => {
            props.onClose();
            props.onOpen();
          }}
        >
          <Icons.Eye class="w-4 h-4 text-zinc-400" />
          {t("open")}
        </button>
      </Show>
      <Show when={props.state.file.type === "file"}>
        <button
          type="button"
          role="menuitem"
          class="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          onClick={() => {
            props.onClose();
            props.onDownload();
          }}
        >
          <Icons.Download class="w-4 h-4 text-zinc-400" />
          {t("download")}
        </button>
      </Show>
      <div class="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
      <button
        type="button"
        role="menuitem"
        class="w-full flex items-center gap-3 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        onClick={() => {
          props.onClose();
          props.onRename();
        }}
      >
        <Icons.Edit class="w-4 h-4 text-zinc-400" />
        {t("rename")}
      </button>
      <button
        type="button"
        role="menuitem"
        class="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        onClick={() => {
          props.onClose();
          props.onDelete();
        }}
      >
        <Icons.Trash class="w-4 h-4" />
        {t("delete")}
      </button>
    </div>
  );
}
