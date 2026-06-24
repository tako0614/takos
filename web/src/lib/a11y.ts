/**
 * Move focus among the `[role="tab"]` siblings of the currently-focused tab in
 * response to Arrow / Home / End keys (WAI-ARIA tabs pattern, automatic
 * activation). Wraps around at the ends.
 *
 * Returns the newly-focused tab's `data-tab-id` so the caller can activate it,
 * or `null` when the key isn't a tablist navigation key (caller ignores it).
 *
 * The focused element must be the tab button (`e.currentTarget`) and live
 * inside an element with `role="tablist"`; each tab should carry a
 * `data-tab-id` attribute.
 */
export function moveTabFocus(e: KeyboardEvent): string | null {
  const navKeys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!navKeys.includes(e.key)) return null;
  const current = e.currentTarget as HTMLElement | null;
  const list = current?.closest('[role="tablist"]');
  if (!current || !list) return null;
  const tabs = Array.from(
    list.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'),
  );
  const index = tabs.indexOf(current);
  if (index < 0) return null;
  let next = index;
  if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else next = tabs.length - 1;
  e.preventDefault();
  tabs[next].focus();
  return tabs[next].dataset.tabId ?? null;
}
