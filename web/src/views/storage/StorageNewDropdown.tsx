import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";

interface StorageNewDropdownProps {
  onNewFolder: () => void;
  onUpload: () => void;
}

export function StorageNewDropdown(props: StorageNewDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  let ref: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const menuItems = () =>
    menuRef
      ? Array.from(menuRef.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      : [];

  createEffect(() => {
    if (!open()) return;
    const handleOutside = (e: PointerEvent) => {
      if (ref && e.target instanceof Node && !ref.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef?.focus();
      }
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    });
  });

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

  return (
    <div class="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
        class="flex items-center gap-2 min-h-[44px] md:min-h-0 md:h-10 pl-4 pr-5 rounded-2xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-shadow text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        <Icons.Plus class="w-5 h-5" aria-hidden="true" />
        {t("new")}
      </button>
      <Show when={open()}>
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("new")}
          onKeyDown={handleMenuKeyDown}
          class="absolute top-full left-0 mt-1 w-48 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg py-1 z-30"
        >
          <button
            type="button"
            role="menuitem"
            class="w-full min-h-[44px] flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => {
              setOpen(false);
              props.onNewFolder();
            }}
          >
            <Icons.FolderPlus
              class="w-4 h-4 text-zinc-500 dark:text-zinc-400"
              aria-hidden="true"
            />
            {t("newFolder")}
          </button>
          <div class="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
          <button
            type="button"
            role="menuitem"
            class="w-full min-h-[44px] flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => {
              setOpen(false);
              props.onUpload();
            }}
          >
            <Icons.Upload
              class="w-4 h-4 text-zinc-500 dark:text-zinc-400"
              aria-hidden="true"
            />
            {t("upload")}
          </button>
        </div>
      </Show>
    </div>
  );
}
