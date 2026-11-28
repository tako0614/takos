import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import {
  activateDropdownMenuItem,
  focusDropdownMenuItem,
  handleDropdownMenuKeyDown,
  handleMenuTriggerKeyDown,
  type MenuFocusTarget,
  shouldCloseOnFocusOut,
} from "../../views/storage/storage-new-dropdown-menu.ts";
import { useSidebarCallbacks } from "./SidebarContext.tsx";
import type { User } from "../../types/index.ts";

const ROW_BASE =
  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors min-h-[44px] md:min-h-[36px]";
const ROW_DEFAULT =
  `${ROW_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;

const PROFILE_MENU_BTN =
  "flex items-center gap-2 w-full px-4 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors min-h-[44px] md:min-h-[36px]";

interface ProfileMenuProps {
  user: User | null;
}

export function ProfileMenu(props: ProfileMenuProps) {
  const { t } = useI18n();
  const { onOpenSettings, onLogout } = useSidebarCallbacks();
  const [showProfileMenu, setShowProfileMenu] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let pendingFocusTarget: MenuFocusTarget | null = null;
  let pointerDownInside = false;

  const closeMenu = () => {
    pendingFocusTarget = null;
    setShowProfileMenu(false);
  };

  const openMenu = (focusTarget: MenuFocusTarget | null = null) => {
    pendingFocusTarget = focusTarget;
    setShowProfileMenu(true);
  };

  createEffect(() => {
    if (!showProfileMenu()) return;
    if (pendingFocusTarget) {
      const target = pendingFocusTarget;
      pendingFocusTarget = null;
      queueMicrotask(() => focusDropdownMenuItem(menuRef, target));
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (
        containerRef &&
        e.target instanceof Node &&
        containerRef.contains(e.target)
      ) {
        pointerDownInside = true;
      } else {
        pointerDownInside = false;
        closeMenu();
      }
    };
    const clearPointer = () => {
      pointerDownInside = false;
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        triggerRef?.focus();
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
    <div
      ref={containerRef}
      class="relative unified-profile-menu"
      onKeyDown={(e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (showProfileMenu() && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
          triggerRef?.focus();
        }
      }}
      onFocusOut={(e) => {
        if (
          showProfileMenu() &&
          shouldCloseOnFocusOut(e, containerRef, pointerDownInside)
        ) {
          closeMenu();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        class={ROW_DEFAULT}
        onClick={(e) => {
          e.stopPropagation();
          if (showProfileMenu()) closeMenu();
          else openMenu(e.detail === 0 ? "first" : null);
        }}
        onKeyDown={(e) => {
          handleMenuTriggerKeyDown(e, {
            isOpen: showProfileMenu(),
            getMenu: () => menuRef,
            openWithTarget: (target) => openMenu(target),
          });
        }}
        aria-label={t("profileMenu")}
        aria-expanded={showProfileMenu()}
        aria-haspopup="menu"
      >
        <Show
          when={props.user?.picture}
          fallback={
            <div class="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 text-xs font-semibold shrink-0">
              {props.user?.name?.charAt(0).toUpperCase()}
            </div>
          }
        >
          {(picture) => (
            <img
              src={picture()}
              alt=""
              class="w-5 h-5 rounded-full object-cover shrink-0"
            />
          )}
        </Show>
        <span class="truncate min-w-0 text-zinc-700 dark:text-zinc-300">
          {props.user?.username
            ? `@${props.user.username}`
            : props.user?.name || props.user?.email || "-"}
        </span>
      </button>

      <Show when={showProfileMenu()}>
        <div
          ref={menuRef}
          class="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-xl shadow-xl overflow-hidden z-50"
          onClick={(e) => e.stopPropagation()}
          role="menu"
          aria-label={t("profileMenu")}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeMenu();
              triggerRef?.focus();
              return;
            }
            handleDropdownMenuKeyDown(e, {
              getMenu: () => menuRef,
              getTrigger: () => triggerRef,
              close: closeMenu,
            });
          }}
        >
          <div class="px-4 py-2 border-b border-zinc-100 dark:border-zinc-700">
            <span class="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {props.user?.username ? `@${props.user.username}` : "-"}
            </span>
            <Show when={props.user?.name}>
              {(name) => (
                <span class="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {name()}
                </span>
              )}
            </Show>
            <Show when={props.user?.email}>
              {(email) => (
                <span class="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {email()}
                </span>
              )}
            </Show>
          </div>
          <button
            type="button"
            class={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() =>
              activateDropdownMenuItem({
                close: closeMenu,
                getTrigger: () => triggerRef,
                action: onOpenSettings,
              })}
          >
            <Icons.Settings class="w-4 h-4" aria-hidden="true" />
            <span>{t("accountSettings")}</span>
          </button>
          <a
            href="/terms"
            class={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() => closeMenu()}
            onKeyDown={(e) => {
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === " ") {
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
          >
            <Icons.FileText class="w-4 h-4" aria-hidden="true" />
            <span>{t("legalInfo")}</span>
          </a>
          <button
            type="button"
            class={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() =>
              activateDropdownMenuItem({
                close: closeMenu,
                getTrigger: () => triggerRef,
                action: onLogout,
              })}
          >
            <Icons.X class="w-4 h-4" aria-hidden="true" />
            <span>{t("logout")}</span>
          </button>
        </div>
      </Show>
    </div>
  );
}
