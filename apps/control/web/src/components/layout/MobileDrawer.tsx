import { createEffect, createUniqueId, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useDialogLifecycle } from "../../hooks/useDialogLifecycle.ts";
import { useI18n } from "../../store/i18n.ts";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: JSX.Element;
  title?: string;
  side?: "left" | "right";
  panelId?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(
      (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
    );
}

function shouldRestoreFocus(
  previousFocusedElement: HTMLElement | null,
  currentContainer: HTMLElement,
): boolean {
  if (!previousFocusedElement || !document.contains(previousFocusedElement)) {
    return false;
  }
  const openDialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  ).filter((dialog) => dialog !== currentContainer);
  if (openDialogs.length === 0) {
    return true;
  }
  return openDialogs.some((dialog) => dialog.contains(previousFocusedElement));
}

export function MobileDrawer(props: MobileDrawerProps) {
  const { t } = useI18n();
  let drawerRef: HTMLDivElement | undefined;
  const titleId = createUniqueId();
  const layerId = createUniqueId();
  let startX = 0;
  let currentX = 0;

  const side = () => props.side ?? "left";

  const isTopLayer = useDialogLifecycle({
    get isOpen() {
      return props.isOpen;
    },
    layerId,
    onEscape: props.onClose,
    closeOnEscape: true,
    lockBodyScroll: true,
  });

  createEffect(() => {
    if (!props.isOpen || !drawerRef) return;

    const container = drawerRef;
    const previousFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = getFocusableElements(container);
    (focusableElements[0] ?? container).focus();

    const handleTabKey = (event: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (event.key !== "Tab") return;
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

    document.addEventListener("keydown", handleTabKey);
    onCleanup(() => {
      document.removeEventListener("keydown", handleTabKey);
      if (
        previousFocusedElement &&
        shouldRestoreFocus(previousFocusedElement, container)
      ) {
        previousFocusedElement.focus();
      }
    });
  });

  const handleTouchStart = (e: TouchEvent) => {
    startX = e.touches[0].clientX;
    currentX = e.touches[0].clientX;
  };

  const handleTouchMove = (e: TouchEvent) => {
    currentX = e.touches[0].clientX;
    const diff = currentX - startX;

    if (side() === "left" && diff < 0) {
      const translateX = Math.max(diff, -280);
      if (drawerRef) {
        drawerRef.style.transform = `translateX(${translateX}px)`;
      }
    } else if (side() === "right" && diff > 0) {
      const translateX = Math.min(diff, 280);
      if (drawerRef) {
        drawerRef.style.transform = `translateX(${translateX}px)`;
      }
    }
  };

  const handleTouchEnd = () => {
    const diff = currentX - startX;
    const threshold = 80;

    if (
      (side() === "left" && diff < -threshold) ||
      (side() === "right" && diff > threshold)
    ) {
      props.onClose();
    }

    if (drawerRef) {
      drawerRef.style.transform = "";
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        <div
          class="absolute inset-0 bg-black/50 animate-fade-in"
          onClick={props.onClose}
        />

        <div
          id={props.panelId}
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.title ? titleId : undefined}
          aria-label={props.title ? undefined : t("menu")}
          tabIndex={-1}
          class={`absolute top-0 bottom-0 w-[280px] max-w-[85vw] bg-white dark:bg-zinc-900 shadow-xl ${
            side() === "left"
              ? "animate-slide-in-left"
              : "animate-slide-in-right"
          } flex flex-col pt-[var(--spacing-safe-top)] ${
            side() === "left"
              ? "left-0 pl-[var(--spacing-safe-left)]"
              : "right-0 pr-[var(--spacing-safe-right)]"
          }`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Show when={props.title}>
            <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
              <h2
                id={titleId}
                class="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              >
                {props.title}
              </h2>
              <button
                type="button"
                class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                onClick={props.onClose}
                aria-label={t("close")}
              >
                <Icons.X class="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
              </button>
            </div>
          </Show>

          <div class="flex-1 overflow-y-auto">
            {props.children}
          </div>
        </div>
      </div>
    </Show>
  );
}

export type { MobileDrawerProps };
