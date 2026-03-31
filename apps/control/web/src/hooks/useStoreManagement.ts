import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';

export interface StoreItem {
  slug: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  repo_actor_url: string;
  repo_name: string | null;
  repo_summary: string | null;
  repo_owner_slug: string | null;
  local_repo_id: string | null;
  created_at: string;
}

export interface RegistryEntry {
  id: string;
  actor_url: string;
  domain: string;
  store_slug: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  is_active: boolean;
  subscription_enabled: boolean;
  last_fetched_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useStoreManagement(spaceId: string) {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.spaces[':spaceId'].stores.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ stores: StoreItem[] }>(res);
      setStores(data.stores);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stores');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  const createStore = useCallback(async (slug: string, name?: string, summary?: string) => {
    const res = await rpc.spaces[':spaceId'].stores.$post({
      param: { spaceId },
      json: { slug, name, summary },
    });
    const data = await rpcJson<{ store: StoreItem }>(res);
    setStores((prev) => [...prev, data.store]);
    return data.store;
  }, [spaceId]);

  const deleteStore = useCallback(async (storeSlug: string) => {
    await rpc.spaces[':spaceId'].stores[':storeSlug'].$delete({
      param: { spaceId, storeSlug },
    });
    setStores((prev) => prev.filter((s) => s.slug !== storeSlug));
  }, [spaceId]);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  return { stores, loading, error, fetchStores, createStore, deleteStore };
}

export function useStoreInventory(spaceId: string, storeSlug: string) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory.$get({
        param: { spaceId, storeSlug },
        query: { limit: '100', offset: '0' },
      });
      const data = await rpcJson<{ total: number; items: InventoryItem[] }>(res);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [spaceId, storeSlug]);

  const addItem = useCallback(async (repoActorUrl: string, repoName?: string) => {
    const res = await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory.$post({
      param: { spaceId, storeSlug },
      json: { repo_actor_url: repoActorUrl, repo_name: repoName },
    });
    await rpcJson(res);
    await fetchItems();
  }, [spaceId, storeSlug, fetchItems]);

  const removeItem = useCallback(async (itemId: string) => {
    await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory[':itemId'].$delete({
      param: { spaceId, storeSlug, itemId },
    });
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setTotal((prev) => prev - 1);
  }, [spaceId, storeSlug]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  return { items, total, loading, error, fetchItems, addItem, removeItem };
}

export function useStoreRegistry(spaceId: string) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.spaces[':spaceId']['store-registry'].$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ stores: RegistryEntry[] }>(res);
      setEntries(data.stores);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load remote stores');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  const addRemoteStore = useCallback(async (identifier: string, subscribe = false) => {
    const res = await rpc.spaces[':spaceId']['store-registry'].$post({
      param: { spaceId },
      json: { identifier, set_active: true, subscribe },
    });
    await rpcJson(res);
    await fetchEntries();
  }, [spaceId, fetchEntries]);

  const removeEntry = useCallback(async (entryId: string) => {
    await rpc.spaces[':spaceId']['store-registry'][':entryId'].$delete({
      param: { spaceId, entryId },
    });
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  }, [spaceId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  return { entries, loading, error, fetchEntries, addRemoteStore, removeEntry };
}
