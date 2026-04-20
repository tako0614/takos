import { spy } from "jsr:@std/testing/mock";
import { FakeTime } from "jsr:@std/testing/time";

export type MockStorage = {
  get: <T>(key: string) => Promise<T | undefined>;
  put: any;
  delete: any;
  setAlarm: any;
  deleteAlarm: any;
  getAlarm: () => Promise<number | null>;
  list: (
    options?: { prefix?: string; limit?: number },
  ) => Promise<Map<string, unknown>>;
  _store: Map<string, unknown>;
  _getAlarm: () => number | null;
};

export type MockState = {
  storage: MockStorage;
  blockConcurrencyWhileCalls: number;
  blockConcurrencyWhile: <T>(fn: () => Promise<T>) => Promise<T>;
  acceptWebSocket: (...args: any[]) => undefined;
  getWebSockets: () => never[];
  getTags: () => never[];
};

export function createMockEnv() {
  return {
    DB: {} as unknown,
    TAKOS_OFFLOAD: undefined,
  };
}

export function createMockStorage(): MockStorage {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    get: async <T>(key: string): Promise<T | undefined> =>
      store.get(key) as T | undefined,
    put: spy(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: spy(async (key: string) => {
      store.delete(key);
      return true;
    }),
    setAlarm: spy(async (ms: number) => {
      alarm = ms;
    }),
    deleteAlarm: spy(async () => {
      alarm = null;
    }),
    getAlarm: async () => alarm,
    list: async (options?: { prefix?: string; limit?: number }) => {
      const result = new Map<string, unknown>();
      for (const [key, value] of store) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue;
        result.set(key, value);
        if (options?.limit && result.size >= options.limit) break;
      }
      return result;
    },
    _store: store,
    _getAlarm: () => alarm,
  };
}

export function createMockState(storage = createMockStorage()): MockState {
  const state: MockState = {
    storage,
    blockConcurrencyWhileCalls: 0,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => {
      state.blockConcurrencyWhileCalls += 1;
      return await fn();
    },
    acceptWebSocket: ((..._args: any[]) => undefined) as any,
    getWebSockets: () => [],
    getTags: () => [],
  };
  return state;
}

export class MockWebSocket {
  sent: string[] = [];
  closed = false;
  closeCode?: number;
  closeReason?: string;
  connectionId?: string;
  lastActivity?: number;

  send(data: string) {
    if (this.closed) throw new Error("WebSocket closed");
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

export function installWebSocketPairMock() {
  const client = new MockWebSocket();
  const server = new MockWebSocket();

  (globalThis as Record<string, unknown>).WebSocketPair = class {
    0 = client;
    1 = server;
  };

  return { client, server };
}

export function internalHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "X-Takos-Internal-Marker": "1",
    "Content-Type": "application/json",
    ...extra,
  };
}

export function postJSON(
  path: string,
  body: unknown,
  headers: Record<string, string> = internalHeaders(),
): Request {
  return new Request(`https://do.internal${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export function getRequest(
  path: string,
  headers: Record<string, string> = internalHeaders(),
): Request {
  return new Request(`https://do.internal${path}`, {
    method: "GET",
    headers,
  });
}

export async function jsonBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

export async function withFakeTime<T>(
  fn: (fakeTime: FakeTime) => Promise<T> | T,
): Promise<T> {
  const fakeTime = new FakeTime();
  try {
    return await fn(fakeTime);
  } finally {
    fakeTime.restore();
  }
}
