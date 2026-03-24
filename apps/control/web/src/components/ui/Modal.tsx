import { useEffect, useId, useRef, type ReactNode, type HTMLAttributes } from 'react';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useDialogLifecycle } from '../../hooks/useDialogLifecycle';
import { useI18n } from '../../providers/I18nProvider';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  size?: ModalSize;
  title?: string;
  descriptionId?: string;
  children: ReactNode;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  mobileFullScreen?: boolean;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-full',
};

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

export function Modal({
  isOpen,
  onClose,
  size = 'md',
  title,
  descriptionId,
  children,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  mobileFullScreen = true,
}: ModalProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const shouldBeFullScreen = mobileFullScreen && isMobile && size !== 'full';
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const layerId = useId();

  const isTopLayer = useDialogLifecycle({
    isOpen,
    layerId,
    onEscape: onClose,
    closeOnEscape,
    lockBodyScroll: true,
  });

  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const container = modalRef.current;
    const previousFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const autoFocusElement = container.querySelector<HTMLElement>('[autofocus], [data-autofocus="true"]');
    const focusableElements = getFocusableElements(container);
    (autoFocusElement ?? focusableElements[0] ?? container).focus();

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

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/50 ${
        shouldBeFullScreen ? 'items-end p-0' : 'items-center p-4'
      }`}
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={descriptionId}
        aria-label={title ? undefined : t('dialog')}
        tabIndex={-1}
        className={`
          bg-[var(--color-surface-primary)] shadow-[var(--shadow-lg)] w-full flex flex-col overflow-hidden
          ${shouldBeFullScreen
            ? 'rounded-t-2xl max-h-[90dvh] animate-slide-in-bottom pb-[var(--spacing-safe-bottom)]'
            : `${sizeClasses[size]} ${size === 'full' ? 'rounded-none max-h-full' : 'rounded-[var(--radius-lg)] max-h-[90dvh]'}`
          }
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className={`flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-primary)] ${shouldBeFullScreen ? 'min-h-[56px]' : ''}`}>
            {title && (
              <h2 id={titleId} className="text-lg font-semibold text-[var(--color-text-primary)] m-0">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                className="p-2 min-w-[44px] min-h-[44px] bg-transparent border-none rounded-[var(--radius-sm)] cursor-pointer text-[var(--color-text-tertiary)] flex items-center justify-center transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
                onClick={onClose}
                aria-label={t('close')}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        )}
        <div className="p-6 overflow-y-auto flex-1 text-[var(--color-text-primary)]">
          {children}
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function ModalFooter({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
