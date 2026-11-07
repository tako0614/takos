import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { isAppError } from "@takos/worker-platform-utils/errors";
import * as schema from "../../../../infra/db/schema.ts";
import type { Env, User } from "../../../../shared/types/index.ts";
import type { BaseVariables } from "../../route-auth.ts";
import { createRunSseRouter, guardSseStream } from "../sse.ts";
import { createPollingRunObservationStream, type RunObservation } from "../observation.ts";
import {
  createSseNotifierService,
  type SseNotifierService,
} from "../../../../worker-emulation/sse-notifier.ts";

// The authenticated user is synthetic; the router and its current Workspace
// authority checks run unchanged against the real schema in local SQLite.
const user: User = {
  id: "principal-a",
  email: "a@example.test",
  name: "Principal A",
  username: "principal-a",
  bio: null,
  picture: null,
  principal_kind: "user",
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-11-05T00:00:00.000Z",
  updated_at: "2026-11-05T00:00:00.000Z",
};

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  const directory = "./db/migrations-control/migrations";
  for (const file of (await readdir(directory)).filter((name) =>
    /^\d{4}_.*\.sql$/.test(name)
  ).sort()) {
    await client.executeMultiple(await readFile(`${directory}/${file}`, "utf8"));
  }
  await client.executeMultiple(`
    INSERT INTO accounts
      (id, type, status, name, slug, owner_account_id, created_at, updated_at)
    VALUES
      ('principal-a', 'user', 'active', 'Principal A', 'principal-a', NULL, 't0', 't0'),
      ('workspace-a', 'team', 'active', 'Workspace A', 'workspace-a', 'principal-a', 't0', 't0');
    INSERT INTO account_memberships
      (id, account_id, member_id, role, status, created_at, updated_at)
    VALUES ('membership-a', 'workspace-a', 'principal-a', 'owner', 'active', 't0', 't0');
    INSERT INTO threads (id, account_id, title, status, created_at, updated_at)
    VALUES ('thread-a', 'workspace-a', 'A thread', 'active', 't0', 't0');
    INSERT INTO runs (id, thread_id, account_id, status, input, usage, created_at)
    VALUES ('run-a', 'thread-a', 'workspace-a', 'running', '{}', '{}', 't0');
  `);

  const env = {
    DB: drizzle(client, { schema }),
    PLATFORM: { config: {}, bindings: {}, services: {} },
  } as unknown as Env & {
    PLATFORM: { services: { sseNotifier?: SseNotifierService } };
  };
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(error.toResponse(), error.statusCode as never);
    }
    throw error;
  });
  app.route("/api/runs", createRunSseRouter());
  const request = () => app.request("https://takos.test/api/runs/run-a/sse", {}, env);
  const revoke = () => client.execute(
    "UPDATE account_memberships SET status='revoked' WHERE id='membership-a'",
  );
  return { client, env, request, revoke };
}

test("polling Run SSE stops private output after the connected owner is revoked", async () => {
  const fixture = await createFixture();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fixture.request();
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      ": connected",
    );
    await fixture.revoke();
    expect((await fixture.request()).status).toBe(404);
    await fixture.client.execute(`
      INSERT INTO run_events (run_id, type, data, created_at)
      VALUES ('run-a', 'message', '{"content":"private-after-revoke"}', 't1')
    `);
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader?.cancel();
    fixture.client.close();
  }
});

test("notifier Run SSE preserves active delivery and stops output after revocation", async () => {
  const fixture = await createFixture();
  const notifier = await createSseNotifierService();
  fixture.env.PLATFORM!.services.sseNotifier = notifier;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fixture.request();
    expect(response.status).toBe(200);
    reader = response.body!.getReader();
    notifier.emit("run:run-a", {
      type: "message",
      data: { content: "active-owner-output" },
    });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "active-owner-output",
    );
    await fixture.revoke();
    expect((await fixture.request()).status).toBe(404);
    notifier.emit("run:run-a", {
      type: "message",
      data: { content: "private-after-revoke" },
    });
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader?.cancel();
    await notifier.dispose();
    fixture.client.close();
  }
});

test("SSE drops a chunk when authority is revoked during the upstream read", async () => {
  let authorized = true;
  let cancelled = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => started = resolve);
  const upstream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    pull() {
      started();
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const reader = guardSseStream(upstream, async () => authorized).getReader();
  const pending = reader.read();
  await reading;
  authorized = false;
  controller.enqueue(new TextEncoder().encode("private-after-revoke"));
  try {
    expect((await pending).done).toBe(true);
    expect(cancelled).toBe(true);
  } finally {
    await reader.cancel();
  }
});

test("polling SSE drops results when authority is revoked during the source read", async () => {
  let authorized = true;
  let started!: () => void;
  let finish!: (observation: RunObservation) => void;
  const reading = new Promise<void>((resolve) => started = resolve);
  const observation = new Promise<RunObservation>((resolve) => finish = resolve);
  const stream = createPollingRunObservationStream(async () => {
    started();
    return await observation;
  }, 0, { authorize: async () => authorized });
  const reader = stream.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    ": connected",
  );
  await reading;
  authorized = false;
  finish({
    events: [{
      id: 1,
      event_id: "1",
      run_id: "run-a",
      type: "completed",
      data: '{"content":"private-after-revoke"}',
      created_at: "t1",
    }],
    runStatus: "completed",
  });
  try {
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader.cancel();
  }
});

test("SSE authority failure cancels the upstream without releasing its chunk", async () => {
  const failure = new Error("synthetic authority unavailable");
  let checks = 0;
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("private-output"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const reader = guardSseStream(upstream, async () => {
    if (++checks === 1) return true;
    throw failure;
  }).getReader();
  await expect(reader.read()).rejects.toBe(failure);
  expect(cancelled).toBe(true);
  expect(upstream.locked).toBe(false);
});

test("cancelling SSE during an authority check leaves the upstream unread and unlocked", async () => {
  let started!: () => void;
  let finish!: (authorized: boolean) => void;
  let cancelled = false;
  let reads = 0;
  const checking = new Promise<void>((resolve) => started = resolve);
  const authority = new Promise<boolean>((resolve) => finish = resolve);
  const upstream = new ReadableStream<Uint8Array>({
    pull() {
      reads += 1;
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const reader = guardSseStream(upstream, async () => {
    started();
    return await authority;
  }).getReader();
  const pending = reader.read();
  await checking;
  await reader.cancel();
  finish(true);
  expect((await pending).done).toBe(true);
  expect(cancelled).toBe(true);
  expect(reads).toBe(0);
  expect(upstream.locked).toBe(false);
});
