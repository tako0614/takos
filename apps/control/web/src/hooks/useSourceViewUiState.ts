import { useCallback, useEffect, useRef, useState } from 'react';

const SOURCE_VIEW_UI_STATE_KEY = 'takos.source.view-ui-state.v1';

export type SourceViewUiState = {
  browseMode: boolean;
  homeScrollTop: number;
  searchScrollTop: number;
};

function readSourceViewUiState(): Partial<SourceViewUiState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SOURCE_VIEW_UI_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SourceViewUiState> & { scrollTop?: number };
    const legacyScrollTop = typeof parsed.scrollTop === 'number' && Number.isFinite(parsed.scrollTop)
      ? parsed.scrollTop
      : undefined;
    return {
      browseMode: typeof parsed.browseMode === 'boolean' ? parsed.browseMode : undefined,
      homeScrollTop: typeof parsed.homeScrollTop === 'number' && Number.isFinite(parsed.homeScrollTop)
        ? parsed.homeScrollTop
        : legacyScrollTop,
      searchScrollTop: typeof parsed.searchScrollTop === 'number' && Number.isFinite(parsed.searchScrollTop)
        ? parsed.searchScrollTop
        : undefined,
    };
  } catch {
    return {};
  }
}

function writeSourceViewUiState(nextState: SourceViewUiState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SOURCE_VIEW_UI_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // noop
  }
}

export function useSourceViewUiState() {
  const [initialState] = useState<SourceViewUiState>(() => {
    const persisted = readSourceViewUiState();
    return {
      browseMode: persisted.browseMode ?? false,
      homeScrollTop: persisted.homeScrollTop ?? 0,
      searchScrollTop: persisted.searchScrollTop ?? 0,
    };
  });

  const stateRef = useRef<SourceViewUiState>(initialState);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [browseMode, setBrowseMode] = useState(initialState.browseMode);

  const persist = useCallback((nextState: Partial<SourceViewUiState>) => {
    stateRef.current = { ...stateRef.current, ...nextState };
    writeSourceViewUiState(stateRef.current);
  }, []);

  useEffect(() => {
    persist({ browseMode });
  }, [browseMode, persist]);

  const restoreScroll = useCallback((isSearchMode: boolean) => {
    const targetScrollTop = isSearchMode
      ? stateRef.current.searchScrollTop
      : stateRef.current.homeScrollTop;
    const rafId = window.requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = targetScrollTop;
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const handleContentScroll = useCallback((isSearchMode: boolean) => {
    const currentScrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    if (isSearchMode) {
      persist({ searchScrollTop: currentScrollTop });
      return;
    }
    persist({ homeScrollTop: currentScrollTop });
  }, [persist]);

  return {
    browseMode,
    setBrowseMode,
    scrollContainerRef,
    restoreScroll,
    handleContentScroll,
  };
}
