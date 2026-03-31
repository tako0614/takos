import { createEffect, createUniqueId, onCleanup, splitProps, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useDialogLifecycle } from '../../hooks/useDialogLifecycle';
import { useI18n } from '../../store/i18n';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  size?: ModalSize;
  title?: string;
  descriptionId?: string;
  children: JSX.Element;
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

export function Modal(props: ModalProps) {
  const [local] = splitProps(props, [
    'isOpen', 'onClose', 'size', 'title', 'descriptionId', 'children',
    'showCloseButton', 'closeOnOverlayClick', 'closeOnEscape', 'mobileFullScreen',
  ]);

  const { t } = useI18n();
  const breakpoint = useBreakpoint();
  let modalRef: HTMLDivElement | undefined;
  const titleId = createUniqueId();
  const layerId = createUniqueId();

  const size = () => local.size ?? 'md';
  const showCloseButton = () => local.showCloseButton ?? true;
  const closeOnOverlayClick = () => local.closeOnOverlayClick ?? true;
  const closeOnEscape = () => local.closeOnEscape ?? true;
  const mobileFullScreen = () => local.mobileFullScreen ?? true;
  const shouldBeFullScreen = () => mobileFullScreen() && breakpoint.isMobile && size() !== 'full';

  const isTopLayer = useDialogLifecycle({
    get isOpen() { return local.isOpen; },
    layerId,
    get onEscape() { return local.onClose; },
    get closeOnEscape() { return closeOnEscape(); },
    lockBodyScroll: true,
  });

  createEffect(() => {
    if (!local.isOpen || !modalRef) return;

    const container = modalRef;
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
    onCleanup(() => {
      document.removeEventListener('keydown', handleTabKey);
      if (previousFocusedElement && shouldRestoreFocus(previousFocusedElement, container)) {
        previousFocusedElement.focus();
      }
    });
  });

  return (
    <Show when={local.isOpen}>
      <div
        class={`fixed inset-0 z-50 flex justify-center bg-black/50 ${
          shouldBeFullScreen() ? 'items-end p-0' : 'items-center p-4'
        }`}
        onClick={closeOnOverlayClick() ? local.onClose : undefined}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={local.title ? titleId : undefined}
          aria-describedby={local.descriptionId}
          aria-label={local.title ? undefined : t('dialog')}
          tabIndex={-1}
          class={`
            bg-[var(--color-surface-primary)] shadow-[var(--shadow-lg)] w-full flex flex-col overflow-hidden
            ${shouldBeFullScreen()
              ? 'rounded-t-2xl max-h-[90dvh] animate-slide-in-bottom pb-[var(--spacing-safe-bottom)]'
              : `${sizeClasses[size()]} ${size() === 'full' ? 'rounded-none max-h-full' : 'rounded-[var(--radius-lg)] max-h-[90dvh]'}`
            }
          `}
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={local.title || showCloseButton()}>
            <div class={`flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-primary)] ${shouldBeFullScreen() ? 'min-h-[56px]' : ''}`}>
              <Show when={local.title}>
                <h2 id={titleId} class="text-lg font-semibold text-[var(--color-text-primary)] m-0">
                  {local.title}
                </h2>
              </Show>
              <Show when={showCloseButton()}>
                <button
                  type="button"
                  class="p-2 min-w-[44px] min-h-[44px] bg-transparent border-none rounded-[var(--radius-sm)] cursor-pointer text-[var(--color-text-tertiary)] flex items-center justify-center transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
                  onClick={local.onClose}
                  aria-label={t('close')}
                >
                  <CloseIcon />
                </button>
              </Show>
            </div>
          </Show>
          <div class="p-6 overflow-y-auto flex-1 text-[var(--color-text-primary)]">
            {local.children}
          </div>
        </div>
      </div>
    </Show>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

interface ModalFooterProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function ModalFooter(props: ModalFooterProps) {
  const [local, rest] = splitProps(props, ['children', 'class']);

  return (
    <div
      class={`flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border-primary)] bg-[var(--color-surface-secondary)] ${local.class ?? ''}`}
      {...rest}
    >
      {local.children}
    </div>
  );
}
