import { useState } from 'react';

export const PAGE_SIZE = 20;

export interface UseSourcePaginationResult {
  showCreateModal: boolean;
  setShowCreateModal: React.Dispatch<React.SetStateAction<boolean>>;
  loadMore: (
    filter: string,
    loading: boolean,
    hasMore: boolean,
    appendInFlightRef: React.MutableRefObject<boolean>,
    requestSeqRef: React.MutableRefObject<number>,
    fetchAll: (offset: number, append: boolean, requestId: number) => Promise<void>,
    fetchStarred: (offset: number, append: boolean, requestId: number) => Promise<void>,
  ) => void;
  resetOffset: () => void;
}

export function useSourcePagination(): UseSourcePaginationResult {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [, setOffset] = useState(0);

  const resetOffset = () => setOffset(0);

  const loadMore = (
    filter: string,
    currentLoading: boolean,
    currentHasMore: boolean,
    appendInFlightRef: React.MutableRefObject<boolean>,
    requestSeqRef: React.MutableRefObject<number>,
    fetchAll: (offset: number, append: boolean, requestId: number) => Promise<void>,
    fetchStarred: (offset: number, append: boolean, requestId: number) => Promise<void>,
  ) => {
    if (currentLoading || !currentHasMore || appendInFlightRef.current) return;
    appendInFlightRef.current = true;
    const requestId = requestSeqRef.current;
    setOffset((prevOffset) => {
      const nextOffset = prevOffset + PAGE_SIZE;
      if (filter === 'all') {
        void fetchAll(nextOffset, true, requestId);
      } else if (filter === 'starred') {
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
