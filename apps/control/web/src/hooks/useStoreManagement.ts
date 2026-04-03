import { createSignal, createEffect, on, type Accessor } from 'solid-js';
import { rpc, rpcJson, rpcPath } from '../lib/rpc.ts';

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

export function useStoreManagement(spaceId: Accessor<string | undefined>) {
  const [stores, setStores] = createSignal<StoreItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let storesRequestSeq = 0;

  const fetchStores = async () => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      setStores([]);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++storesRequestSeq;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.spaces[':spaceId'].stores.$get({
        param: { spaceId: currentSpaceId },
      });
      const data = await rpcJson<{ stores: StoreItem[] }>(res);
      if (requestId !== storesRequestSeq) return;
      if (spaceId() !== currentSpaceId) return;
      setStores(data.stores);
    } catch (err) {
      if (requestId !== storesRequestSeq) return;
      if (spaceId() !== currentSpaceId) return;
      setError(err instanceof Error ? err.message : 'Failed to load stores');
    } finally {
      if (requestId === storesRequestSeq && spaceId() === currentSpaceId) {
        setLoading(false);
      }
    }
  };

  const createStore = async (slug: string, name?: string, summary?: string) => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      throw new Error('Missing space');
    }
    const res = await rpc.spaces[':spaceId'].stores.$post({
      param: { spaceId: currentSpaceId },
      json: { slug, name, summary },
    });
    const data = await rpcJson<{ store: StoreItem }>(res);
    if (currentSpaceId === spaceId()) {
      setStores((prev) => [...prev, data.store]);
    }
    return data.store;
  };

  const deleteStore = async (storeSlug: string) => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      throw new Error('Missing space');
    }
    await rpc.spaces[':spaceId'].stores[':storeSlug'].$delete({
      param: { spaceId: currentSpaceId, storeSlug },
    });
    if (currentSpaceId === spaceId()) {
      setStores((prev) => prev.filter((s) => s.slug !== storeSlug));
    }
  };

  createEffect(on(() => spaceId(), () => { void fetchStores(); }));

  return { stores, loading, error, fetchStores, createStore, deleteStore };
}

export function useStoreInventory(
  spaceId: Accessor<string | undefined>,
  storeSlug: Accessor<string | undefined>,
) {
  const [items, setItems] = createSignal<InventoryItem[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let itemsRequestSeq = 0;

  const fetchItems = async () => {
    const currentSpaceId = spaceId();
    const currentStoreSlug = storeSlug();
    if (!currentSpaceId || !currentStoreSlug) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++itemsRequestSeq;
    setLoading(true);
    setError(null);
    try {
      const res = await rpcPath(rpc, 'spaces', ':spaceId', 'stores', ':storeSlug', 'inventory').$get({
        param: { spaceId: currentSpaceId, storeSlug: currentStoreSlug },
        query: { limit: '100', offset: '0' },
      }) as unknown as Response;
      const data = await rpcJson<{ total: number; items: InventoryItem[] }>(res);
      if (requestId !== itemsRequestSeq) return;
      if (spaceId() !== currentSpaceId || storeSlug() !== currentStoreSlug) return;
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      if (requestId !== itemsRequestSeq) return;
      if (spaceId() !== currentSpaceId || storeSlug() !== currentStoreSlug) return;
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      if (
        requestId === itemsRequestSeq &&
        spaceId() === currentSpaceId &&
        storeSlug() === currentStoreSlug
      ) {
        setLoading(false);
      }
    }
  };

  const addItem = async (repoActorUrl: string, repoName?: string) => {
    const currentSpaceId = spaceId();
    const currentStoreSlug = storeSlug();
    if (!currentSpaceId || !currentStoreSlug) {
      throw new Error('Missing store context');
    }
    const res = await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory.$post({
      param: { spaceId: currentSpaceId, storeSlug: currentStoreSlug },
      json: { repo_actor_url: repoActorUrl, repo_name: repoName },
    });
    await rpcJson(res);
    await fetchItems();
  };

  const removeItem = async (itemId: string) => {
    const currentSpaceId = spaceId();
    const currentStoreSlug = storeSlug();
    if (!currentSpaceId || !currentStoreSlug) {
      throw new Error('Missing store context');
    }
    await rpc.spaces[':spaceId'].stores[':storeSlug'].inventory[':itemId'].$delete({
      param: { spaceId: currentSpaceId, storeSlug: currentStoreSlug, itemId },
    });
    if (currentSpaceId === spaceId() && currentStoreSlug === storeSlug()) {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setTotal((prev) => prev - 1);
    }
  };

  createEffect(on(() => [spaceId(), storeSlug()], () => { void fetchItems(); }));

  return { items, total, loading, error, fetchItems, addItem, removeItem };
}

export function useStoreRegistry(spaceId: Accessor<string | undefined>) {
  const [entries, setEntries] = createSignal<RegistryEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let entriesRequestSeq = 0;

  const fetchEntries = async () => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++entriesRequestSeq;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.spaces[':spaceId']['store-registry'].$get({
        param: { spaceId: currentSpaceId },
      });
      const data = await rpcJson<{ stores: RegistryEntry[] }>(res);
      if (requestId !== entriesRequestSeq) return;
      if (spaceId() !== currentSpaceId) return;
      setEntries(data.stores);
    } catch (err) {
      if (requestId !== entriesRequestSeq) return;
      if (spaceId() !== currentSpaceId) return;
      setError(err instanceof Error ? err.message : 'Failed to load remote stores');
    } finally {
      if (requestId === entriesRequestSeq && spaceId() === currentSpaceId) {
        setLoading(false);
      }
    }
  };

  const addRemoteStore = async (identifier: string, subscribe = false) => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      throw new Error('Missing space');
    }
    const res = await rpc.spaces[':spaceId']['store-registry'].$post({
      param: { spaceId: currentSpaceId },
      json: { identifier, set_active: true, subscribe },
    });
    await rpcJson(res);
    await fetchEntries();
  };

  const removeEntry = async (entryId: string) => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      throw new Error('Missing space');
    }
    await rpc.spaces[':spaceId']['store-registry'][':entryId'].$delete({
      param: { spaceId: currentSpaceId, entryId },
    });
    if (currentSpaceId === spaceId()) {
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    }
  };

  createEffect(on(() => spaceId(), () => { void fetchEntries(); }));

  return { entries, loading, error, fetchEntries, addRemoteStore, removeEntry };
}
