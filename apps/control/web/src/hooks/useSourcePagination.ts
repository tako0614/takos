import { useRef, useState } from 'react';
import type { SourceItem } from './useSourceData';

export const PAGE_SIZE = 20;

export interface UseSourcePaginationResult {
  items: SourceItem[];
  setItems: React.Dispatch<React.SetStateAction<SourceItem[]>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  hasMore: boolean;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  total: number;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  selectedItem: SourceItem | null;
  setSelectedItem: React.Dispatch<React.SetStateAction<SourceItem | null>>;
  installingId: string | null;
  setInstallingId: React.Dispatch<React.SetStateAction<string | null>>;
  showCreateModal: boolean;
  setShowCreateModal: React.Dispatch<React.SetStateAction<boolean>>;
  requestSeqRef: React.MutableRefObject<number>;
  appendInFlightRef: React.MutableRefObject<boolean>;
  loadMore: (
    filter: string,
    loading: boolean,
    hasMore: boolean,
    fetchAll: (offset: number, append: boolean, requestId: number) => Promise<void>,
    fetchStarred: (offset: number, append: boolean, requestId: number) => Promise<void>,
  ) => void;
}

export function useSourcePagination(): UseSourcePaginationResult {
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState<SourceItem | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [, setOffset] = useState(0);
  const requestSeqRef = useRef(0);
  const appendInFlightRef = useRef(false);

  const loadMore = (
    filter: string,
    currentLoading: boolean,
    currentHasMore: boolean,
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
    items,
    setItems,
    loading,
    setLoading,
    hasMore,
    setHasMore,
    total,
    setTotal,
    selectedItem,
    setSelectedItem,
    installingId,
    setInstallingId,
    showCreateModal,
    setShowCreateModal,
    requestSeqRef,
    appendInFlightRef,
    loadMore,
  };
}
