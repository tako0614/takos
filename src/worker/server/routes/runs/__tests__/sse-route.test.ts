import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { BaseVariables } from "../../route-auth.ts";
import { AppError } from "@takos/worker-platform-utils/errors";
import { createSseNotifierService } from "../../../../worker-emulation/sse-notifier.ts";
import { createRunSseRouter } from "../sse.ts";
import { MAX_EVENTS_PER_RESPONSE } from "../../../../shared/config/limits.ts";
import { gzipCompressString } from "../../../../shared/utils/gzip.ts";

async function fixture(
  withNotifier = true,
  indexedMessage?: { content: string },
) {
  const client = createClient({ url: ":memory:" });
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });
  // Derive fixture columns from the real schema; no migrations or production
  // data are involved. Populate the fields required by real route/access code.
  for (const table of [
    schema.accounts,
    schema.accountMemberships,
    schema.runs,
    schema.runEvents,
  ]) {
    const config = getTableConfig(table);
    await client.execute(
      `CREATE TABLE "${config.name}" (${config.columns
        .map(
          (column) =>
            `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`,
        )
        .join(", ")})`,
    );
  }
  const createdAt = "2026-09-30T00:00:00.000Z";
  await db.insert(schema.accounts).values([
    {
      id: "owner",
      type: "user",
      status: "active",
      name: "Owner",
      slug: "owner",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "other",
      type: "user",
      status: "active",
      name: "Other",
      slug: "other",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "workspace",
      type: "team",
      status: "active",
      name: "Workspace",
      slug: "workspace",
      ownerAccountId: "owner",
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  await db.insert(schema.accountMemberships).values({
    id: "owner-witness",
    accountId: "workspace",
    memberId: "owner",
    role: "owner",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  });
  await db.insert(schema.runs).values({
    id: "run-restarted",
    threadId: "thread",
    accountId: "workspace",
    requesterAccountId: "owner",
    agentType: "default",
    status: "completed",
    lastEventId: 43,
    input: "{}",
    usage: "{}",
    leaseVersion: 0,
    createdAt,
    completedAt: createdAt,
  });
  await db.insert(schema.runEvents).values([
    {
      id: 41,
      runId: "run-restarted",
      type: "run.started",
      data: '{"status":"running"}',
      createdAt,
    },
    {
      id: 42,
      runId: "run-restarted",
      type: "message",
      data: '{"content":"persisted answer"}',
      createdAt,
    },
    {
      id: 43,
      runId: "run-restarted",
      type: "completed",
      data: '{"status":"completed"}',
      createdAt,
    },
  ]);
  // A fresh notifier represents the process after restart: SQL survives,
  // process-local notification history does not.
  const notifier = withNotifier ? await createSseNotifierService() : undefined;
  const archiveEvent = indexedMessage
    ? {
        event_id: 42,
        type: "message",
        data: JSON.stringify({ content: indexedMessage.content }),
        created_at: createdAt,
      }
    : undefined;
  const archiveBytes = archiveEvent
    ? new Uint8Array(await gzipCompressString(`${JSON.stringify(archiveEvent)}\n`))
    : undefined;
  const archiveKey = "runs/run-restarted/events/000001.jsonl.gz";
  const archiveDigest = archiveBytes
    ? Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", archiveBytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
    : undefined;
  const runNotifier = archiveEvent && archiveBytes && archiveDigest
    ? {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (request: Request) => {
            const url = new URL(request.url);
            expect(url.pathname).toBe("/archive");
            expect(url.searchParams.get("runId")).toBe("run-restarted");
            return Response.json({
              schemaVersion: 1,
              runId: "run-restarted",
              descriptors: [{
                key: archiveKey,
                segmentIndex: 1,
                firstEventId: 42,
                lastEventId: 42,
                count: 1,
                sha256: archiveDigest,
                bytes: archiveBytes.byteLength,
              }],
              pending: [],
              hasMore: false,
            });
          },
        }),
      }
    : undefined;
  const env = {
    DB: db,
    ...(runNotifier ? { RUN_NOTIFIER: runNotifier } : {}),
    ...(archiveBytes
      ? {
          TAKOS_OFFLOAD: {
            list: async () => {
              throw new Error("indexed replay must not list R2");
            },
            get: async (key: string) => key === archiveKey
              ? {
                  key,
                  size: archiveBytes.byteLength,
                  body: new Blob([archiveBytes]).stream(),
                  arrayBuffer: async () => archiveBytes.slice().buffer,
                }
              : null,
          },
        }
      : {}),
    PLATFORM: {
      source: "node",
      bindings: {},
      config: {},
      services: { sseNotifier: notifier },
    },
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: c.req.header("X-Test-Principal") ?? "owner",
    } as BaseVariables["user"]);
    await next();
  });
  app.onError(
    (error) =>
      new Response(
        JSON.stringify(
          error instanceof AppError
            ? error.toResponse()
            : { error: String(error) },
        ),
        {
          status: error instanceof AppError ? error.statusCode : 500,
          headers: { "Content-Type": "application/json" },
        },
      ),
  );
  app.route("/api/runs", createRunSseRouter());
  return {
    db,
    queries,
    notifier,
    request: (query = "", headers?: Record<string, string>) =>
      app.request(`/api/runs/run-restarted/sse${query}`, { headers }, env),
    async close() {
      await notifier?.dispose();
      client.close();
    },
  };
}

async function readTerminalStream(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        for (;;) {
          const result = await reader.read();
          if (result.done) return;
          chunks.push(result.value);
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("terminal SSE did not close")),
          500,
        );
      }),
    ]);
    return chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
  } finally {
    clearTimeout(timeout);
    await reader.cancel();
  }
}

test("Node SSE replays durable completion after notifier restart and closes", async () => {
  const f = await fixture();
  try {
    const text = await readTerminalStream(
      await f.request("", { "Last-Event-ID": "41" }),
    );
    expect(text).not.toContain("id: 41\n");
    expect(text).toContain(
      'id: 42\nevent: message\ndata: {"content":"persisted answer"}',
    );
    expect(text).toContain("id: 43\nevent: completed");
    expect(text.indexOf("id: 42\n")).toBeLessThan(text.indexOf("id: 43\n"));
  } finally {
    await f.close();
  }
});

test("Node SSE replays indexed archive history and keeps SQL terminal fallback", async () => {
  const f = await fixture(true, { content: "indexed archived answer" });
  try {
    const text = await readTerminalStream(
      await f.request("", { "Last-Event-ID": "41" }),
    );
    expect(text).toContain(
      'id: 42\nevent: message\ndata: {"content":"indexed archived answer"}',
    );
    expect(text).toContain("id: 43\nevent: completed");
  } finally {
    await f.close();
  }
});

test("Node SSE closes an already terminal run with no events after its cursor", async () => {
  const f = await fixture();
  try {
    const text = await readTerminalStream(
      await f.request("?last_event_id=41", { "Last-Event-ID": "43" }),
    );
    expect(text).not.toContain("id:");
  } finally {
    await f.close();
  }
});

test("Node SSE retains durable history after ring eviction and ignores notifier-only frames", async () => {
  const f = await fixture();
  try {
    for (let id = 42; id < 1044; id += 1) {
      f.notifier!.emit("run:run-restarted", {
        event_id: id,
        type: "progress",
        data: { message: "notifier-only" },
      });
    }
    const text = await readTerminalStream(await f.request("?last_event_id=41"));
    expect(text).toContain("id: 42\nevent: message");
    expect(text).toContain("id: 43\nevent: completed");
    expect(text).not.toContain("notifier-only");
    expect(text).not.toContain("id: 1043");
  } finally {
    await f.close();
  }
});

test("SSE without a notifier uses the same durable replay and query cursor", async () => {
  const f = await fixture(false);
  try {
    const text = await readTerminalStream(await f.request("?last_event_id=42"));
    expect(text).not.toContain("id: 42\n");
    expect(text).toContain("id: 43\nevent: completed");
  } finally {
    await f.close();
  }
});

test("SSE replay retains the existing Workspace access boundary", async () => {
  const f = await fixture();
  try {
    const response = await f.request("", { "X-Test-Principal": "other" });
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toBe("text/event-stream");
  } finally {
    await f.close();
  }
});

test("terminal SSE replays every bounded page in order before closing", async () => {
  const f = await fixture();
  try {
    await f.db.delete(schema.runEvents);
    const count = MAX_EVENTS_PER_RESPONSE + 5;
    for (let offset = 0; offset < count; offset += 200) {
      await f.db.insert(schema.runEvents).values(
        Array.from({ length: Math.min(200, count - offset) }, (_, index) => {
          const id = offset + index + 1;
          return {
            id,
            runId: "run-restarted",
            type: id === count ? "completed" : "progress",
            data:
              id === count
                ? '{"status":"completed"}'
                : JSON.stringify({ step: id }),
            createdAt: "2026-09-30T00:00:00Z",
          };
        }),
      );
    }
    const text = await readTerminalStream(await f.request("?last_event_id=3"));
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) =>
      Number(match[1]),
    );
    expect(ids).toEqual(
      Array.from({ length: count - 3 }, (_, index) => index + 4),
    );
    expect(text).toContain(`id: ${count}\nevent: completed`);
    const reads = f.queries.filter(
      ({ sql }) =>
        sql.startsWith("select") && sql.includes('from "run_events"'),
    );
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.sql).toMatch(/limit \?$/);
      expect(read.params.at(-1)).toBe(MAX_EVENTS_PER_RESPONSE + 1);
    }
  } finally {
    await f.close();
  }
});
