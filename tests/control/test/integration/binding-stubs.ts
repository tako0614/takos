/**
 * Typed noop binding stubs for tests.
 *
 * Use these when a function signature requires a binding-shaped value
 * but the test path is intercepted (via dep injection, an early return,
 * or a validation guard) before any binding method is invoked. Every
 * method throws on access so an accidental call surfaces immediately
 * instead of returning undefined and silently mis-behaving.
 *
 * Tests that actually exercise the binding should construct the concrete
 * `MockSqlDatabaseBinding` / `MockKvStoreBinding` / etc. classes exported
 * from `setup.ts` instead.
 */
import type {
  DurableObjectNamespace,
  KvStoreBinding,
  MessageQueueBinding,
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "@/shared/types/bindings.ts";

const stubMethodNotImplemented = (target: string, method: string): never => {
  throw new Error(
    `${target}.${method} was called on a noop test stub. ` +
      `Either provide a real mock for this code path or guard the call site.`,
  );
};

export function noopSqlDatabaseBinding(): SqlDatabaseBinding {
  return {
    prepare: () => stubMethodNotImplemented("SqlDatabaseBinding", "prepare"),
    batch: () => stubMethodNotImplemented("SqlDatabaseBinding", "batch"),
    exec: () => stubMethodNotImplemented("SqlDatabaseBinding", "exec"),
    withSession: () =>
      stubMethodNotImplemented("SqlDatabaseBinding", "withSession"),
    dump: () => stubMethodNotImplemented("SqlDatabaseBinding", "dump"),
  };
}

export function noopObjectStoreBinding(): ObjectStoreBinding {
  return {
    get: () => stubMethodNotImplemented("ObjectStoreBinding", "get"),
    head: () => stubMethodNotImplemented("ObjectStoreBinding", "head"),
    put: () => stubMethodNotImplemented("ObjectStoreBinding", "put"),
    delete: () => stubMethodNotImplemented("ObjectStoreBinding", "delete"),
    list: () => stubMethodNotImplemented("ObjectStoreBinding", "list"),
  };
}

export function noopKvStoreBinding(): KvStoreBinding {
  return {
    get:
      (() =>
        stubMethodNotImplemented("KvStoreBinding", "get")) as KvStoreBinding[
          "get"
        ],
    getWithMetadata: (() =>
      stubMethodNotImplemented(
        "KvStoreBinding",
        "getWithMetadata",
      )) as KvStoreBinding["getWithMetadata"],
    put: () => stubMethodNotImplemented("KvStoreBinding", "put"),
    delete: () => stubMethodNotImplemented("KvStoreBinding", "delete"),
    list: () => stubMethodNotImplemented("KvStoreBinding", "list"),
  };
}

export function noopMessageQueueBinding<
  T = unknown,
>(): MessageQueueBinding<T> {
  return {
    send: () => stubMethodNotImplemented("MessageQueueBinding", "send"),
    sendBatch: () =>
      stubMethodNotImplemented("MessageQueueBinding", "sendBatch"),
  };
}

export function noopDurableObjectNamespace(): DurableObjectNamespace {
  return {
    idFromName: () => ({}),
    get: () => stubMethodNotImplemented("DurableObjectNamespace", "get"),
  };
}
