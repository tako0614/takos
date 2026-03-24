import { useRef, useId, useEffect, useCallback, type ReactNode, type TouchEvent } from 'react';
import { Icons } from '../../lib/Icons';
import { useDialogLifecycle } from '../../hooks/useDialogLifecycle';
import { useI18n } from '../../providers/I18nProvider';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  side?: 'left' | 'right';
  panelId?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
  );
}

function shouldRestoreFocus(previousFocusedElement: HTMLElement | null, currentContainer: HTMLElement): boolean {
  if (!previousFocusedElement || !document.contains(previousFocusedElement)) {
    return false;
  }
  const openDialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  ).filter((dialog) => dialog !== currentContainer);
  if (openDialogs.length === 0) {
    return true;
  }
  return openDialogs.some((dialog) => dialog.contains(previousFocusedElement));
}

export function MobileDrawer({
  isOpen,
  onClose,
  children,
  title,
  side = 'left',
  panelId,
}: MobileDrawerProps) {
  const { t } = useI18n();
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const layerId = useId();
  const startXRef = useRef<number>(0);
  const currentXRef = useRef<number>(0);

  const isTopLayer = useDialogLifecycle({
    isOpen,
    layerId,
    onEscape: onClose,
    closeOnEscape: true,
    lockBodyScroll: true,
  });

  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;

    const container = drawerRef.current;
    const previousFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = getFocusableElements(container);
    (focusableElements[0] ?? container).focus();

    const handleTabKey = (event: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (event.key !== 'Tab') return;
      const currentFocusable = getFocusableElements(container);
      if (currentFocusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || (active && !container.contains(active))) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || (active && !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTabKey);
    return () => {
      document.removeEventListener('keydown', handleTabKey);
      if (previousFocusedElement && shouldRestoreFocus(previousFocusedElement, container)) {
        previousFocusedElement.focus();
      }
    };
  }, [isOpen, isTopLayer]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    currentXRef.current = e.touches[0].clientX;
    const diff = currentXRef.current - startXRef.current;

    if (side === 'left' && diff < 0) {
      const translateX = Math.max(diff, -280);
      if (drawerRef.current) {
        drawerRef.current.style.transform = `translateX(${translateX}px)`;
      }
    } else if (side === 'right' && diff > 0) {
      const translateX = Math.min(diff, 280);
      if (drawerRef.current) {
        drawerRef.current.style.transform = `translateX(${translateX}px)`;
      }
    }
  }, [side]);

  const handleTouchEnd = useCallback(() => {
    const diff = currentXRef.current - startXRef.current;
    const threshold = 80;

    if ((side === 'left' && diff < -threshold) || (side === 'right' && diff > threshold)) {
      onClose();
    }

    if (drawerRef.current) {
      drawerRef.current.style.transform = '';
    }
  }, [side, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      <div
        id={panelId}
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : t('menu')}
        tabIndex={-1}
        className={`absolute top-0 bottom-0 w-[280px] max-w-[85vw] bg-white dark:bg-zinc-900 shadow-xl ${side === 'left' ? 'animate-slide-in-left' : 'animate-slide-in-right'} flex flex-col pt-[var(--spacing-safe-top)] ${
          side === 'left' ? 'left-0 pl-[var(--spacing-safe-left)]' : 'right-0 pr-[var(--spacing-safe-right)]'
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <h2 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            <button
              type="button"
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              onClick={onClose}
              aria-label={t('close')}
            >
              <Icons.X className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export type { MobileDrawerProps };
