import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  NotifierBase,
  type EmitResult,
  type RingBufferEvent,
  type WebSocketLike,
} from "./notifier-base.ts";
import { parseReplayCursor, toWsEnvelope } from "./notifier-base.ts";

type StoredBufferState = {
  eventBuffer: RingBufferEvent[];
  eventIdCounter: number;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createNotifierState(options: {
  initialState?: StoredBufferState;
  getBufferState?: () => Promise<StoredBufferState | undefined>;
} = {}) {
  const values = new Map<string, unknown>();
  if (options.initialState) {
    values.set("bufferState", structuredClone(options.initialState));
  }
  let pending: Promise<unknown> = Promise.resolve();
  let concurrencyQueue: Promise<unknown> = Promise.resolve();
  let writes = 0;
  let acceptedSockets = 0;
  let alarms = 0;
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        if (key === "bufferState" && options.getBufferState) {
          return await options.getBufferState() as T | undefined;
        }
        const value = values.get(key);
        return value === undefined ? undefined : structuredClone(value) as T;
      },
      async put(key: string, value: unknown): Promise<void> {
        writes += 1;
        values.set(key, structuredClone(value));
      },
      async setAlarm(): Promise<void> {
        alarms += 1;
      },
      async getAlarm(): Promise<number | null> {
        return null;
      },
    },
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const operation = concurrencyQueue.then(callback);
      concurrencyQueue = operation.then(() => undefined, () => undefined);
      pending = operation;
      return operation;
    },
    getWebSockets(): WebSocket[] {
      return [];
    },
    getTags(_webSocket: WebSocket): string[] {
      return [];
    },
    acceptWebSocket(_webSocket: WebSocket, _tags?: string[]): void {
      acceptedSockets += 1;
    },
  };
  return {
    binding: state as never,
    ready: () => pending,
    values,
    get writes() {
      return writes;
    },
    get acceptedSockets() {
      return acceptedSockets;
    },
    get alarms() {
      return alarms;
    },
  };
}

class TestNotifier extends NotifierBase {
  protected readonly moduleName = "notifierbasetest";
  protected readonly maxConnections = 10;
  broadcastMessages: string[] = [];

  protected async loadPersistedState(): Promise<void> {
    const stored = await this.state.storage.get<StoredBufferState>("bufferState");
    if (stored) {
      this.eventBuffer = stored.eventBuffer;
      this.eventIdCounter = stored.eventIdCounter;
    }
  }

  protected async persistState(): Promise<void> {
    await this.state.storage.put("bufferState", {
      eventBuffer: this.eventBuffer,
      eventIdCounter: this.eventIdCounter,
    });
  }

  protected async validateWebSocket(): Promise<{ tags?: string[] }> {
    return { tags: ["test"] };
  }

  protected async processEmit(
    input: { type: string; data: unknown },
    eventId: number,
  ): Promise<EmitResult> {
    return { broadcastMessage: JSON.stringify({ eventId, ...input }) };
  }

  protected override broadcastMessage(message: string): number {
    this.broadcastMessages.push(message);
    return 0;
  }
}

class MockWebSocket implements WebSocketLike {
  messages: Array<string | ArrayBuffer> = [];
  send(data: string | ArrayBuffer): void {
    this.messages.push(data);
  }
  close(_code?: number, _reason?: string): void {}
}

test("toWsEnvelope emits the canonical notifier broadcast shape", () => {
  assert.deepEqual(
    toWsEnvelope({
      type: "run.delta",
      data: { text: "hello" },
      eventId: 42,
      createdAt: "2026-05-14T00:00:00.000Z",
    }),
    {
      type: "run.delta",
      data: { text: "hello" },
      eventId: 42,
      event_id: "42",
      created_at: "2026-05-14T00:00:00.000Z",
    },
  );
});

test("parseReplayCursor accepts absent/empty and non-negative integers", () => {
  assert.equal(parseReplayCursor(null), 0);
  assert.equal(parseReplayCursor(""), 0);
  assert.equal(parseReplayCursor("0"), 0);
  assert.equal(parseReplayCursor("42"), 42);
});

test("parseReplayCursor fails closed (null) on garbage input", () => {
  // parseInt would have coerced these to NaN / 5 / -3, silently breaking the
  // 400 guard and the e.id > cursor replay filter. Strict parse rejects them.
  assert.equal(parseReplayCursor("abc"), null);
  assert.equal(parseReplayCursor("5x"), null);
  assert.equal(parseReplayCursor("-3"), null);
  assert.equal(parseReplayCursor("3.5"), null);
  assert.equal(parseReplayCursor("99999999999999999999"), null); // > MAX_SAFE_INTEGER
});

test("NotifierBase waits for restored state before assigning an emitted event id", async () => {
  const loaderEntered = deferred<void>();
  const storedState = deferred<StoredBufferState | undefined>();
  const state = createNotifierState({
    getBufferState: async () => {
      loaderEntered.resolve();
      return storedState.promise;
    },
  });
  const notifier = new TestNotifier(state.binding);
  const initialization = state.ready();
  let stateSettledBeforeRestore = false;
  const stateRequest = notifier.fetch(
    new Request("https://notifier.test/state"),
  ).then((response) => {
    stateSettledBeforeRestore = true;
    return response;
  });
  let settledBeforeRestore = false;
  const emitRequest = notifier.fetch(new Request("https://notifier.test/emit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "test.event", data: { value: true } }),
  })).then((response) => {
    settledBeforeRestore = true;
    return response;
  });

  await loaderEntered.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const wasSettledBeforeRestore = settledBeforeRestore;
  const wasStateSettledBeforeRestore = stateSettledBeforeRestore;
  storedState.resolve({ eventBuffer: [], eventIdCounter: 41 });
  await initialization;
  const stateResponse = await stateRequest;
  const stateBody = await stateResponse.json() as { lastEventId: number };
  const response = await emitRequest;
  const body = await response.json() as { eventId: number };

  assert.equal(wasSettledBeforeRestore, false);
  assert.equal(wasStateSettledBeforeRestore, false);
  assert.equal(stateResponse.status, 200);
  assert.equal(stateBody.lastEventId, 41);
  assert.equal(response.status, 200);
  assert.equal(body.eventId, 42);
  assert.equal(state.writes, 1);
});

test("NotifierBase rejects every stateful entrypoint after durable state restoration fails", async () => {
  const restoreError = new Error("injected restore failure");
  const state = createNotifierState({
    getBufferState: async () => {
      throw restoreError;
    },
  });
  const notifier = new TestNotifier(state.binding);
  const initialization = state.ready();
  let initializationRejected = false;
  try {
    await initialization;
  } catch (error) {
    initializationRejected = error === restoreError;
  }

  const ws = new MockWebSocket();
  const rejected = async (operation: () => Promise<unknown>): Promise<boolean> => {
    try {
      await operation();
      return false;
    } catch (error) {
      return error === restoreError;
    }
  };

  const outcomes = await Promise.all([
    rejected(() => notifier.fetch(new Request("https://notifier.test/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "test.event", data: {}, runId: "run-1" }),
    }))),
    rejected(() => notifier.fetch(new Request("https://notifier.test/events"))),
    rejected(() => notifier.fetch(new Request("https://notifier.test/state"))),
    rejected(() => notifier.fetch(new Request("https://notifier.test/websocket", {
      headers: { Upgrade: "websocket", "X-WS-Auth-Validated": "true" },
    }))),
    rejected(() => notifier.alarm()),
    rejected(() => notifier.webSocketMessage(ws, "ping")),
    rejected(() => notifier.webSocketClose(ws)),
    rejected(() => notifier.webSocketError(ws, new Error("socket error"))),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(initializationRejected, true);
  assert.deepEqual(outcomes, Array.from({ length: 8 }, () => true));
  assert.equal(state.writes, 0);
  assert.equal(state.acceptedSockets, 0);
  assert.equal(state.alarms, 0);
  assert.deepEqual(notifier.broadcastMessages, []);
  assert.deepEqual(ws.messages, []);
});
