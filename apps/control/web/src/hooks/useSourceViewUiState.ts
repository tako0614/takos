import { createEffect, createSignal } from "solid-js";

const SOURCE_VIEW_UI_STATE_KEY = "takos.source.view-ui-state.v1";

export type SourceViewUiState = {
  browseMode: boolean;
  homeScrollTop: number;
  searchScrollTop: number;
};

function readSourceViewUiState(): Partial<SourceViewUiState> {
  const storage = globalThis.sessionStorage;
  if (!storage) return {};
  try {
    const raw = storage.getItem(SOURCE_VIEW_UI_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SourceViewUiState> & {
      scrollTop?: number;
    };
    const legacyScrollTop =
      typeof parsed.scrollTop === "number" && Number.isFinite(parsed.scrollTop)
        ? parsed.scrollTop
        : undefined;
    return {
      browseMode: typeof parsed.browseMode === "boolean"
        ? parsed.browseMode
        : undefined,
      homeScrollTop: typeof parsed.homeScrollTop === "number" &&
          Number.isFinite(parsed.homeScrollTop)
        ? parsed.homeScrollTop
        : legacyScrollTop,
      searchScrollTop: typeof parsed.searchScrollTop === "number" &&
          Number.isFinite(parsed.searchScrollTop)
        ? parsed.searchScrollTop
        : undefined,
    };
  } catch {
    return {};
  }
}

function writeSourceViewUiState(nextState: SourceViewUiState) {
  const storage = globalThis.sessionStorage;
  if (!storage) return;
  try {
    storage.setItem(SOURCE_VIEW_UI_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // noop
  }
}

export function useSourceViewUiState() {
  const persisted = readSourceViewUiState();
  const initialState: SourceViewUiState = {
    browseMode: persisted.browseMode ?? false,
    homeScrollTop: persisted.homeScrollTop ?? 0,
    searchScrollTop: persisted.searchScrollTop ?? 0,
  };

  let stateRef: SourceViewUiState = initialState;
  let scrollContainerRef: HTMLDivElement | undefined;
  const [browseMode, setBrowseMode] = createSignal(initialState.browseMode);

  const persist = (nextState: Partial<SourceViewUiState>) => {
    stateRef = { ...stateRef, ...nextState };
    writeSourceViewUiState(stateRef);
  };

  createEffect(() => {
    persist({ browseMode: browseMode() });
  });

  const restoreScroll = (isSearchMode: boolean) => {
    const targetScrollTop = isSearchMode
      ? stateRef.searchScrollTop
      : stateRef.homeScrollTop;
    const rafId = globalThis.requestAnimationFrame(() => {
      if (scrollContainerRef) {
        scrollContainerRef.scrollTop = targetScrollTop;
      }
    });
    return () => globalThis.cancelAnimationFrame(rafId);
  };

  const handleContentScroll = (isSearchMode: boolean) => {
    const currentScrollTop = scrollContainerRef?.scrollTop ?? 0;
    if (isSearchMode) {
      persist({ searchScrollTop: currentScrollTop });
      return;
    }
    persist({ homeScrollTop: currentScrollTop });
  };

  return {
    browseMode,
    setBrowseMode,
    get scrollContainerRef() {
      return scrollContainerRef;
    },
    set scrollContainerRef(el: HTMLDivElement | undefined) {
      scrollContainerRef = el;
    },
    restoreScroll,
    handleContentScroll,
  };
}
