import type { ReactNode } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { Icons } from '../../lib/Icons';

type NavItem = 'store' | 'chat' | 'apps';

interface MobileBottomNavProps {
  activeItem?: NavItem;
  onNavigate: (item: NavItem) => void;
  onOpenMenu?: () => void;
  isMenuOpen?: boolean;
  menuControlsId?: string;
  className?: string;
}

export function MobileBottomNav({
  activeItem,
  onNavigate,
  onOpenMenu,
  isMenuOpen = false,
  menuControlsId,
  className = '',
}: MobileBottomNavProps) {
  const { t } = useI18n();

  const menuAriaLabel = t('openMenu');
  const menuLabel = t('menu');
  const navItems: { id: NavItem; icon: ReactNode; label: string }[] = [
    { id: 'apps', icon: <Icons.Grid className="w-5 h-5" />, label: t('apps') },
    { id: 'chat', icon: <Icons.MessageSquare className="w-5 h-5" />, label: t('chat') },
    { id: 'store', icon: <Icons.ShoppingBag className="w-5 h-5" />, label: t('store') },
  ];

  return (
    <nav
      aria-label={t('primaryNavigation')}
      className={`fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 supports-[backdrop-filter]:dark:bg-zinc-900/80 border-t border-zinc-200 dark:border-zinc-800 pb-[var(--spacing-safe-bottom)] h-[calc(var(--nav-height-mobile)+var(--spacing-safe-bottom))] ${className}`}
    >
      <div className="flex items-center justify-around h-[var(--nav-height-mobile)] px-1">
        {onOpenMenu && (
          <button
            className="flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-[44px] min-h-[44px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            onClick={onOpenMenu}
            aria-label={menuAriaLabel}
            aria-haspopup="dialog"
            aria-expanded={isMenuOpen}
            aria-controls={menuControlsId}
          >
            <Icons.Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">{menuLabel}</span>
          </button>
        )}
        {navItems.map((item) => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              className={`flex flex-col items-center justify-center gap-1 flex-1 h-full min-w-[44px] min-h-[44px] transition-colors ${
                isActive
                  ? 'text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export type { NavItem, MobileBottomNavProps };
