import { createEffect, createSignal } from "solid-js";
import {
  type InventoryItem,
  type RegistryEntry,
  type StoreItem,
  useStoreInventory,
  useStoreManagement,
  useStoreRegistry,
} from "../../hooks/useStoreManagement.ts";

interface StoreManagementPageProps {
  spaceId: string;
}

export function StoreManagementPage(props: StoreManagementPageProps) {
  const { stores, loading, error, createStore, deleteStore } =
    useStoreManagement(() => props.spaceId);
  const [selectedStore, setSelectedStore] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<"inventory" | "registry">(
    "inventory",
  );

  const [newSlug, setNewSlug] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  createEffect(() => {
    props.spaceId;
    setSelectedStore(null);
    setActiveTab("inventory");
    setNewSlug("");
  });

  createEffect(() => {
    const currentStore = selectedStore();
    if (
      currentStore && !stores().some((store) => store.slug === currentStore)
    ) {
      setSelectedStore(null);
    }
  });

  const handleCreateStore = async () => {
    if (!newSlug().trim()) return;
    setCreating(true);
    try {
      await createStore(newSlug().trim());
      setNewSlug("");
    } catch {
      // error handled by hook
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteStore = async (slug: string) => {
    try {
      await deleteStore(slug);
      if (selectedStore() === slug) setSelectedStore(null);
    } catch {
      // error handled by hook
    }
  };

  return (
    <div class="flex-1 flex flex-col min-h-0">
      <div class="border-b border-zinc-200 dark:border-zinc-700 px-6 py-4">
        <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Store Management
        </h1>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage your ActivityPub stores, inventory, and remote store
          connections.
        </p>
      </div>

      <div class="flex-1 flex min-h-0">
        {/* Store list sidebar */}
        <div class="w-64 border-r border-zinc-200 dark:border-zinc-700 flex flex-col">
          <div class="p-3 border-b border-zinc-200 dark:border-zinc-700">
            <div class="flex gap-2">
              <input
                type="text"
                value={newSlug()}
                onInput={(e) => setNewSlug(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateStore()}
                placeholder="New store slug..."
                class="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleCreateStore}
                disabled={creating() || !newSlug().trim()}
                class="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                +
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto">
            {loading() && (
              <div class="p-3 text-sm text-zinc-500">Loading...</div>
            )}
            {error() && <div class="p-3 text-sm text-red-500">{error()}</div>}
            {stores().map((store: StoreItem) => (
              <StoreListItem
                store={store}
                selected={selectedStore() === store.slug}
                onSelect={() => setSelectedStore(store.slug)}
                onDelete={() => handleDeleteStore(store.slug)}
              />
            ))}
            {!loading() && stores().length === 0 && (
              <div class="p-3 text-sm text-zinc-500">No stores yet</div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div class="flex-1 flex flex-col min-h-0">
          {selectedStore()
            ? (
              <>
                <div class="border-b border-zinc-200 dark:border-zinc-700 px-6 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab("inventory")}
                    class={`py-3 text-sm font-medium border-b-2 ${
                      activeTab() === "inventory"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    Inventory
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("registry")}
                    class={`py-3 text-sm font-medium border-b-2 ${
                      activeTab() === "registry"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    Remote Stores
                  </button>
                </div>
                <div class="flex-1 overflow-y-auto">
                  {activeTab() === "inventory" && (
                    <InventoryPanel
                      spaceId={() => props.spaceId}
                      storeSlug={() => selectedStore()!}
                    />
                  )}
                  {activeTab() === "registry" && (
                    <RegistryPanel spaceId={() => props.spaceId} />
                  )}
                </div>
              </>
            )
            : (
              <div class="flex-1 flex items-center justify-center">
                <p class="text-sm text-zinc-500">
                  Select a store or create a new one
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function StoreListItem(props: {
  store: StoreItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={props.onSelect}
      class={`px-3 py-2.5 cursor-pointer border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between group ${
        props.selected
          ? "bg-blue-50 dark:bg-blue-900/20"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <div class="min-w-0">
        <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {props.store.name || props.store.slug}
        </div>
        {props.store.is_default && (
          <span class="text-xs text-zinc-400">default</span>
        )}
      </div>
      {!props.store.is_default && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete();
          }}
          class="opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-700 px-1"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function InventoryPanel(
  props: { spaceId: () => string; storeSlug: () => string },
) {
  const { items, total, loading, error, addItem, removeItem } =
    useStoreInventory(
      props.spaceId,
      props.storeSlug,
    );
  const [newUrl, setNewUrl] = createSignal("");
  const [adding, setAdding] = createSignal(false);

  const handleAdd = async () => {
    if (!newUrl().trim()) return;
    setAdding(true);
    try {
      await addItem(newUrl().trim());
      setNewUrl("");
    } catch {
      // handled by hook
    } finally {
      setAdding(false);
    }
  };

  return (
    <div class="p-6 space-y-4">
      <div>
        <h3 class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Add Repository Reference
        </h3>
        <div class="flex gap-2">
          <input
            type="text"
            value={newUrl()}
            onInput={(e) => setNewUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="https://instance.example/ap/repos/owner/repo"
            class="flex-1 px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding() || !newUrl().trim()}
            class="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p class="text-xs text-zinc-400 mt-1">
          Enter the ActivityPub actor URL of a repository to add it to this
          store's inventory.
        </p>
      </div>

      {error() && <div class="text-sm text-red-500">{error()}</div>}

      <div>
        <h3 class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Inventory ({total()} items)
        </h3>
        {loading()
          ? <div class="text-sm text-zinc-500">Loading...</div>
          : items().length === 0
          ? (
            <div class="text-sm text-zinc-500 py-4 text-center border border-dashed border-zinc-300 dark:border-zinc-600 rounded">
              No items in inventory. All public repos are shown by default.
              <br />
              Add a reference to switch to explicit mode.
            </div>
          )
          : (
            <div class="border border-zinc-200 dark:border-zinc-700 rounded divide-y divide-zinc-200 dark:divide-zinc-700">
              {items().map((item: InventoryItem) => (
                <div class="px-4 py-3 flex items-center justify-between">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {item.repo_name || item.repo_actor_url}
                    </div>
                    <div class="text-xs text-zinc-400 truncate">
                      {item.repo_actor_url}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    class="text-xs text-red-500 hover:text-red-700 px-2 py-1"
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

function RegistryPanel(props: { spaceId: () => string }) {
  const { entries, loading, error, addRemoteStore, removeEntry } =
    useStoreRegistry(
      props.spaceId,
    );
  const [identifier, setIdentifier] = createSignal("");
  const [adding, setAdding] = createSignal(false);

  const handleAdd = async () => {
    if (!identifier().trim()) return;
    setAdding(true);
    try {
      await addRemoteStore(identifier().trim());
      setIdentifier("");
    } catch {
      // handled by hook
    } finally {
      setAdding(false);
    }
  };

  return (
    <div class="p-6 space-y-4">
      <div>
        <h3 class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Connect Remote Store
        </h3>
        <div class="flex gap-2">
          <input
            type="text"
            value={identifier()}
            onInput={(e) => setIdentifier(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="store@remote-instance.example"
            class="flex-1 px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding() || !identifier().trim()}
            class="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Connect
          </button>
        </div>
        <p class="text-xs text-zinc-400 mt-1">
          Enter a store identifier (slug@domain) or full ActivityPub actor URL.
        </p>
      </div>

      {error() && <div class="text-sm text-red-500">{error()}</div>}

      <div>
        <h3 class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          Connected Remote Stores ({entries().length})
        </h3>
        {loading()
          ? <div class="text-sm text-zinc-500">Loading...</div>
          : entries().length === 0
          ? (
            <div class="text-sm text-zinc-500 py-4 text-center border border-dashed border-zinc-300 dark:border-zinc-600 rounded">
              No remote stores connected yet.
            </div>
          )
          : (
            <div class="border border-zinc-200 dark:border-zinc-700 rounded divide-y divide-zinc-200 dark:divide-zinc-700">
              {entries().map((entry: RegistryEntry) => (
                <div class="px-4 py-3 flex items-center justify-between">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {entry.name}
                    </div>
                    <div class="text-xs text-zinc-400">
                      {entry.store_slug}@{entry.domain}
                      {entry.is_active && (
                        <span class="ml-2 text-green-500">Active</span>
                      )}
                      {entry.subscription_enabled && (
                        <span class="ml-2 text-blue-500">Subscribed</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    class="text-xs text-red-500 hover:text-red-700 px-2 py-1"
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
