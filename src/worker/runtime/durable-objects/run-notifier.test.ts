import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../infra/db/schema.ts";
import {
  getRunEventsAfterFromR2,
  buildRunEventSegmentKey,
  listRunEventSegmentIndexes,
  readRunEventSegmentFromR2,
  writeRunEventSegmentToR2,
} from "../../application/services/offload/run-events.ts";
import { createInMemoryObjectStore } from "../../local-platform/in-memory-r2.ts";
import { buildSanitizedDOHeaders } from "./do-header-utils.ts";
import { RunNotifierDO } from "./run-notifier.ts";

type RejectedOwnerWitness = {
  name: string;
  principalStatus: "active" | "suspended";
  ownerAccountId: "candidate" | "actual-owner";
  witnessRole: "owner" | "editor";
  witnessStatus: "active" | "suspended";
};

const rejectedOwnerWitnesses: RejectedOwnerWitness[] = [
  {
    name: "an editor witness",
    principalStatus: "active",
    ownerAccountId: "actual-owner",
    witnessRole: "editor",
    witnessStatus: "active",
  },
  {
    name: "a suspended owner witness",
    principalStatus: "active",
    ownerAccountId: "candidate",
    witnessRole: "owner",
    witnessStatus: "suspended",
  },
  {
    name: "a stale owner witness for another Principal's Workspace",
    principalStatus: "active",
    ownerAccountId: "actual-owner",
    witnessRole: "owner",
    witnessStatus: "active",
  },
  {
    name: "an owner witness for a suspended Principal",
    principalStatus: "suspended",
    ownerAccountId: "candidate",
    witnessRole: "owner",
    witnessStatus: "active",
  },
];

const acceptedOwnerWitness: RejectedOwnerWitness = {
  name: "the active canonical owner",
  principalStatus: "active",
  ownerAccountId: "candidate",
  witnessRole: "owner",
  witnessStatus: "active",
};

function createDurableObjectState(values = new Map<string, unknown>()) {
  let pending: Promise<unknown> = Promise.resolve();
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        const value = values.get(key);
        return value === undefined ? undefined : structuredClone(value) as T;
      },
      async put(
        keyOrEntries: string | Record<string, unknown>,
        value?: unknown,
      ): Promise<void> {
        if (typeof keyOrEntries === "string") {
          values.set(keyOrEntries, structuredClone(value));
          return;
        }
        for (const [key, entry] of Object.entries(keyOrEntries)) {
          values.set(key, structuredClone(entry));
        }
      },
      async setAlarm(): Promise<void> {},
      async getAlarm(): Promise<number | null> {
        return null;
      },
    },
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const operation = Promise.resolve().then(callback);
      pending = operation;
      return operation;
    },
    getWebSockets(): WebSocket[] {
      return [];
    },
    getTags(_webSocket: WebSocket): string[] {
      return [];
    },
    acceptWebSocket(_webSocket: WebSocket, _tags?: string[]): void {},
  };
  return {
    binding: state as never,
    values,
    ready: () => pending,
  };
}

async function createNotifierFixture(
  witness: RejectedOwnerWitness,
  options: {
    bucket?: ReturnType<typeof createInMemoryObjectStore>;
    storageValues?: Map<string, unknown>;
  } = {},
) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      last_event_id INTEGER
    );
  `);
  await client.batch([
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES (?, 'user', ?, 'Candidate', 'candidate', ?, 't0', 't0')`,
      args: [
        "candidate",
        witness.principalStatus,
        "candidate",
      ],
    },
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES ('actual-owner', 'user', 'active', 'Actual owner', 'actual-owner', 'actual-owner', 't0', 't0')`,
      args: [],
    },
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES ('workspace', 'team', 'active', 'Workspace', 'workspace', ?, 't0', 't0')`,
      args: [witness.ownerAccountId],
    },
    {
      sql: `INSERT INTO account_memberships
        (id, account_id, member_id, role, status, created_at, updated_at)
        VALUES ('candidate-witness', 'workspace', 'candidate', ?, ?, 't0', 't0')`,
      args: [witness.witnessRole, witness.witnessStatus],
    },
    {
      sql: `INSERT INTO account_memberships
        (id, account_id, member_id, role, status, created_at, updated_at)
        VALUES ('actual-owner-witness', 'workspace', 'actual-owner', 'owner', 'active', 't0', 't0')`,
      args: [],
    },
    {
      sql: "INSERT INTO runs (id, account_id) VALUES ('run-1', 'workspace')",
      args: [],
    },
  ]);

  const db = drizzle(client, { schema });
  const state = createDurableObjectState(options.storageValues);
  const notifier = new RunNotifierDO(state.binding, {
    DB: db,
    ...(options.bucket ? { TAKOS_OFFLOAD: options.bucket } : {}),
  } as never);
  await state.ready();
  return { client, notifier, bucket: options.bucket, storageValues: state.values, db };
}

async function emitRunEvent(
  notifier: RunNotifierDO,
  eventId: number,
  type = "run.progress",
): Promise<void> {
  const response = await notifier.fetch(
    new Request("https://run-notifier.test/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        data: { sequence: eventId, payload: `event-${eventId}` },
        ...(eventId === 1 ? { runId: "run-1" } : {}),
      }),
    }),
  );
  expect(response.status).toBe(200);
}

async function expectArchivedRunEvents(
  bucket: ReturnType<typeof createInMemoryObjectStore>,
): Promise<void> {
  expect(await listRunEventSegmentIndexes(bucket, "run-1")).toContain(1);
  expect((await readRunEventSegmentFromR2(bucket, "run-1", 1))?.map((e) => e.event_id))
    .toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
  expect((await readRunEventSegmentFromR2(bucket, "run-1", 2))?.map((e) => e.event_id))
    .toEqual(Array.from({ length: 50 }, (_, index) => index + 101));
  const events = await getRunEventsAfterFromR2(bucket, "run-1", 0, 250);
  expect(events.map((event) => event.event_id)).toEqual(
    Array.from({ length: 200 }, (_, index) => index + 1),
  );
  expect(events.map((event) => JSON.parse(event.data).sequence)).toEqual(
    Array.from({ length: 200 }, (_, index) => index + 1),
  );
  expect(events.map((event) => JSON.parse(event.data).payload)).toEqual(
    Array.from({ length: 200 }, (_, index) => `event-${index + 1}`),
  );
  expect((await getRunEventsAfterFromR2(bucket, "run-1", 150, 17)).map((e) => e.event_id))
    .toEqual(Array.from({ length: 17 }, (_, index) => index + 151));
  expect((await getRunEventsAfterFromR2(bucket, "run-1", 167, 17)).map((e) => e.event_id))
    .toEqual(Array.from({ length: 17 }, (_, index) => index + 168));
}

async function primeNotifierRunId(
  notifier: RunNotifierDO,
  runId = "run-1",
): Promise<void> {
  const emitted = await notifier.fetch(
    new Request("https://run-notifier.test/emit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "run.progress",
        data: { message: "ready" },
        runId,
      }),
    }),
  );
  expect(emitted.status).toBe(200);
}

for (const witness of rejectedOwnerWitnesses) {
  test(`Run WebSocket rejects ${witness.name}`, async () => {
    const { client, notifier } = await createNotifierFixture(witness);
    try {
      const response = await notifier.fetch(
        new Request("https://run-notifier.test/websocket", {
          headers: {
            Upgrade: "websocket",
            "X-WS-Auth-Validated": "true",
            "X-WS-User-Id": "candidate",
            "X-WS-Run-Id": "run-1",
          },
        }),
      );
      expect(response.status).toBe(403);
    } finally {
      client.close();
    }
  });
}

test("Run WebSocket rejects a cold handshake without an exact run identity", async () => {
  const { client, notifier } = await createNotifierFixture(
    rejectedOwnerWitnesses[0],
  );
  try {
    const response = await notifier.fetch(
      new Request("https://run-notifier.test/websocket", {
        headers: {
          Upgrade: "websocket",
          "X-WS-Auth-Validated": "true",
          "X-WS-User-Id": "actual-owner",
        },
      }),
    );
    expect(response.status).toBe(400);
  } finally {
    client.close();
  }
});

test("Run WebSocket rejects a handshake whose run identity mismatches the bound Durable Object", async () => {
  const { client, notifier } = await createNotifierFixture(
    rejectedOwnerWitnesses[0],
  );
  try {
    await primeNotifierRunId(notifier);
    const response = await notifier.fetch(
      new Request("https://run-notifier.test/websocket", {
        headers: {
          Upgrade: "websocket",
          "X-WS-Auth-Validated": "true",
          "X-WS-User-Id": "actual-owner",
          "X-WS-Run-Id": "run-2",
        },
      }),
    );
    expect(response.status).toBe(403);
  } finally {
    client.close();
  }
});

test("Run WebSocket binds a cold Durable Object to the proven owner's exact run before any emit", async () => {
  const { client, notifier } = await createNotifierFixture(
    acceptedOwnerWitness,
  );
  const globals = globalThis as typeof globalThis & {
    WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket };
  };
  const previousWebSocketPair = globals.WebSocketPair;
  class MockWebSocket {
    send(_data: string | ArrayBuffer): void {}
    close(_code?: number, _reason?: string): void {}
  }
  globals.WebSocketPair = class {
    0 = new MockWebSocket() as WebSocket;
    1 = new MockWebSocket() as WebSocket;
  };

  try {
    const response = await notifier.fetch(
      new Request("https://run-notifier.test/websocket", {
        headers: {
          Upgrade: "websocket",
          "X-WS-Auth-Validated": "true",
          "X-WS-User-Id": "candidate",
          "X-WS-Run-Id": "run-1",
        },
      }),
    );
    expect(response.status).toBe(101);

    const state = await notifier.fetch(
      new Request("https://run-notifier.test/state"),
    );
    expect(await state.json()).toMatchObject({ runId: "run-1" });
  } finally {
    if (previousWebSocketPair) {
      globals.WebSocketPair = previousWebSocketPair;
    } else {
      delete globals.WebSocketPair;
    }
    client.close();
  }
});

test("Run WebSocket transport strips forged run identity and injects the route run id", async () => {
  const stripped = new Headers(buildSanitizedDOHeaders(
    { "X-WS-Run-Id": "forged-run" },
    {
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": "principal-1",
    },
  ));
  expect(stripped.get("X-WS-Run-Id")).toBeNull();

  const bound = new Headers(buildSanitizedDOHeaders(
    { "X-WS-Run-Id": "forged-run" },
    {
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": "principal-1",
      "X-WS-Run-Id": "route-run",
    },
  ));
  expect(bound.get("X-WS-Run-Id")).toBe("route-run");

  const routeSource = await Bun.file(
    `${import.meta.dir}/../../server/routes/runs/routes.ts`,
  ).text();
  expect(routeSource).toContain('"X-WS-Run-Id": runId');
});

test("R2 run-event offload retains post-terminal events through the next segment boundary", async () => {
  const bucket = createInMemoryObjectStore();
  const { client, notifier } = await createNotifierFixture(
    acceptedOwnerWitness,
    { bucket },
  );
  try {
    for (let eventId = 1; eventId <= 150; eventId += 1) {
      const type = eventId === 150 ? "completed" : "run.progress";
      await emitRunEvent(notifier, eventId, type);
    }
    const closedSegmentKey = buildRunEventSegmentKey("run-1", 2);
    const closedSegmentBefore = await bucket.get(closedSegmentKey);
    expect(closedSegmentBefore).not.toBeNull();
    const closedSegmentBytesBefore = await closedSegmentBefore!.arrayBuffer();

    for (let eventId = 151; eventId <= 200; eventId += 1) {
      await emitRunEvent(notifier, eventId, "run.progress");
    }

    const closedSegmentAfter = await bucket.get(closedSegmentKey);
    expect(closedSegmentAfter).not.toBeNull();
    expect(Array.from(new Uint8Array(await closedSegmentAfter!.arrayBuffer())))
      .toEqual(Array.from(new Uint8Array(closedSegmentBytesBefore)));

    await expectArchivedRunEvents(bucket);
  } finally {
    client.close();
  }
});

test("R2 run-event offload loads a persisted legacy buffer without losing its pending events", async () => {
  const bucket = createInMemoryObjectStore();
  const persistedEvent = (eventId: number, type = "run.progress") => ({
    event_id: eventId,
    type,
    data: JSON.stringify({ sequence: eventId, payload: `event-${eventId}` }),
    created_at: `t-event-${eventId}`,
  });
  await writeRunEventSegmentToR2(
    bucket,
    "run-1",
    1,
    Array.from({ length: 100 }, (_, index) => persistedEvent(index + 1)),
  );
  await writeRunEventSegmentToR2(
    bucket,
    "run-1",
    2,
    [
      ...Array.from({ length: 49 }, (_, index) => persistedEvent(index + 101)),
      persistedEvent(150, "completed"),
    ],
  );
  const pendingLegacyEvents = Array.from({ length: 49 }, (_, index) =>
    persistedEvent(index + 151)
  );
  const serializedStorage = new Map<string, unknown>([["bufferState", {
    eventBuffer: [],
    eventIdCounter: 199,
    runId: "run-1",
    r2SegmentIndex: 2,
    r2SegmentBuffer: pendingLegacyEvents,
    r2LastFlushedSegmentIndex: 2,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
  }]]);
  const { client, notifier } = await createNotifierFixture(
    acceptedOwnerWitness,
    { bucket, storageValues: structuredClone(serializedStorage) },
  );
  try {
    await emitRunEvent(notifier, 200, "run.progress");

    await expectArchivedRunEvents(bucket);
  } finally {
    client.close();
  }
});

test("R2 run-event offload survives a real cold replacement after a mid-segment terminal event", async () => {
  const bucket = createInMemoryObjectStore();
  const { client, notifier, storageValues, db } = await createNotifierFixture(
    acceptedOwnerWitness,
    { bucket },
  );
  try {
    for (let eventId = 1; eventId <= 150; eventId += 1) {
      await emitRunEvent(
        notifier,
        eventId,
        eventId === 150 ? "completed" : "run.progress",
      );
    }

    const replacementState = createDurableObjectState(
      structuredClone(storageValues),
    );
    const replacement = new RunNotifierDO(replacementState.binding, {
      DB: db,
      TAKOS_OFFLOAD: bucket,
    } as never);
    await replacementState.ready();
    for (let eventId = 151; eventId <= 200; eventId += 1) {
      await emitRunEvent(replacement, eventId, "run.progress");
    }

    await expectArchivedRunEvents(bucket);
  } finally {
    client.close();
  }
});

test("R2 run-event offload retains events when terminal events arrive consecutively", async () => {
  const bucket = createInMemoryObjectStore();
  const { client, notifier } = await createNotifierFixture(
    acceptedOwnerWitness,
    { bucket },
  );
  try {
    for (let eventId = 1; eventId <= 200; eventId += 1) {
      await emitRunEvent(
        notifier,
        eventId,
        eventId === 150 || eventId === 151 ? "completed" : "run.progress",
      );
    }

    await expectArchivedRunEvents(bucket);
  } finally {
    client.close();
  }
});

test("R2 run-event offload retries a failed boundary write without losing buffered events", async () => {
  const bucket = createInMemoryObjectStore();
  const segmentThreeKey = buildRunEventSegmentKey("run-1", 3);
  let failNextSegmentThreePut = false;
  let injectedFailureCount = 0;
  const flakyBucket = {
    ...bucket,
    async put(...args: Parameters<typeof bucket.put>) {
      const [key] = args;
      if (key === segmentThreeKey && failNextSegmentThreePut) {
        failNextSegmentThreePut = false;
        injectedFailureCount += 1;
        throw new Error("injected segment-three write failure");
      }
      return bucket.put(...args);
    },
  } as ReturnType<typeof createInMemoryObjectStore>;
  const { client, notifier } = await createNotifierFixture(
    acceptedOwnerWitness,
    { bucket: flakyBucket },
  );
  try {
    for (let eventId = 1; eventId <= 150; eventId += 1) {
      await emitRunEvent(
        notifier,
        eventId,
        eventId === 150 ? "completed" : "run.progress",
      );
    }
    failNextSegmentThreePut = true;
    await emitRunEvent(notifier, 151, "completed");
    expect(injectedFailureCount).toBe(1);
    for (let eventId = 152; eventId <= 200; eventId += 1) {
      await emitRunEvent(notifier, eventId, "run.progress");
    }

    const events = await getRunEventsAfterFromR2(bucket, "run-1", 0, 250);
    expect(events.map((event) => event.event_id)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
    expect(events.map((event) => JSON.parse(event.data).sequence)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
  } finally {
    client.close();
  }
});
