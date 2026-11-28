import { createEffect, onCleanup } from "solid-js";

export const APP_DOCUMENT_TITLE = "Takos";

/** `"Memory"` → `"Memory · Takos"`; empty / missing → `"Takos"`. */
export function formatDocumentTitle(page?: string | null): string {
  const trimmed = page?.trim();
  return trimmed ? `${trimmed} · ${APP_DOCUMENT_TITLE}` : APP_DOCUMENT_TITLE;
}

interface TitleEntry {
  title: string | null | undefined;
}

// The most recently mounted surface owns the tab title. A stack (instead of a
// single "last writer wins" assignment) keeps the title correct regardless of
// whether Solid disposes the previous route before or after mounting the next
// one, and lets nested surfaces (route → thread) refine the outer title.
const titleStack: TitleEntry[] = [];

function applyDocumentTitle(): void {
  if (typeof document === "undefined") return;
  const top = titleStack[titleStack.length - 1];
  document.title = formatDocumentTitle(top?.title);
}

export interface DocumentTitleHandle {
  update: (title: string | null | undefined) => void;
  release: () => void;
}

export function pushDocumentTitle(
  title: string | null | undefined,
): DocumentTitleHandle {
  const entry: TitleEntry = { title };
  titleStack.push(entry);
  applyDocumentTitle();
  return {
    update(next) {
      entry.title = next;
      applyDocumentTitle();
    },
    release() {
      const index = titleStack.indexOf(entry);
      if (index === -1) return;
      titleStack.splice(index, 1);
      applyDocumentTitle();
    },
  };
}

/**
 * Sets a per-screen `document.title` while the calling component is mounted,
 * so browser tabs, history entries and screen-reader page announcements say
 * where the user is instead of a constant "Takos".
 */
export function useDocumentTitle(
  title: () => string | null | undefined,
): void {
  const handle = pushDocumentTitle(undefined);
  createEffect(() => handle.update(title()));
  onCleanup(() => handle.release());
}
