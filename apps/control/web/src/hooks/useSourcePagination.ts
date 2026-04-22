import { createSignal } from "solid-js";
import type { Accessor, Setter } from "solid-js";

export const PAGE_SIZE = 20;

export interface UseSourcePaginationResult {
  showCreateModal: Accessor<boolean>;
  setShowCreateModal: Setter<boolean>;
  loadMore: (
    filter: string,
    loading: boolean,
    hasMore: boolean,
    appendInFlightHolder: { appendInFlightRef: boolean },
    requestSeqHolder: { requestSeqRef: number },
    fetchAll: (
      offset: number,
      append: boolean,
      requestId: number,
    ) => Promise<void>,
    fetchStarred: (
      offset: number,
      append: boolean,
      requestId: number,
    ) => Promise<void>,
  ) => void;
  resetOffset: () => void;
}

export function useSourcePagination(): UseSourcePaginationResult {
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [, setOffset] = createSignal(0);

  const resetOffset = () => setOffset(0);

  const loadMore = (
    filter: string,
    currentLoading: boolean,
    currentHasMore: boolean,
    appendInFlightHolder: { appendInFlightRef: boolean },
    requestSeqHolder: { requestSeqRef: number },
    fetchAll: (
      offset: number,
      append: boolean,
      requestId: number,
    ) => Promise<void>,
    fetchStarred: (
      offset: number,
      append: boolean,
      requestId: number,
    ) => Promise<void>,
  ) => {
    if (
      currentLoading || !currentHasMore ||
      appendInFlightHolder.appendInFlightRef
    ) return;
    appendInFlightHolder.appendInFlightRef = true;
    const requestId = requestSeqHolder.requestSeqRef;
    setOffset((prevOffset) => {
      const nextOffset = prevOffset + PAGE_SIZE;
      if (filter === "all") {
        void fetchAll(nextOffset, true, requestId);
      } else if (filter === "starred") {
        void fetchStarred(nextOffset, true, requestId);
      }
      return nextOffset;
    });
  };

  return {
    showCreateModal,
    setShowCreateModal,
    loadMore,
    resetOffset,
  };
}
