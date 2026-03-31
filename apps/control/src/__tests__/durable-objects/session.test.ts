// deno-lint-ignore-file no-import-prefix no-unversioned-import
import type { DurableObjectState } from "@cloudflare/workers-types";
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { SessionDO } from "../../../../../packages/control/src/runtime/durable-objects/session.ts";

type SessionRecord = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

type OIDCRecord = {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  expires_at: number;
  cli_callback?: string;
};

function makeRequest(path: string, body: unknown): Request {
  return new Request(`https://do.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createStorage(initialAlarm: number | null = Date.now() + 60_000) {
  const store = new Map<string, unknown>();
  const state = {
    store,
    alarm: initialAlarm,
    putCalls: [] as Array<[string, unknown]>,
    getCalls: [] as Array<[string]>,
    deleteCalls: [] as Array<[string]>,
    setAlarmCalls: [] as Array<[number]>,
    deleteAlarmCalls: 0,
    getAlarmCalls: 0,
    get<T>(key: string): Promise<T | undefined> {
      state.getCalls.push([key]);
      return Promise.resolve(store.get(key) as T | undefined);
    },
    put(key: string, value: unknown): Promise<void> {
      state.putCalls.push([key, value]);
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<boolean> {
      state.deleteCalls.push([key]);
      return Promise.resolve(store.delete(key));
    },
    setAlarm(ms: number): Promise<void> {
      state.setAlarmCalls.push([ms]);
      state.alarm = ms;
      return Promise.resolve();
    },
    deleteAlarm(): Promise<void> {
      state.deleteAlarmCalls++;
      state.alarm = null;
      return Promise.resolve();
    },
    getAlarm(): Promise<number | null> {
      state.getAlarmCalls++;
      return Promise.resolve(state.alarm);
    },
  };
  return state;
}

function createDo(initialAlarm: number | null = Date.now() + 60_000, stored?: {
  sessions?: Record<string, SessionRecord>;
  oidcStates?: Record<string, OIDCRecord>;
}) {
  const storage = createStorage(initialAlarm);
  if (stored) {
    storage.store.set("data", stored);
  }

  const state = {
    storage,
    blockConcurrencyCalls: 0,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      state.blockConcurrencyCalls++;
      return await fn();
    },
  };

  const doInstance = new SessionDO(state as unknown as DurableObjectState);

  return { doInstance, state, storage };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function validSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    id: overrides.id ?? "sess-1",
    user_id: overrides.user_id ?? "user-1",
    expires_at: overrides.expires_at ?? now + 60_000,
    created_at: overrides.created_at ?? now,
  };
}

function validOidcState(overrides: Partial<OIDCRecord> = {}): OIDCRecord {
  const now = Date.now();
  return {
    state: overrides.state ?? "oidc-1",
    nonce: overrides.nonce ?? "nonce-1",
    code_verifier: overrides.code_verifier ?? "verifier-1",
    return_to: overrides.return_to ?? "https://app.test/callback",
    expires_at: overrides.expires_at ?? now + 60_000,
    ...(overrides.cli_callback ? { cli_callback: overrides.cli_callback } : {}),
  };
}

Deno.test("SessionDO - returns 404 for unknown paths", async () => {
  const { doInstance } = createDo();
  await flushMicrotasks();

  const response = await doInstance.fetch(makeRequest("/unknown", {}));
  assertEquals(response.status, 404);
});

Deno.test("SessionDO - create/get session roundtrip persists the session", async () => {
  const { doInstance, storage, state } = createDo();
  await flushMicrotasks();

  const session = validSession();
  const createResponse = await doInstance.fetch(
    makeRequest("/session/create", { session }),
  );
  assertEquals(createResponse.status, 200);

  const getResponse = await doInstance.fetch(
    makeRequest("/session/get", { sessionId: session.id }),
  );
  const body = await readBody(getResponse);

  assertNotEquals(body.session, null);
  assertEquals((body.session as Record<string, unknown>).id, session.id);
  assertEquals(storage.putCalls.length, 1);
  assertEquals(state.blockConcurrencyCalls, 3);
});

Deno.test("SessionDO - creating the same live session twice reports existing and does not rewrite storage", async () => {
  const { doInstance, storage } = createDo();
  await flushMicrotasks();

  const session = validSession({ id: "existing" });
  await doInstance.fetch(makeRequest("/session/create", { session }));

  const response = await doInstance.fetch(
    makeRequest("/session/create", { session }),
  );
  const body = await readBody(response);

  assertEquals(body.success, true);
  assertEquals(body.existing, true);
  assertEquals(storage.putCalls.length, 1);
});

Deno.test("SessionDO - expired session is evicted on get and persisted", async () => {
  const { doInstance, storage } = createDo();
  await flushMicrotasks();

  const expired = validSession({
    id: "expired",
    expires_at: Date.now() - 1_000,
  });
  await doInstance.fetch(makeRequest("/session/create", { session: expired }));
  storage.putCalls.length = 0;

  const response = await doInstance.fetch(
    makeRequest("/session/get", { sessionId: "expired" }),
  );
  const body = await readBody(response);

  assertEquals(body.session, null);
  assertEquals(storage.putCalls.length, 1);
});

Deno.test("SessionDO - oidc state create/get/delete roundtrip works", async () => {
  const { doInstance, storage } = createDo();
  await flushMicrotasks();

  const oidcState = validOidcState({ state: "oidc-create" });
  await doInstance.fetch(makeRequest("/oidc-state/create", { oidcState }));

  const getResponse = await doInstance.fetch(
    makeRequest("/oidc-state/get", { state: "oidc-create" }),
  );
  const getBody = await readBody(getResponse);
  assertNotEquals(getBody.oidcState, null);
  assertEquals(
    (getBody.oidcState as Record<string, unknown>).state,
    "oidc-create",
  );

  const deleteResponse = await doInstance.fetch(
    makeRequest("/oidc-state/delete", { state: "oidc-create" }),
  );
  const deleteBody = await readBody(deleteResponse);
  assertEquals(deleteBody.success, true);
  assert(storage.putCalls.length >= 2);
});

Deno.test("SessionDO - alarm evicts expired records and reschedules when data remains", async () => {
  const { doInstance, storage } = createDo(null);
  await flushMicrotasks();

  const sessions =
    (doInstance as unknown as { sessions: Map<string, SessionRecord> })
      .sessions;
  const oidcStates =
    (doInstance as unknown as { oidcStates: Map<string, OIDCRecord> })
      .oidcStates;
  sessions.set(
    "expired-session",
    validSession({ id: "expired-session", expires_at: Date.now() - 1_000 }),
  );
  sessions.set(
    "live-session",
    validSession({ id: "live-session", expires_at: Date.now() + 60_000 }),
  );
  oidcStates.set(
    "expired-oidc",
    validOidcState({ state: "expired-oidc", expires_at: Date.now() - 1_000 }),
  );
  oidcStates.set(
    "live-oidc",
    validOidcState({ state: "live-oidc", expires_at: Date.now() + 60_000 }),
  );

  await doInstance.alarm();

  assertEquals(sessions.has("expired-session"), false);
  assertEquals(sessions.has("live-session"), true);
  assertEquals(oidcStates.has("expired-oidc"), false);
  assertEquals(oidcStates.has("live-oidc"), true);
  assert(storage.putCalls.length > 0);
  assert(storage.setAlarmCalls.length > 0);
});

Deno.test("SessionDO - constructor hydrates sessions and oidc states from storage", async () => {
  const { doInstance } = createDo(
    Date.now() + 60_000,
    {
      sessions: {
        "sess-1": validSession({ id: "sess-1" }),
      },
      oidcStates: {
        "oidc-1": validOidcState({ state: "oidc-1" }),
      },
    },
  );
  await flushMicrotasks();

  const sessionResponse = await doInstance.fetch(
    makeRequest("/session/get", { sessionId: "sess-1" }),
  );
  assertNotEquals((await readBody(sessionResponse)).session, null);

  const oidcResponse = await doInstance.fetch(
    makeRequest("/oidc-state/get", { state: "oidc-1" }),
  );
  assertNotEquals((await readBody(oidcResponse)).oidcState, null);
});

Deno.test("SessionDO - blockConcurrencyWhile wraps mutating operations", async () => {
  const { doInstance, state } = createDo();
  await flushMicrotasks();

  await doInstance.fetch(
    makeRequest("/session/create", {
      session: validSession({ id: "serialize" }),
    }),
  );
  await doInstance.fetch(
    makeRequest("/session/delete", { sessionId: "serialize" }),
  );
  await doInstance.fetch(
    makeRequest("/oidc-state/create", {
      oidcState: validOidcState({ state: "serialize-oidc" }),
    }),
  );

  assertEquals(state.blockConcurrencyCalls, 4);
});
