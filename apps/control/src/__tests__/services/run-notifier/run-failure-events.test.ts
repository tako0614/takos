import type { Env } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  notifyRunFailedEvent,
  type PersistedRunFailedEvent,
  persistRunFailedEvent,
  runFailureEventDeps,
} from "@/services/run-notifier/run-failure-events";

Deno.test("run-failure-events helpers - persists run.failed event when offload is disabled", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const originalGetDb = runFailureEventDeps.getDb;
  // Production code: db.insert(runEvents).values({...}).returning({id: runEvents.id}).get()
  const valuesCapture = spy((..._args: any[]) => undefined);
  const insertGet = () => ({ id: 42 });
  const insertChain = {
    values: (data: unknown) => {
      valuesCapture(data);
      return insertChain;
    },
    returning: () => ({ get: insertGet }),
  };
  runFailureEventDeps.getDb = (() => ({
    insert: () => insertChain,
  })) as unknown as typeof runFailureEventDeps.getDb;

  try {
    const env = createMockEnv({ TAKOS_OFFLOAD: undefined }) as unknown as Env;
    const createdAt = "2026-02-27T00:00:00.000Z";

    const event = await persistRunFailedEvent(env, "run-1", {
      error: "boom",
      createdAt,
      permanent: true,
      sessionId: "sess-1",
    });

    assertEquals(event.eventId, 42);
    assertEquals(event.payload, {
      status: "failed",
      run: {
        id: "run-1",
        session_id: "sess-1",
      },
      error: "boom",
      permanent: true,
    });

    assertSpyCalls(valuesCapture, 1);
    const inserted = (valuesCapture.calls[0] as any).args[0] as {
      runId: string;
      type: string;
      data: string;
      createdAt: string;
    };
    assertEquals(inserted.runId, "run-1");
    assertEquals(inserted.type, "run.failed");
    assertEquals(inserted.createdAt, createdAt);
    assertEquals(JSON.parse(inserted.data), event.payload);
  } finally {
    runFailureEventDeps.getDb = originalGetDb;
  }
});
Deno.test("run-failure-events helpers - skips D1 event persistence when offload is enabled", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const originalGetDb = runFailureEventDeps.getDb;
  const runEventCreate = spy(async () => ({ id: 7 }));
  runFailureEventDeps.getDb = (() => ({
    runEvent: { create: runEventCreate },
  })) as unknown as typeof runFailureEventDeps.getDb;

  try {
    const env = createMockEnv({
      TAKOS_OFFLOAD: { enabled: true },
    }) as unknown as Env;

    const event = await persistRunFailedEvent(env, "run-2", {
      error: "queue failed",
      createdAt: "2026-02-27T00:00:01.000Z",
    });

    assertEquals(event.eventId, null);
    assertEquals(event.payload.status, "failed");
    assertSpyCalls(runEventCreate, 0);
  } finally {
    runFailureEventDeps.getDb = originalGetDb;
  }
});
Deno.test("run-failure-events helpers - notifies run notifier with event_id when present", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const fetchSpy = spy(async () => new Response("ok"));
  const runNotifier = {
    idFromName: () => ({ toString: () => "run-3" }),
    get: () => ({ fetch: fetchSpy }),
  };
  const env = createMockEnv({ RUN_NOTIFIER: runNotifier }) as unknown as Env;

  const event: PersistedRunFailedEvent = {
    payload: {
      status: "failed",
      run: { id: "run-3", session_id: "sess-3" },
      error: "fatal",
      permanent: true,
    },
    eventId: 99,
  };

  await notifyRunFailedEvent(env, "run-3", event);

  assertSpyCalls(fetchSpy, 1);
  const request = (fetchSpy.calls[0] as any).args[0] as Request;
  const body = await request.json() as Record<string, unknown>;
  assertEquals(body, {
    runId: "run-3",
    type: "run.failed",
    data: event.payload,
    event_id: 99,
  });
});
Deno.test("run-failure-events helpers - omits event_id when no persisted id exists", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const fetchSpy = spy(async () => new Response("ok"));
  const runNotifier = {
    idFromName: () => ({ toString: () => "run-4" }),
    get: () => ({ fetch: fetchSpy }),
  };
  const env = createMockEnv({ RUN_NOTIFIER: runNotifier }) as unknown as Env;

  const event: PersistedRunFailedEvent = {
    payload: {
      status: "failed",
      run: { id: "run-4", session_id: null },
      error: "fatal",
    },
    eventId: null,
  };

  await notifyRunFailedEvent(env, "run-4", event);

  const request = (fetchSpy.calls[0] as any).args[0] as Request;
  const body = await request.json() as Record<string, unknown>;
  assertEquals(body, {
    runId: "run-4",
    type: "run.failed",
    data: event.payload,
  });
});
