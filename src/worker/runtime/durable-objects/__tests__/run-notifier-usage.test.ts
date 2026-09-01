import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../infra/db/schema.ts";
import {
  readUsageEventArchiveFromR2,
  USAGE_EVENT_SEGMENT_SIZE,
} from "../../../application/services/offload/usage-events.ts";
import type {
  DurableObjectStateBinding,
  ObjectStoreBinding,
} from "../../../shared/types/bindings.ts";
import type { Env } from "../../../shared/types/index.ts";
import { RunNotifierDO } from "../run-notifier.ts";

const encoder = new TextEncoder();

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  let rejectUsageSegments = false;
  const bucket = {
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView) {
      if (rejectUsageSegments && /\/usage\/\d+\.jsonl\.gz$/u.test(key)) {
        throw new Error("test object store outage");
      }
      const bytes = typeof value === "string"
        ? encoder.encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(
            value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            ),
          );
      objects.set(key, bytes);
      return null;
    },
    async get(key: string) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        size: value.byteLength,
        async arrayBuffer() {
          return value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          );
        },
        async text() {
          return new TextDecoder().decode(value);
        },
      };
    },
  } as unknown as ObjectStoreBinding;
  return {
    bucket,
    setRejectUsageSegments(value: boolean) {
      rejectUsageSegments = value;
    },
  };
}

function memoryState() {
  const values = new Map<string, unknown>();
  const state = {
    storage: {
      async get<T>(key: string) {
        const value = values.get(key);
        return value === undefined ? undefined : structuredClone(value) as T;
      },
      async put(key: string, value: unknown) {
        values.set(key, structuredClone(value));
      },
    },
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
    getWebSockets: () => [],
    getTags: () => [],
    acceptWebSocket: () => {},
  } as unknown as DurableObjectStateBinding;
  return { state, values };
}

async function createNotifier(options: { rejectUsageSegments?: boolean } = {}) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      last_event_id INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO runs (id, last_event_id) VALUES ('run_1', 0);
  `);
  const store = memoryBucket();
  store.setRejectUsageSegments(options.rejectUsageSegments ?? false);
  const state = memoryState();
  const notifier = new RunNotifierDO(state.state, {
    DB: drizzle(client, { schema }),
    TAKOS_OFFLOAD: store.bucket,
  } as unknown as Env);
  // Let the constructor's persisted-state restoration finish before the first
  // request; the production runtime provides the same constructor barrier.
  await Promise.resolve();
  await Promise.resolve();
  return { client, notifier, state, store };
}

function usageRequest(
  body: Record<string, unknown>,
): Request {
  return new Request("https://internal.do/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function emitCompleted(notifier: RunNotifierDO): Promise<Response> {
  return notifier.fetch(new Request("https://internal.do/emit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "run_1",
      type: "completed",
      data: { status: "completed" },
      dedup_key: "run:run_1:terminal",
    }),
  }));
}

test("Run notifier validates usage before binding its Run identity", async () => {
  const fixture = await createNotifier();
  try {
    const invalidUnits = await fixture.notifier.fetch(usageRequest({
      runId: "poison_run",
      meter_type: "exec_seconds",
      units: "1",
    }));
    expect(invalidUnits.status).toBe(400);

    const valid = await fixture.notifier.fetch(usageRequest({
      runId: "run_1",
      meter_type: "exec_seconds",
      units: 1,
      metadata: { endpoint: "tool" },
    }));
    expect(valid.status).toBe(200);

    const mismatch = await fixture.notifier.fetch(usageRequest({
      runId: "another_run",
      meter_type: "exec_seconds",
      units: 1,
    }));
    expect(mismatch.status).toBe(400);
  } finally {
    fixture.client.close();
  }
});

test("Run terminal event publishes a complete bounded usage archive last", async () => {
  const fixture = await createNotifier();
  try {
    for (let index = 0; index < 202; index += 1) {
      const response = await fixture.notifier.fetch(usageRequest({
        runId: "run_1",
        meter_type: "exec_seconds",
        units: index + 1,
        reference_type: "run",
        metadata: { index },
      }));
      expect(response.status).toBe(200);
    }

    expect((await emitCompleted(fixture.notifier)).status).toBe(200);
    const archive = await readUsageEventArchiveFromR2(
      fixture.store.bucket,
      "run_1",
      { maxEvents: 202 },
    );
    expect(archive.complete).toBe(true);
    expect(archive.events).toHaveLength(202);
    expect(archive.events[0]?.units).toBe(1);
    expect(archive.events.at(-1)?.units).toBe(202);

    const late = await fixture.notifier.fetch(usageRequest({
      runId: "run_1",
      meter_type: "exec_seconds",
      units: 1,
    }));
    expect(late.status).toBe(409);
  } finally {
    fixture.client.close();
  }
});

test("Run notifier backpressures before an R2 outage can grow usage state", async () => {
  const fixture = await createNotifier({ rejectUsageSegments: true });
  try {
    for (let index = 0; index < USAGE_EVENT_SEGMENT_SIZE; index += 1) {
      const response = await fixture.notifier.fetch(usageRequest({
        runId: "run_1",
        meter_type: "exec_seconds",
        units: 1,
      }));
      expect(response.status).toBe(200);
    }
    const rejected = await fixture.notifier.fetch(usageRequest({
      runId: "run_1",
      meter_type: "exec_seconds",
      units: 1,
    }));
    expect(rejected.status).toBe(503);
    const persisted = fixture.state.values.get("bufferState") as {
      usageSegmentBuffer: unknown[];
      usageEventCount: number;
    };
    expect(persisted.usageSegmentBuffer).toHaveLength(
      USAGE_EVENT_SEGMENT_SIZE,
    );
    expect(persisted.usageEventCount).toBe(USAGE_EVENT_SEGMENT_SIZE);

    fixture.store.setRejectUsageSegments(false);
    const recovered = await fixture.notifier.fetch(usageRequest({
      runId: "run_1",
      meter_type: "exec_seconds",
      units: 1,
    }));
    expect(recovered.status).toBe(200);
    expect((await emitCompleted(fixture.notifier)).status).toBe(200);
    const archive = await readUsageEventArchiveFromR2(
      fixture.store.bucket,
      "run_1",
      { maxEvents: USAGE_EVENT_SEGMENT_SIZE + 1 },
    );
    expect(archive.complete).toBe(true);
    expect(archive.events).toHaveLength(USAGE_EVENT_SEGMENT_SIZE + 1);
  } finally {
    fixture.client.close();
  }
});
