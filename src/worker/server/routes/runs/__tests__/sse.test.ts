import { expect, test } from "bun:test";
import { assertStringIncludes } from "@takos/test/assert";
import {
  createPollingRunObservationStream,
  type RunObservation,
} from "../observation.ts";

test("run SSE polling stream emits buffered events and closes on terminal status", async () => {
  const observedCursor: number[] = [];
  let callCount = 0;

  const stream = createPollingRunObservationStream(
    async (afterEventId) => {
      observedCursor.push(afterEventId);
      callCount += 1;

      if (callCount === 1) {
        return {
          events: [
            {
              id: 7,
              event_id: "7",
              run_id: "run-123",
              type: "run.started",
              data: '{"status":"running"}',
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          runStatus: "running",
        };
      }

      return {
        events: [],
        runStatus: "completed",
      };
    },
    0,
    { pollIntervalMs: 0, heartbeatIntervalMs: 0 },
  );

  const text = await new Response(stream).text();

  assertStringIncludes(text, ": connected");
  assertStringIncludes(text, "id: 7");
  assertStringIncludes(text, "event: run.started");
  assertStringIncludes(text, 'data: {"status":"running"}');
  assertStringIncludes(JSON.stringify(observedCursor), "[0,7]");
});

test("run SSE polling stream closes after emitting a terminal event", async () => {
  const observedCursor: number[] = [];
  const stream = createPollingRunObservationStream(
    async (afterEventId) => {
      observedCursor.push(afterEventId);
      return {
        events: [
          {
            id: 9,
            event_id: "9",
            run_id: "run-123",
            type: "completed",
            data: '{"status":"completed"}',
            created_at: "2026-01-01T00:00:01.000Z",
          },
        ],
        runStatus: "completed",
      };
    },
    0,
    { pollIntervalMs: 0, heartbeatIntervalMs: 0 },
  );

  const text = await new Response(stream).text();

  assertStringIncludes(text, "id: 9");
  assertStringIncludes(text, "event: completed");
  assertStringIncludes(JSON.stringify(observedCursor), "[0]");
});

function notificationFixture() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      cancellations += 1;
    },
  });
  return {
    stream,
    notify: () =>
      controller.enqueue(
        new TextEncoder().encode("id: 999\nevent: completed\ndata: forged\n\n"),
      ),
    fail: () => controller.error(new Error("notification channel lost")),
    cancellations: () => cancellations,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function completion(): RunObservation {
  return {
    events: [
      {
        id: 9,
        event_id: "9",
        run_id: "run-123",
        type: "completed",
        data: '{"answer":"durable"}',
        created_at: "2026-09-30T00:00:00Z",
      },
    ],
    runStatus: "completed",
  };
}

async function readPromptly(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        let text = "";
        for (;;) {
          const result = await reader.read();
          if (result.done) return text;
          text += new TextDecoder().decode(result.value);
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("SSE missed the wakeup")),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
}

test("run SSE notifications wake a sleeping durable read without replaying notification bytes", async () => {
  const notifications = notificationFixture();
  const firstRead = deferred<void>();
  const cursors: number[] = [];
  let committed = false;
  const stream = createPollingRunObservationStream(
    async (cursor) => {
      cursors.push(cursor);
      firstRead.resolve();
      return committed ? completion() : { events: [], runStatus: "running" };
    },
    7,
    { pollIntervalMs: 30_000, notifications: notifications.stream },
  );
  const text = readPromptly(stream);
  await firstRead.promise;
  // Let the initial empty observation reach its sleep before delivery.
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  committed = true;
  notifications.notify();
  expect(await text).toContain(
    'id: 9\nevent: completed\ndata: {"answer":"durable"}',
  );
  expect(await text).not.toContain("forged");
  expect(cursors).toEqual([7, 7]);
  expect(notifications.cancellations()).toBe(1);
});

test("run SSE does not lose a notification delivered during the initial durable query", async () => {
  const notifications = notificationFixture();
  const initialObservation = deferred<RunObservation>();
  let calls = 0;
  const stream = createPollingRunObservationStream(
    async () => {
      calls += 1;
      return calls === 1 ? initialObservation.promise : completion();
    },
    0,
    { pollIntervalMs: 30_000, notifications: notifications.stream },
  );
  const text = readPromptly(stream);
  notifications.notify();
  initialObservation.resolve({ events: [], runStatus: "running" });
  expect(await text).toContain("id: 9\nevent: completed");
  expect(calls).toBe(2);
  expect(notifications.cancellations()).toBe(1);
});

test("run SSE keeps polling durable events after notification failure", async () => {
  const notifications = notificationFixture();
  let calls = 0;
  const stream = createPollingRunObservationStream(
    async () => {
      calls += 1;
      return calls === 1 ? { events: [], runStatus: "running" } : completion();
    },
    0,
    { pollIntervalMs: 0, notifications: notifications.stream },
  );
  notifications.fail();
  expect(await readPromptly(stream)).toContain("id: 9\nevent: completed");
  expect(calls).toBe(2);
});

test("run SSE cancels the notification subscription when durable observation fails", async () => {
  const notifications = notificationFixture();
  const stream = createPollingRunObservationStream(
    async () => {
      throw new Error("durable store unavailable");
    },
    0,
    { notifications: notifications.stream },
  );
  await expect(readPromptly(stream)).rejects.toThrow(
    "durable store unavailable",
  );
  expect(notifications.cancellations()).toBe(1);
});

test("run SSE disconnect during a pending query releases the subscription and stops polling", async () => {
  const notifications = notificationFixture();
  const pending = deferred<RunObservation>();
  let calls = 0;
  const stream = createPollingRunObservationStream(
    async () => {
      calls += 1;
      return pending.promise;
    },
    0,
    { pollIntervalMs: 0, notifications: notifications.stream },
  );
  const reader = stream.getReader();
  await reader.read(); // connected comment
  await reader.cancel();
  pending.resolve(completion());
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  expect(calls).toBe(1);
  expect(notifications.cancellations()).toBe(1);
});

test("run SSE respects slow reader demand instead of reading all subsequent pages", async () => {
  const notifications = notificationFixture();
  let calls = 0;
  const stream = createPollingRunObservationStream(
    async () => {
      calls += 1;
      return { ...completion(), hasMore: true };
    },
    0,
    { notifications: notifications.stream },
  );
  const reader = stream.getReader();
  await reader.read(); // connected comment; permit one frame to be prefetched
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  expect(calls).toBe(1);
  await reader.cancel();
  expect(notifications.cancellations()).toBe(1);
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  expect(calls).toBe(1);
});

test("run SSE disconnect while sleeping wakes and retires the pending poll", async () => {
  const notifications = notificationFixture();
  const firstRead = deferred<void>();
  let calls = 0;
  const stream = createPollingRunObservationStream(
    async () => {
      calls += 1;
      firstRead.resolve();
      return { events: [], runStatus: "running" };
    },
    0,
    { pollIntervalMs: 30_000, notifications: notifications.stream },
  );
  const reader = stream.getReader();
  await reader.read();
  const pendingRead = reader.read();
  await firstRead.promise;
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  await reader.cancel();
  expect((await pendingRead).done).toBe(true);
  expect(calls).toBe(1);
  expect(notifications.cancellations()).toBe(1);
});
