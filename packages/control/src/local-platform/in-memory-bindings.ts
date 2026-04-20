import type {
  DurableObjectNamespace,
  DurableObjectStub,
} from "../shared/types/bindings.ts";

export { createInMemoryD1Database } from "./in-memory-d1.ts";
export { createInMemoryKVNamespace } from "./in-memory-kv.ts";
export { createInMemoryR2Bucket } from "./in-memory-r2.ts";
export { createInMemoryQueue } from "./in-memory-queue.ts";

export type InMemoryDurableObjectNamespace<
  TStub = DurableObjectStub,
> = DurableObjectNamespace<TStub> & {
  getByName(name: string): TStub;
};

function durableObjectIdKey(id: unknown): string {
  return typeof id === "string" ? id : String(id);
}

export function createInMemoryDurableObjectNamespace<
  TStub = DurableObjectStub,
>(
  factory?: (id: string) => TStub,
): InMemoryDurableObjectNamespace<TStub> {
  const stubs = new Map<string, TStub>();

  const makeStub = (id: string): TStub => {
    if (factory) return factory(id);
    return {
      async fetch() {
        return Response.json({ ok: true, durableObject: id });
      },
    } as TStub;
  };

  const namespace: InMemoryDurableObjectNamespace<TStub> = {
    idFromName(name: string) {
      return name;
    },
    get(id: unknown) {
      const key = durableObjectIdKey(id);
      if (!stubs.has(key)) stubs.set(key, makeStub(key));
      return stubs.get(key)!;
    },
    getByName(name: string) {
      return namespace.get(namespace.idFromName(name));
    },
  };

  return namespace;
}
