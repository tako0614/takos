const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(
      (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
    );
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
