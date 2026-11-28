export type MenuFocusTarget = "first" | "last";

function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

function isContainedBy(
  container: HTMLElement | undefined,
  target: EventTarget | null,
): boolean {
  if (!container || !target) return false;
  if (typeof Node !== "undefined" && target instanceof Node) {
    return container.contains(target);
  }
  try {
    return container.contains(target as Node);
  } catch {
    return false;
  }
}

export function getDropdownMenuItems(
  menu: HTMLElement | undefined,
): HTMLButtonElement[] {
  return menu
    ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    : [];
}

export function focusDropdownMenuItem(
  menu: HTMLElement | undefined,
  target: MenuFocusTarget,
): HTMLButtonElement | null {
  const items = getDropdownMenuItems(menu);
  if (items.length === 0) return null;
  const item = target === "last" ? items[items.length - 1] : items[0];
  item?.focus();
  return item ?? null;
}

export function handleMenuTriggerKeyDown(
  e: KeyboardEvent,
  options: {
    isOpen: boolean;
    getMenu: () => HTMLElement | undefined;
    openWithTarget: (target: MenuFocusTarget) => void;
  },
): boolean {
  if (isImeComposing(e)) return false;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
  e.preventDefault();
  const target: MenuFocusTarget = e.key === "ArrowUp" ? "last" : "first";
  if (options.isOpen) {
    focusDropdownMenuItem(options.getMenu(), target);
  } else {
    options.openWithTarget(target);
  }
  return true;
}

export function handleDropdownMenuKeyDown(
  e: KeyboardEvent,
  options: {
    getMenu: () => HTMLElement | undefined;
    getTrigger: () => HTMLElement | undefined;
    close: () => void;
  },
): boolean {
  if (isImeComposing(e)) return false;
  if (e.key === "Tab") {
    // Close synchronously and return focus to the mounted trigger without
    // preventing default so native Tab/Shift+Tab continues cleanly from the
    // trigger instead of falling back to document.body when the menu unmounts.
    options.close();
    options.getTrigger()?.focus();
    return true;
  }

  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return false;
  const items = getDropdownMenuItems(options.getMenu());
  if (items.length === 0) return false;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (e.key === "ArrowDown") {
    next = index < 0 ? 0 : (index + 1) % items.length;
  } else if (e.key === "ArrowUp") {
    next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
  } else if (e.key === "Home") {
    next = 0;
  } else {
    next = items.length - 1;
  }
  e.preventDefault();
  items[next]?.focus();
  return true;
}

export function shouldCloseOnFocusOut(
  e: FocusEvent,
  container: HTMLElement | undefined,
  isPointerDownInside: boolean,
): boolean {
  const next = e.relatedTarget;
  if (isContainedBy(container, next)) return false;
  if (!next && isPointerDownInside) return false;
  return true;
}

export function activateDropdownMenuItem(options: {
  close: () => void;
  getTrigger: () => HTMLElement | undefined;
  action: () => void;
}): void {
  options.close();
  // Restore focus to the trigger before opening a follow-up modal or file
  // picker so useFocusTrap captures the trigger instead of document.body.
  options.getTrigger()?.focus();
  options.action();
}
