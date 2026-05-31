import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";

type NavItem = "store" | "chat" | "apps";

interface MobileBottomNavProps {
  activeItem?: NavItem;
  onNavigate: (item: NavItem) => void;
  onOpenMenu?: () => void;
  isMenuOpen?: boolean;
  menuControlsId?: string;
  className?: string;
}

export function MobileBottomNav(props: MobileBottomNavProps) {
  const { t } = useI18n();

  const menuAriaLabel = t("openMenu");
  const menuLabel = t("menu");
  const navItems: { id: NavItem; icon: JSX.Element; label: string }[] = [
    { id: "apps", icon: <Icons.Grid class="w-5 h-5" />, label: t("apps") },
    {
      id: "chat",
      icon: <Icons.MessageSquare class="w-5 h-5" />,
      label: t("chat"),
    },
    {
      id: "store",
      icon: <Icons.ShoppingBag class="w-5 h-5" />,
      label: t("store"),
    },
  ];

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
            class="flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-[44px] min-h-[44px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            onClick={props.onOpenMenu}
            aria-label={menuAriaLabel}
            aria-haspopup="dialog"
            aria-expanded={props.isMenuOpen ?? false}
            aria-controls={props.menuControlsId}
          >
            <Icons.Menu class="w-5 h-5" />
            <span class="text-[10px] font-medium">{menuLabel}</span>
          </button>
        </Show>
        <For each={navItems}>
          {(item) => {
            const isActive = () => props.activeItem === item.id;
            return (
              <button
                type="button"
                class={`flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-[44px] min-h-[44px] transition-colors ${
                  isActive()
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
                }`}
                onClick={() => props.onNavigate(item.id)}
                aria-label={item.label}
                aria-current={isActive() ? "page" : undefined}
              >
                {item.icon}
                <span class="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          }}
        </For>
      </div>
    </nav>
  );
}

export type { MobileBottomNavProps, NavItem };
