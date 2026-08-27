import { getEnv } from "@takos/worker-platform-utils/runtime-env";
/**
 * Durable Object resolver — selects Redis/persistent/in-memory.
 */
import path from "node:path";
import type {
  DurableObjectNamespace,
  DurableObjectStateBinding,
  DurableObjectStorageBinding,
  DurableObjectStub,
} from "../../shared/types/bindings.ts";
import { SessionDO } from "../../runtime/durable-objects/session.ts";
import { createSyncResolverWithRedis } from "./resolver-factory.ts";
import { createInMemoryDurableObjectNamespace } from "../../local-platform/in-memory-bindings.ts";
import { createPersistentDurableObjectNamespace } from "../../local-platform/persistent-bindings.ts";
import { createRedisDurableObjectNamespace } from "../../worker-emulation/redis-durable-object.ts";

const SESSION_DO_REDIS_UNSUPPORTED =
  "Node SessionDO Redis substrate is unsupported; configure in-memory local state";
const SESSION_DO_NON_DURABLE_UNSUPPORTED =
  "Node SessionDO requires a durable backend in production; process-memory state is development-only";

type TimerHandle = ReturnType<typeof setTimeout>;

type DisposableDurableObjectNamespace = DurableObjectNamespace & {
  dispose(): void;
};

function isProductionShapedEnvironment(): boolean {
  const environment = getEnv("ENVIRONMENT")?.trim().toLowerCase();
  const nodeEnvironment = getEnv("NODE_ENV")?.trim().toLowerCase();
  return environment === "production" || nodeEnvironment === "production";
}

/**
 * A serialized in-memory storage implementation for the authoritative
 * SessionDO. The generic local Durable Object stub returns an `ok` response
 * without running any object logic, which lets create calls appear successful
 * while every subsequent read loses the state. This storage is deliberately
 * scoped to one SessionDO instance and lives for the lifetime of the Node
 * process; it does not claim restart durability.
 */
class SessionMemoryStorage implements DurableObjectStorageBinding {
  private readonly entries = new Map<string, unknown>();
  private alarm: number | null = null;

  constructor(
    private readonly onAlarmChanged: (scheduledTime: number | null) => void,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void>;
  async put(entries: Record<string, unknown>): Promise<void>;
  async put(
    keyOrEntries: string | Record<string, unknown>,
    value?: unknown,
  ): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.entries.set(keyOrEntries, value);
      return;
    }
    for (const [key, entry] of Object.entries(keyOrEntries)) {
      this.entries.set(key, entry);
    }
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (Array.isArray(keyOrKeys)) {
      let deleted = 0;
      for (const key of keyOrKeys) {
        if (this.entries.delete(key)) deleted += 1;
      }
      return deleted;
    }
    return this.entries.delete(keyOrKeys);
  }

  async list<T = unknown>(
    options?: Record<string, unknown>,
  ): Promise<Map<string, T>> {
    const prefix = typeof options?.prefix === "string" ? options.prefix : "";
    const limit =
      typeof options?.limit === "number" && options.limit >= 0
        ? options.limit
        : Infinity;
    const result = new Map<string, T>();
    for (const key of Array.from(this.entries.keys()).sort()) {
      if (!key.startsWith(prefix)) continue;
      result.set(key, this.entries.get(key) as T);
      if (result.size >= limit) break;
    }
    return result;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  readAlarm(): number | null {
    return this.alarm;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm =
      typeof scheduledTime === "number"
        ? scheduledTime
        : scheduledTime.getTime();
    this.onAlarmChanged(this.alarm);
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
    this.onAlarmChanged(null);
  }
}

class SessionMemoryState implements DurableObjectStateBinding {
  readonly storage: SessionMemoryStorage;
  private queue: Promise<unknown> = Promise.resolve();
  private alarmHandler: (() => Promise<void>) | null = null;
  private timer: TimerHandle | null = null;
  private alarmGeneration = 0;
  private disposed = false;

  constructor() {
    this.storage = new SessionMemoryStorage((scheduledTime) => {
      this.armAlarm(scheduledTime);
    });
  }

  setAlarmHandler(handler: () => Promise<void>): void {
    this.alarmHandler = handler;
    const scheduledTime = this.storageAlarm();
    if (scheduledTime !== null) this.armAlarm(scheduledTime);
  }

  private storageAlarm(): number | null {
    // `getAlarm()` is intentionally async in the provider-neutral contract,
    // but this local storage keeps the value synchronously as well. Reading
    // through `readAlarm()` avoids an avoidable microtask during set-up.
    return this.storage.readAlarm();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private armAlarm(scheduledTime: number | null): void {
    this.alarmGeneration += 1;
    this.clearTimer();
    if (this.disposed || scheduledTime === null) return;

    const generation = this.alarmGeneration;
    const delay = Math.max(0, scheduledTime - Date.now());
    // SessionDO currently treats an entry as expired only once `expires_at`
    // is strictly less than `Date.now()`. If an alarm is re-scheduled for the
    // current tick, a one-millisecond floor prevents a zero-delay spin while
    // still preserving the provider's at-least-once alarm semantics.
    const timerDelay = delay === 0 ? 1 : delay;
    const timer = setTimeout(() => {
      // A timer callback can already be queued when a caller re-arms the
      // alarm. Do not clear the newer timer handle or enqueue a stale alarm in
      // that case; generation is advanced by every arm/cancel operation.
      if (generation !== this.alarmGeneration) return;
      this.timer = null;
      void this.runAlarm(generation).catch(() => {
        // A failed alarm must not produce an unhandled rejection or leave a
        // stale timer handle. The SessionDO's next mutation can arm a fresh
        // alarm, matching the best-effort behavior of provider runtimes.
      });
    }, timerDelay);
    this.timer = timer;
    const unref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof unref === "function") unref.call(timer);
  }

  private async runAlarm(generation: number): Promise<void> {
    const handler = this.alarmHandler;
    if (!handler) return;

    await this.blockConcurrencyWhile(async () => {
      if (this.disposed || generation !== this.alarmGeneration) return;

      const scheduledTime = await this.storage.getAlarm();
      if (scheduledTime === null) return;
      if (scheduledTime > Date.now()) {
        this.armAlarm(scheduledTime);
        return;
      }

      // Cloudflare clears the alarm before invoking alarm(). Do that while
      // holding this object's serialization queue so a concurrent fetch can
      // never observe an alarm that is about to be delivered twice.
      await this.storage.deleteAlarm();
      await handler();

      // SessionDO.alarm() may arm a new alarm (or re-arm the same one). Read
      // back after it resolves so a provider-style re-schedule is honored even
      // when the handler did not call setAlarm through this adapter.
      const nextAlarm = await this.storage.getAlarm();
      if (nextAlarm !== null) this.armAlarm(nextAlarm);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alarmGeneration += 1;
    this.clearTimer();
    this.alarmHandler = null;
  }

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const run = this.queue.then(callback);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  getWebSockets(): WebSocket[] {
    return [];
  }

  getTags(_webSocket: WebSocket): string[] {
    return [];
  }

  acceptWebSocket(_webSocket: WebSocket, _tags?: string[]): void {
    // SessionDO does not use WebSockets; this is the required structural
    // surface for the provider-neutral DurableObjectStateBinding contract.
  }
}

type SessionMemoryStub = DurableObjectStub & { dispose(): void };

function createSessionStub(): SessionMemoryStub {
  const state = new SessionMemoryState();
  const durableObject = new SessionDO(state);
  state.setAlarmHandler(() => durableObject.alarm());
  return {
    async fetch(input: Request | URL | string, init?: RequestInit) {
      const request = new Request(input, init);
      return durableObject.fetch(request);
    },
    dispose() {
      state.dispose();
    },
  };
}

/**
 * Build a real in-memory namespace for the authoritative SessionDO. IDs are
 * stable for the namespace lifetime, so the session and OIDC shard selected by
 * the identity service see the same object and storage on every request.
 */
export function createSessionDurableObjectNamespace(): DisposableDurableObjectNamespace {
  const stubs = new Map<string, SessionMemoryStub>();
  let disposed = false;
  const namespace: DisposableDurableObjectNamespace = {
    idFromName(name: string) {
      return name;
    },
    get(id: unknown) {
      if (disposed) throw new Error("SessionDO namespace is disposed");
      const key = typeof id === "string" ? id : String(id);
      if (!stubs.has(key)) stubs.set(key, createSessionStub());
      return stubs.get(key)!;
    },
    getByName(name: string) {
      return namespace.get(namespace.idFromName(name));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stub of stubs.values()) stub.dispose();
      stubs.clear();
    },
  };
  return namespace;
}

function resolveSessionDurableObject(
  redisUrl: string | null,
  _dataDir: string | null,
): DurableObjectNamespace {
  // Always reject Redis for SessionDO. The generic Redis emulation only
  // exposes storage primitives and has no SessionDO fetch/alarm handler, so
  // accepting it would silently turn authentication state into a fake write.
  if (redisUrl !== null) {
    throw new Error(SESSION_DO_REDIS_UNSUPPORTED);
  }
  if (isProductionShapedEnvironment()) {
    throw new Error(SESSION_DO_NON_DURABLE_UNSUPPORTED);
  }

  // Node development always uses process-local state for SessionDO regardless
  // of `dataDir`; Redis was rejected above. Other Node bindings may use
  // `dataDir` for durable local state, but this adapter deliberately remains
  // process-local until a truthful persistent SessionDO storage implementation
  // exists. Do not imply restart durability.
  return createSessionDurableObjectNamespace();
}

export function resolveDurableObject(
  name: string,
  redisUrl: string | null,
  dataDir: string | null,
) {
  if (name === "session") {
    return resolveSessionDurableObject(redisUrl, dataDir);
  }
  if (getEnv("TAKOS_DISABLE_REDIS_EXTERNALS") === "1") {
    return createInMemoryDurableObjectNamespace();
  }
  return createSyncResolverWithRedis({
    createRedis: (url) => createRedisDurableObjectNamespace(url, name),
    createPersistent: (dir) =>
      createPersistentDurableObjectNamespace(
        path.join(dir, "durable-objects", `${name}.json`),
      ),
    createInMemory: () => createInMemoryDurableObjectNamespace(),
  })(redisUrl, dataDir);
}
