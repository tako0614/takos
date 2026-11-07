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
  const sockets: WebSocket[] = [];
  const tagsBySocket = new WeakMap<WebSocket, string[]>();
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
      return sockets;
    },
    getTags(webSocket: WebSocket): string[] {
      return tagsBySocket.get(webSocket) ?? [];
    },
    acceptWebSocket(webSocket: WebSocket, tags?: string[]): void {
      sockets.push(webSocket);
      tagsBySocket.set(webSocket, tags ?? []);
    },
  };
  return {
    binding: state as never,
    ready: () => pending,
    forgetUserTags() {
      for (const ws of sockets) {
        tagsBySocket.set(ws, (tagsBySocket.get(ws) ?? []).filter((tag) =>
          !tag.startsWith("ws-user:")
        ));
      }
    },
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
  const env = { DB: db } as never;
  const notifier = new RunNotifierDO(state.binding, env);
  await state.ready();
  return { client, notifier, state, env };
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

test("an established Run WebSocket closes before output after Workspace authority is revoked", async () => {
  const { client, notifier } = await createNotifierFixture(acceptedOwnerWitness);
  const globals = globalThis as typeof globalThis & {
    WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket };
  };
  const previousWebSocketPair = globals.WebSocketPair;
  const serverMessages: string[] = [];
  let closeCount = 0;
  const closeCodes: Array<number | undefined> = [];
  class MockWebSocket {
    send(data: string | ArrayBuffer): void {
      serverMessages.push(typeof data === "string" ? data : "binary");
    }
    close(code?: number, _reason?: string): void {
      closeCount += 1;
      closeCodes.push(code);
    }
  }
  globals.WebSocketPair = class {
    0 = new MockWebSocket() as WebSocket;
    1 = new MockWebSocket() as WebSocket;
  };

  try {
    const connected = await notifier.fetch(
      new Request("https://run-notifier.test/websocket", {
        headers: {
          Upgrade: "websocket",
          "X-WS-Auth-Validated": "true",
          "X-WS-User-Id": "candidate",
          "X-WS-Run-Id": "run-1",
        },
      }),
    );
    expect(connected.status).toBe(101);

    const activeEmit = await notifier.fetch(
      new Request("https://run-notifier.test/emit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "message",
          data: { content: "synthetic-active-owner-output" },
          runId: "run-1",
        }),
      }),
    );
    expect(activeEmit.status).toBe(200);
    expect(await activeEmit.json()).toMatchObject({ clients: 1 });
    expect(serverMessages.join("\n")).toContain("synthetic-active-owner-output");

    await client.execute(
      "UPDATE account_memberships SET status='revoked' WHERE id='candidate-witness'",
    );

    const rejectedReconnect = await notifier.fetch(
      new Request("https://run-notifier.test/websocket", {
        headers: {
          Upgrade: "websocket",
          "X-WS-Auth-Validated": "true",
          "X-WS-User-Id": "candidate",
          "X-WS-Run-Id": "run-1",
        },
      }),
    );
    expect(rejectedReconnect.status).toBe(403);

    const emitted = await notifier.fetch(
      new Request("https://run-notifier.test/emit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "message",
          data: { content: "synthetic-private-output-after-revocation" },
          runId: "run-1",
        }),
      }),
    );
    expect(emitted.status).toBe(200);
    expect(await emitted.json()).toMatchObject({ clients: 0 });
    expect(serverMessages.join("\n")).not.toContain(
      "synthetic-private-output-after-revocation",
    );
    expect(closeCount).toBe(1);
    // Match the client's existing auth-close policy instead of triggering a
    // transport reconnect and another read for a known authority rejection.
    expect(closeCodes).toEqual([1008]);
  } finally {
    if (previousWebSocketPair) {
      globals.WebSocketPair = previousWebSocketPair;
    } else {
      delete globals.WebSocketPair;
    }
    client.close();
  }
});

for (const failure of ["restored active owner", "restored revoked owner", "legacy identity tags", "database unavailable", "missing run"]) {
  test(`Run WebSocket restores delivery only for current authority: ${failure}`, async () => {
    const fixture = await createNotifierFixture(acceptedOwnerWitness);
    const globals = globalThis as typeof globalThis & {
      WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket };
    };
    const previousPair = globals.WebSocketPair;
    const messages: string[] = [];
    const closes: Array<number | undefined> = [];
    class FixtureSocket {
      send(value: string | ArrayBuffer) {
        messages.push(String(value));
      }
      close(code?: number) {
        closes.push(code);
      }
    }
    globals.WebSocketPair = class {
      0 = new FixtureSocket() as WebSocket;
      1 = new FixtureSocket() as WebSocket;
    };
    try {
      expect((await fixture.notifier.fetch(
        new Request("https://run-notifier.test/websocket", {
          headers: {
            Upgrade: "websocket",
            "X-WS-Auth-Validated": "true",
            "X-WS-User-Id": "candidate",
            "X-WS-Run-Id": "run-1",
          },
        }),
      )).status).toBe(101);
      if (failure === "restored revoked owner") {
        await fixture.client.execute(
          "UPDATE account_memberships SET status='revoked' WHERE id='candidate-witness'",
        );
      } else if (failure === "legacy identity tags") {
        fixture.state.forgetUserTags();
      } else if (failure === "missing run") {
        await fixture.client.execute("DELETE FROM runs WHERE id='run-1'");
      }
      // Restore only through the existing platform state/tags boundary. This
      // fixture is not Cloudflare hibernation or native runtime qualification.
      const restored = new RunNotifierDO(fixture.state.binding, fixture.env);
      await fixture.state.ready();
      if (failure === "database unavailable") fixture.client.close();
      const response = await restored.fetch(
        new Request("https://run-notifier.test/emit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "message",
            data: { content: "private-after-restore" },
            runId: "run-1",
          }),
        }),
      );
      expect(response.status).toBe(200);
      if (failure === "restored active owner") {
        expect(await response.json()).toMatchObject({ clients: 1 });
        expect(messages.join("\n")).toContain("private-after-restore");
        expect(closes).toHaveLength(0);
      } else {
        expect(await response.json()).toMatchObject({ clients: 0 });
        expect(messages.join("\n")).not.toContain("private-after-restore");
        expect(closes).toHaveLength(1);
        if (failure === "restored revoked owner") expect(closes[0]).toBe(1008);
      }
    } finally {
      if (previousPair) globals.WebSocketPair = previousPair;
      else delete globals.WebSocketPair;
      fixture.client.close();
    }
  });
}

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
