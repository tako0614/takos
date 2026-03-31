import { useState } from 'react';
import { useI18n } from '../../store/i18n';
import {
  useStoreManagement,
  useStoreInventory,
  useStoreRegistry,
  type StoreItem,
} from '../../hooks/useStoreManagement';

interface StoreManagementPageProps {
  spaceId: string;
}

export function StoreManagementPage({ spaceId }: StoreManagementPageProps) {
  const { t } = useI18n();
  const { stores, loading, error, createStore, deleteStore, fetchStores } = useStoreManagement(spaceId);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'inventory' | 'registry'>('inventory');

  const [newSlug, setNewSlug] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateStore = async () => {
    if (!newSlug.trim()) return;
    setCreating(true);
    try {
      await createStore(newSlug.trim());
      setNewSlug('');
    } catch {
      // error handled by hook
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteStore = async (slug: string) => {
    try {
      await deleteStore(slug);
      if (selectedStore === slug) setSelectedStore(null);
    } catch {
      // error handled by hook
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-zinc-200 dark:border-zinc-700 px-6 py-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Store Management</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage your ActivityPub stores, inventory, and remote store connections.
        </p>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Store list sidebar */}
        <div className="w-64 border-r border-zinc-200 dark:border-zinc-700 flex flex-col">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateStore()}
                placeholder="New store slug..."
                className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
              <button
                onClick={handleCreateStore}
                disabled={creating || !newSlug.trim()}
                className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <div className="p-3 text-sm text-zinc-500">Loading...</div>}
            {error && <div className="p-3 text-sm text-red-500">{error}</div>}
            {stores.map((store) => (
              <StoreListItem
                key={store.slug}
                store={store}
                selected={selectedStore === store.slug}
                onSelect={() => setSelectedStore(store.slug)}
                onDelete={() => handleDeleteStore(store.slug)}
              />
            ))}
            {!loading && stores.length === 0 && (
              <div className="p-3 text-sm text-zinc-500">No stores yet</div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedStore ? (
            <>
              <div className="border-b border-zinc-200 dark:border-zinc-700 px-6 flex gap-4">
                <button
                  onClick={() => setActiveTab('inventory')}
                  className={`py-3 text-sm font-medium border-b-2 ${
                    activeTab === 'inventory'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  Inventory
                </button>
                <button
                  onClick={() => setActiveTab('registry')}
                  className={`py-3 text-sm font-medium border-b-2 ${
                    activeTab === 'registry'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  Remote Stores
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'inventory' && (
                  <InventoryPanel spaceId={spaceId} storeSlug={selectedStore} />
                )}
                {activeTab === 'registry' && (
                  <RegistryPanel spaceId={spaceId} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-zinc-500">Select a store or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StoreListItem({
  store,
  selected,
  onSelect,
  onDelete,
}: {
  store: StoreItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`px-3 py-2.5 cursor-pointer border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between group ${
        selected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{store.name || store.slug}</div>
        {store.is_default && (
          <span className="text-xs text-zinc-400">default</span>
        )}
      </div>
      {!store.is_default && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-700 px-1"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function InventoryPanel({ spaceId, storeSlug }: { spaceId: string; storeSlug: string }) {
  const { items, total, loading, error, addItem, removeItem } = useStoreInventory(spaceId, storeSlug);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      await addItem(newUrl.trim());
      setNewUrl('');
    } catch {
      // handled by hook
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Add Repository Reference
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="https://instance.example/ap/repos/owner/repo"
            className="flex-1 px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newUrl.trim()}
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Enter the ActivityPub actor URL of a repository to add it to this store's inventory.
        </p>
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}

      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Inventory ({total} items)
        </h3>
        {loading ? (
          <div className="text-sm text-zinc-500">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-zinc-500 py-4 text-center border border-dashed border-zinc-300 dark:border-zinc-600 rounded">
            No items in inventory. All public repos are shown by default.
            <br />
            Add a reference to switch to explicit mode.
          </div>
        ) : (
          <div className="border border-zinc-200 dark:border-zinc-700 rounded divide-y divide-zinc-200 dark:divide-zinc-700">
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {item.repo_name || item.repo_actor_url}
                  </div>
                  <div className="text-xs text-zinc-400 truncate">{item.repo_actor_url}</div>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RegistryPanel({ spaceId }: { spaceId: string }) {
  const { entries, loading, error, addRemoteStore, removeEntry } = useStoreRegistry(spaceId);
  const [identifier, setIdentifier] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!identifier.trim()) return;
    setAdding(true);
    try {
      await addRemoteStore(identifier.trim());
      setIdentifier('');
    } catch {
      // handled by hook
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Connect Remote Store
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="store@remote-instance.example"
            className="flex-1 px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !identifier.trim()}
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Connect
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Enter a store identifier (slug@domain) or full ActivityPub actor URL.
        </p>
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}

      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Connected Remote Stores ({entries.length})
        </h3>
        {loading ? (
          <div className="text-sm text-zinc-500">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-zinc-500 py-4 text-center border border-dashed border-zinc-300 dark:border-zinc-600 rounded">
            No remote stores connected yet.
          </div>
        ) : (
          <div className="border border-zinc-200 dark:border-zinc-700 rounded divide-y divide-zinc-200 dark:divide-zinc-700">
            {entries.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {entry.name}
                  </div>
                  <div className="text-xs text-zinc-400">
                    {entry.store_slug}@{entry.domain}
                    {entry.is_active && <span className="ml-2 text-green-500">Active</span>}
                    {entry.subscription_enabled && <span className="ml-2 text-blue-500">Subscribed</span>}
                  </div>
                </div>
                <button
                  onClick={() => removeEntry(entry.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
