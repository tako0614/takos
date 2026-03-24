import { Icons } from '../../lib/Icons';
import { useMobileHeader } from '../../contexts/MobileHeaderContext';

interface MobileHeaderProps {
  onOpenMenu: () => void;
  isMenuOpen: boolean;
  menuControlsId?: string;
  menuAriaLabel: string;
}

export function MobileHeader({ onOpenMenu, isMenuOpen, menuControlsId, menuAriaLabel }: MobileHeaderProps) {
  const { headerContent } = useMobileHeader();

  return (
    <div className="fixed top-0 left-0 right-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 supports-[backdrop-filter]:dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 flex items-end"
      style={{ paddingTop: 'var(--spacing-safe-top, 0px)', height: 'calc(48px + var(--spacing-safe-top, 0px))' }}
    >
      <div className="flex items-center w-full h-12 px-2 gap-1">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
          onClick={onOpenMenu}
          aria-label={menuAriaLabel}
          aria-haspopup="dialog"
          aria-expanded={isMenuOpen}
          aria-controls={menuControlsId}
        >
          <Icons.Menu className="w-5 h-5" />
        </button>
        {headerContent && (
          <div className="flex items-center min-w-0">
            {headerContent}
          </div>
        )}
      </div>
    </div>
  );
}
