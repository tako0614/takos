export type SearchNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isSearchListboxVisible(state: {
  loading: boolean;
  error: string | null;
  query: string;
  resultCount: number;
}): boolean {
  return (
    !state.loading &&
    !state.error &&
    state.query.trim().length > 0 &&
    state.resultCount > 0
  );
}

export function nextSearchResultIndex(
  currentIndex: number,
  count: number,
  key: SearchNavigationKey,
): number {
  if (count <= 0) return -1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      if (currentIndex < 0 || currentIndex >= count - 1) return 0;
      return currentIndex + 1;
    case "ArrowUp":
      if (currentIndex <= 0 || currentIndex >= count) return count - 1;
      return currentIndex - 1;
  }
}
