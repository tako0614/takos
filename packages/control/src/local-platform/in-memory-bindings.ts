import type {
  DurableObjectNamespace,
  DurableObjectStub,
} from '../shared/types/bindings.ts';

export { createInMemoryD1Database } from './in-memory-d1.ts';
export { createInMemoryKVNamespace } from './in-memory-kv.ts';
export { createInMemoryR2Bucket } from './in-memory-r2.ts';
export { createInMemoryQueue } from './in-memory-queue.ts';

export type InMemoryDurableObjectNamespace = DurableObjectNamespace & {
  getByName(name: string): DurableObjectStub;
};

export function createInMemoryDurableObjectNamespace(
  factory?: (id: string) => DurableObjectStub,
): InMemoryDurableObjectNamespace {
  const stubs = new Map<string, DurableObjectStub>();

  const makeStub = (id: string): DurableObjectStub => {
    if (factory) return factory(id);
    return {
      id: {
        equals(other: { toString(): string }) {
          return other.toString() === id;
        },
        toString() {
          return id;
        },
        name: id,
      },
      name: id,
      async fetch() {
        return Response.json({ ok: true, durableObject: id }) as unknown as Response;
      },
      connect() {
        throw new Error('connect() is not supported in the local durable object stub');
      },
    } as unknown as DurableObjectStub;
  };

  const namespace = {
    newUniqueId() {
      const raw = crypto.randomUUID();
      return {
        equals(other: { toString(): string }) {
          return other.toString() === raw;
        },
        toString() {
          return raw;
        },
        name: raw,
      };
    },
    idFromName(name: string) {
      return {
        equals(other: { toString(): string }) {
          return other.toString() === name;
        },
        toString() {
          return name;
        },
        name,
      };
    },
    idFromString(id: string) {
      return {
        equals(other: { toString(): string }) {
          return other.toString() === id;
        },
        toString() {
          return id;
        },
        name: id,
      };
    },
    get(id: { toString(): string }) {
      const key = id.toString();
      if (!stubs.has(key)) stubs.set(key, makeStub(key));
      return stubs.get(key)!;
    },
    getByName(name: string) {
      return namespace.get(namespace.idFromName(name));
    },
    jurisdiction() {
      return namespace;
    },
  };

  return namespace as unknown as InMemoryDurableObjectNamespace;
}
