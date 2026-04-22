import type { DurableObjectStub } from "../shared/types/bindings.ts";
import {
  createInMemoryDurableObjectNamespace,
  type InMemoryDurableObjectNamespace,
} from "./in-memory-bindings.ts";
import { readJsonFile, writeJsonFile } from "./persistent-shared.ts";
import { logWarn } from "../shared/utils/logger.ts";

export function createPersistentDurableObjectNamespace(
  stateFile: string,
  factory?: (id: string) => DurableObjectStub,
): InMemoryDurableObjectNamespace {
  type RegistryState = { ids: string[] };
  let registry: RegistryState | null = null;
  const namespaces = new Map<string, DurableObjectStub>();

  async function loadRegistry(): Promise<RegistryState> {
    if (registry) return registry;
    registry = await readJsonFile<RegistryState>(stateFile, { ids: [] });
    return registry;
  }

  async function flushRegistry(): Promise<void> {
    if (!registry) return;
    await writeJsonFile(stateFile, registry);
  }

  const namespace = createInMemoryDurableObjectNamespace((id) => {
    const existing = namespaces.get(id);
    if (existing) return existing;
    const stub = factory?.(id) ??
      createInMemoryDurableObjectNamespace().getByName(id);
    namespaces.set(id, stub);
    return stub;
  });

  const originalGet = namespace.get.bind(namespace);
  namespace.get = (id: { toString(): string }) => {
    const key = id.toString();
    void loadRegistry().then((state) => {
      if (!state.ids.includes(key)) {
        state.ids.push(key);
        void flushRegistry();
      }
    }).catch((err) =>
      logWarn("Failed to load/flush registry on get", {
        module: "persistent-durable-objects",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return originalGet(id as Parameters<typeof originalGet>[0]);
  };
  namespace.getByName = (name: string) =>
    namespace.get(namespace.idFromName(name));

  void loadRegistry().then((state) => {
    for (const id of state.ids) {
      const stub = factory?.(id) ??
        createInMemoryDurableObjectNamespace().getByName(id);
      namespaces.set(id, stub);
    }
  }).catch((err) =>
    logWarn("Failed to pre-load registry", {
      module: "persistent-durable-objects",
      error: err instanceof Error ? err.message : String(err),
    })
  );

  return namespace as InMemoryDurableObjectNamespace;
}
