import { createSignal, createEffect, on } from 'solid-js';
import { rpc, rpcJson, rpcPath } from '../lib/rpc';

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
  const [stores, setStores] = createSignal<StoreItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetchStores = async () => {
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
  };

  const createStore = async (slug: string, name?: string, summary?: string) => {
    const res = await rpc.spaces[':spaceId'].stores.$post({
      param: { spaceId },
      json: { slug, name, summary },
    });
    const data = await rpcJson<{ store: StoreItem }>(res);
    setStores((prev) => [...prev, data.store]);
    return data.store;
  };

  const deleteStore = async (storeSlug: string) => {
    await rpc.spaces[':spaceId'].stores[':storeSlug'].$delete({
      param: { spaceId, storeSlug },
    });
    setStores((prev) => prev.filter((s) => s.slug !== storeSlug));
  };

  createEffect(on(() => spaceId, () => { fetchStores(); }));

  return { stores, loading, error, fetchStores, createStore, deleteStore };
}

export function useStoreInventory(spaceId: string, storeSlug: string) {
  const [items, setItems] = createSignal<InventoryItem[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpcPath(rpc, 'spaces', ':spaceId', 'stores', ':storeSlug', 'inventory').$get({
        param: { spaceId, storeSlug },
        query: { limit: '100', offset: '0' },
      }) as Response;
      const data = await rpcJson<{ total: number; items: InventoryItem[] }>(res);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  const addItem = async (repoActorUrl: string, repoName?: string) => {
    const res = await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory.$post({
      param: { spaceId, storeSlug },
      json: { repo_actor_url: repoActorUrl, repo_name: repoName },
    });
    await rpcJson(res);
    await fetchItems();
  };

  const removeItem = async (itemId: string) => {
    await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory[':itemId'].$delete({
      param: { spaceId, storeSlug, itemId },
    });
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setTotal((prev) => prev - 1);
  };

  createEffect(on(() => [spaceId, storeSlug], () => { fetchItems(); }));

  return { items, total, loading, error, fetchItems, addItem, removeItem };
}

export function useStoreRegistry(spaceId: string) {
  const [entries, setEntries] = createSignal<RegistryEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetchEntries = async () => {
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
  };

  const addRemoteStore = async (identifier: string, subscribe = false) => {
    const res = await rpc.spaces[':spaceId']['store-registry'].$post({
      param: { spaceId },
      json: { identifier, set_active: true, subscribe },
    });
    await rpcJson(res);
    await fetchEntries();
  };

  const removeEntry = async (entryId: string) => {
    await rpc.spaces[':spaceId']['store-registry'][':entryId'].$delete({
      param: { spaceId, entryId },
    });
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  };

  createEffect(on(() => spaceId, () => { fetchEntries(); }));

  return { entries, loading, error, fetchEntries, addRemoteStore, removeEntry };
}
