import type { Env } from "@/types";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  connectWorkflowRunStream,
  workflowRunStreamDeps,
} from "@/services/workflow-runs/stream";

function buildDrizzleMock(selectGet: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.get = async () => selectGet;
  return {
    select: () => chain,
  };
}

function makeWebSocketResponse(): Response {
  const response = new Response("ws-stream", { status: 200 });
  Object.defineProperty(response, "status", { value: 101 });
  return response;
}

function makeEnv(options: { runNotifier?: boolean } = {}): Env {
  const fetchSpy = spy(async () => makeWebSocketResponse());
  const notifier = { fetch: fetchSpy };
  const notifierGet = spy(() => notifier);
  const notifierIdFromName = spy(() => "do-id-1");

  return {
    DB: {} as Env["DB"],
    RUN_NOTIFIER: options.runNotifier
      ? {
        idFromName: notifierIdFromName,
        get: notifierGet,
        fetchSpy,
      }
      : undefined,
  } as unknown as Env;
}

function makeRequest(
  upgrade: boolean,
  url = "https://api.example.com/ws",
): Request {
  const headers = new Headers();
  if (upgrade) {
    headers.set("Upgrade", "websocket");
  }
  return new Request(url, { headers });
}

function withStreamDb<T>(drizzle: unknown, fn: () => Promise<T>) {
  const previous = workflowRunStreamDeps.getDb;
  workflowRunStreamDeps.getDb = () => drizzle as never;
  return fn().finally(() => {
    workflowRunStreamDeps.getDb = previous;
  });
}

Deno.test("connectWorkflowRunStream returns 404 when the run is missing", async () => {
  await withStreamDb(buildDrizzleMock(null), async () => {
    const response = await connectWorkflowRunStream(
      makeEnv({ runNotifier: true }),
      {
        repoId: "repo-1",
        runId: "missing",
        userId: "user-1",
        request: makeRequest(true),
      },
    );

    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: "Run not found" });
  });
});

Deno.test("connectWorkflowRunStream returns 426 when the request is not a websocket upgrade", async () => {
  await withStreamDb(buildDrizzleMock({ id: "run-1" }), async () => {
    const response = await connectWorkflowRunStream(
      makeEnv({ runNotifier: true }),
      {
        repoId: "repo-1",
        runId: "run-1",
        userId: "user-1",
        request: makeRequest(false),
      },
    );

    assertEquals(response.status, 426);
    assertEquals(await response.json(), {
      error: "Expected WebSocket upgrade",
    });
  });
});

Deno.test("connectWorkflowRunStream proxies valid requests to the notifier durable object", async () => {
  const env = makeEnv({ runNotifier: true });
  const request = makeRequest(true, "https://api.example.com/ws/run-1");

  await withStreamDb(buildDrizzleMock({ id: "run-1" }), async () => {
    const response = await connectWorkflowRunStream(env, {
      repoId: "repo-1",
      runId: "run-1",
      userId: "user-1",
      request,
    });

    assertEquals(response.status, 101);
  });

  const notifier = env.RUN_NOTIFIER as unknown as {
    idFromName: ReturnType<typeof spy>;
    get: ReturnType<typeof spy>;
  };
  assertSpyCalls(notifier.idFromName, 1);
  assertSpyCalls(notifier.get, 1);

  const fetchSpy =
    (env.RUN_NOTIFIER as unknown as { fetchSpy: ReturnType<typeof spy> })
      .fetchSpy;
  assertSpyCalls(fetchSpy, 1);
  const [url, init] = fetchSpy.calls[0].args as [string, RequestInit];
  assertEquals(url, "https://api.example.com/ws/run-1");
  assertEquals(init.method, "GET");
  const forwardedHeaders = new Headers(init.headers);
  assertEquals(forwardedHeaders.get("X-WS-Auth-Validated"), "true");
  assertEquals(forwardedHeaders.get("X-WS-User-Id"), "user-1");
});

Deno.test("connectWorkflowRunStream uses anonymous when userId is missing", async () => {
  const env = makeEnv({ runNotifier: true });
  const request = makeRequest(true);

  await withStreamDb(buildDrizzleMock({ id: "run-1" }), async () => {
    await connectWorkflowRunStream(env, {
      repoId: "repo-1",
      runId: "run-1",
      userId: null,
      request,
    });
  });

  const fetchSpy =
    (env.RUN_NOTIFIER as unknown as { fetchSpy: ReturnType<typeof spy> })
      .fetchSpy;
  const [, init] = fetchSpy.calls[0].args as [string, RequestInit];
  const forwardedHeaders = new Headers(init.headers);
  assertEquals(forwardedHeaders.get("X-WS-User-Id"), "anonymous");
});

Deno.test("connectWorkflowRunStream uses anonymous when userId is undefined", async () => {
  const env = makeEnv({ runNotifier: true });
  const request = makeRequest(true);

  await withStreamDb(buildDrizzleMock({ id: "run-1" }), async () => {
    await connectWorkflowRunStream(env, {
      repoId: "repo-1",
      runId: "run-1",
      userId: undefined,
      request,
    });
  });

  const fetchSpy =
    (env.RUN_NOTIFIER as unknown as { fetchSpy: ReturnType<typeof spy> })
      .fetchSpy;
  const [, init] = fetchSpy.calls[0].args as [string, RequestInit];
  const forwardedHeaders = new Headers(init.headers);
  assertEquals(forwardedHeaders.get("X-WS-User-Id"), "anonymous");
});
