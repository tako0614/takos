import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../infra/db/schema.ts";
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

function createDurableObjectState() {
  const values = new Map<string, unknown>();
  let pending: Promise<unknown> = Promise.resolve();
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put(
        keyOrEntries: string | Record<string, unknown>,
        value?: unknown,
      ): Promise<void> {
        if (typeof keyOrEntries === "string") {
          values.set(keyOrEntries, value);
          return;
        }
        for (const [key, entry] of Object.entries(keyOrEntries)) {
          values.set(key, entry);
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
    ready: () => pending,
  };
}

async function createNotifierFixture(witness: RejectedOwnerWitness) {
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
  const state = createDurableObjectState();
  const notifier = new RunNotifierDO(state.binding, { DB: db } as never);
  await state.ready();
  return { client, notifier };
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
