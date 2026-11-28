import { type Accessor, createEffect, onCleanup } from "solid-js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function isInsideClosedDetails(element: HTMLElement): boolean {
  let parent = element.parentElement;
  let child: HTMLElement = element;
  while (parent) {
    if (parent.tagName === "DETAILS" && !parent.hasAttribute("open")) {
      // The direct <summary> child of a closed <details> remains focusable.
      const isDirectSummary = child.tagName === "SUMMARY" &&
        parent.firstElementChild === child;
      if (!isDirectSummary) return true;
    }
    child = parent;
    parent = parent.parentElement;
  }
  return false;
}

function isHiddenOrInert(element: HTMLElement): boolean {
  const hasComputedStyle = typeof globalThis.getComputedStyle === "function";
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return true;
    }
    if (current.tagName === "FIELDSET" && current.hasAttribute("disabled")) {
      const firstLegend: Element | undefined = Array.from(current.children)
        .find((child) => child.tagName === "LEGEND");
      if (!firstLegend || !firstLegend.contains(element)) {
        return true;
      }
    }
    if (hasComputedStyle) {
      try {
        const style = globalThis.getComputedStyle(current);
        if (
          style.display === "none" ||
          (current === element && style.visibility === "hidden")
        ) {
          return true;
        }
      } catch {
        // Non-browser DOM shims (e.g. linkedom) may not implement getComputedStyle fully.
      }
    } else if (
      current.style?.display === "none" ||
      (current === element && current.style?.visibility === "hidden")
    ) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

export function isElementFocusable(element: HTMLElement): boolean {
  if (element.hasAttribute("disabled")) return false;
  if (
    element.tagName === "INPUT" &&
    (element as HTMLInputElement).type === "hidden"
  ) {
    return false;
  }
  const tabIndexAttr = element.getAttribute("tabindex");
  if (tabIndexAttr !== null && Number.parseInt(tabIndexAttr, 10) < 0) {
    return false;
  }
  if (isInsideClosedDetails(element)) return false;
  if (isHiddenOrInert(element)) return false;
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isElementFocusable);
}

export function shouldRestoreFocus(
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

export function restoreFocusAfterDialogClose(
  previousFocusedElement: HTMLElement | null,
  currentContainer: HTMLElement,
): HTMLElement | null {
  if (
    previousFocusedElement &&
    shouldRestoreFocus(previousFocusedElement, currentContainer)
  ) {
    previousFocusedElement.focus();
    return previousFocusedElement;
  }

  const remainingDialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  ).filter((dialog) => dialog !== currentContainer);
  if (remainingDialogs.length > 0) {
    const topDialog = remainingDialogs[remainingDialogs.length - 1];
    if (!topDialog.hasAttribute("tabindex")) {
      topDialog.tabIndex = -1;
    }
    topDialog.focus();
    return topDialog;
  }

  const mainLandmark = document.querySelector<HTMLElement>(
    'main, [role="main"]',
  );
  if (mainLandmark) {
    if (!mainLandmark.hasAttribute("tabindex")) {
      mainLandmark.tabIndex = -1;
    }
    mainLandmark.focus();
    return mainLandmark;
  }

  return null;
}

export interface UseFocusTrapOptions {
  isOpen: boolean | Accessor<boolean>;
  getContainer: () => HTMLElement | undefined;
  isTopLayer?: () => boolean;
  respectAutofocus?: boolean;
}

export function useFocusTrap(options: UseFocusTrapOptions): void {
  const isOpen = () =>
    typeof options.isOpen === "function" ? options.isOpen() : options.isOpen;
  const isTopLayer = () => options.isTopLayer?.() ?? true;

  createEffect(() => {
    if (!isOpen()) return;
    const container = options.getContainer();
    if (!container) return;

    const previousFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusableElements = getFocusableElements(container);
    const autoFocusElement = (options.respectAutofocus ?? true)
      ? (focusableElements.find(
        (el) =>
          el.hasAttribute("autofocus") ||
          el.getAttribute("data-autofocus") === "true" ||
          (el as HTMLElement & { autofocus?: boolean }).autofocus === true,
      ) ?? null)
      : null;
    (autoFocusElement ?? focusableElements[0] ?? container).focus();

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
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
        if (
          active === first ||
          active === container ||
          !active ||
          !container.contains(active)
        ) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !active || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTabKey);
    onCleanup(() => {
      document.removeEventListener("keydown", handleTabKey);
      restoreFocusAfterDialogClose(previousFocusedElement, container);
    });
  });
}
