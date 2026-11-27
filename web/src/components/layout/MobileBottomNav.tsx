import { createMemo, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { type TranslationKey, useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";

type NavItem = "chat" | "memory";

interface MobileBottomNavProps {
  activeItem?: NavItem;
  onNavigate: (item: NavItem) => void;
  onOpenMenu?: () => void;
  isMenuOpen?: boolean;
  menuControlsId?: string;
  className?: string;
}

const NAV_ITEM_CONFIG: {
  id: NavItem;
  Icon: Component<{ class?: string }>;
  labelKey: TranslationKey;
}[] = [
  {
    id: "chat",
    Icon: Icons.MessageSquare,
    labelKey: "chat",
  },
  {
    id: "memory",
    Icon: Icons.Database,
    labelKey: "memory",
  },
];

export function MobileBottomNav(props: MobileBottomNavProps) {
  const { t } = useI18n();

  const menuAriaLabel = createMemo(() => t("openMenu"));
  const menuLabel = createMemo(() => t("menu"));

  return (
    <nav
      aria-label={t("primaryNavigation")}
      class={`fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 supports-[backdrop-filter]:dark:bg-zinc-900/80 border-t border-zinc-200 dark:border-zinc-800 pb-[var(--spacing-safe-bottom)] h-[calc(var(--nav-height-mobile)+var(--spacing-safe-bottom))] ${
        props.className ?? ""
      }`}
    >
      <div class="flex items-center justify-around h-[var(--nav-height-mobile)] px-1">
        <Show when={props.onOpenMenu}>
          <button
            type="button"
            class="flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-[44px] min-h-[44px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            onClick={props.onOpenMenu}
            aria-label={menuAriaLabel()}
            aria-haspopup="dialog"
            aria-expanded={props.isMenuOpen ?? false}
            aria-controls={props.menuControlsId}
          >
            <Icons.Menu class="w-5 h-5" />
            <span class="text-[10px] font-medium">{menuLabel()}</span>
          </button>
        </Show>
        <For each={NAV_ITEM_CONFIG}>
          {(item) => {
            const isActive = () => props.activeItem === item.id;
            const label = () => t(item.labelKey);
            return (
              <button
                type="button"
                class={`flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-[44px] min-h-[44px] transition-colors ${
                  isActive()
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                }`}
                onClick={() => props.onNavigate(item.id)}
                aria-label={label()}
                aria-current={isActive() ? "page" : undefined}
              >
                <item.Icon class="w-5 h-5" />
                <span class="text-[10px] font-medium">{label()}</span>
              </button>
            );
          }}
        </For>
      </div>
    </nav>
  );
}

export type { MobileBottomNavProps, NavItem };
