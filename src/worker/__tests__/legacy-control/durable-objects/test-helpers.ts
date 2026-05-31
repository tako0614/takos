import { type Spy, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import type {
  DurableObjectStateBinding,
  DurableObjectStorageBinding,
} from "@/shared/types/bindings.ts";

/**
 * MockStorage exposes spies for mutating methods so tests can introspect
 * call history (e.g. `storage.put.calls[0].args`). The base
 * `DurableObjectStorageBinding` contract is preserved via intersection.
 */
export type MockStorage =
  & Omit<
    DurableObjectStorageBinding,
    "put" | "delete" | "setAlarm" | "deleteAlarm"
  >
  & {
    put: Spy<unknown, [string, unknown], Promise<void>>;
    delete: Spy<unknown, [string], Promise<boolean | void>>;
    setAlarm: Spy<unknown, [number | Date], Promise<void>>;
    deleteAlarm: Spy<unknown, [], Promise<void>>;
    _store: Map<string, unknown>;
    _getAlarm: () => number | null;
  };

export type MockState = DurableObjectStateBinding & {
  storage: MockStorage;
  blockConcurrencyWhileCalls: number;
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
    get:
      (async <T>(key: string): Promise<T | undefined> =>
        store.get(key) as T | undefined) as MockStorage["get"],
    put: spy(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: spy(async (key: string) => {
      store.delete(key);
      return true;
    }),
    setAlarm: spy(async (ms: number | Date) => {
      alarm = typeof ms === "number" ? ms : ms.getTime();
    }),
    deleteAlarm: spy(async () => {
      alarm = null;
    }),
    getAlarm: async () => alarm,
    list: (async (options?: Record<string, unknown>) => {
      const result = new Map<string, unknown>();
      const prefix = options?.prefix as string | undefined;
      const limit = options?.limit as number | undefined;
      for (const [key, value] of store) {
        if (prefix && !key.startsWith(prefix)) continue;
        result.set(key, value);
        if (limit && result.size >= limit) break;
      }
      return result;
    }) as MockStorage["list"],
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
    acceptWebSocket: (_ws: WebSocket, _tags?: string[]) => undefined,
    getWebSockets: () => [] as WebSocket[],
    getTags: (_ws: WebSocket) => [] as string[],
  };
  return state;
}

/**
 * Test WebSocket double. Implements just the WebSocket subset the
 * RunNotifier DO exercises (`send` / `close`), but declares the rest of the
 * WebSocket interface members as `never`-typed unused fields. The structural
 * declaration lets `MockWebSocket` flow into `WebSocket`-typed slots in the
 * DO state binding without an `as unknown as` cast.
 */
declare const __WS_UNUSED: unique symbol;
export class MockWebSocket {
  // Structural-only members so MockWebSocket is assignable to WebSocket
  // in DO state binding slots. None of these are read by the DO.
  declare readonly binaryType: BinaryType;
  declare readonly bufferedAmount: number;
  declare readonly extensions: string;
  declare readonly onclose: WebSocket["onclose"];
  declare readonly onerror: WebSocket["onerror"];
  declare readonly onmessage: WebSocket["onmessage"];
  declare readonly onopen: WebSocket["onopen"];
  declare readonly protocol: string;
  declare readonly readyState: number;
  declare readonly url: string;
  declare readonly CLOSED: WebSocket["CLOSED"];
  declare readonly CLOSING: WebSocket["CLOSING"];
  declare readonly CONNECTING: WebSocket["CONNECTING"];
  declare readonly OPEN: WebSocket["OPEN"];
  declare addEventListener: WebSocket["addEventListener"];
  declare removeEventListener: WebSocket["removeEventListener"];
  declare dispatchEvent: WebSocket["dispatchEvent"];
  // Cloudflare Workers extends the standard WebSocket with accept/serialize
  // helpers; expose them as declared-only so structural assignment compiles.
  declare accept: WebSocket extends { accept: infer A } ? A : never;
  declare serializeAttachment: WebSocket extends
    { serializeAttachment: infer A } ? A
    : never;
  declare deserializeAttachment: WebSocket extends
    { deserializeAttachment: infer A } ? A : never;
  declare [__WS_UNUSED]: never;

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
