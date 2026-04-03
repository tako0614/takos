import { assertEquals } from "jsr:@std/assert";
import type { FileHandler } from "../../../views/storage/storageUtils.tsx";

const {
  buildStorageNavigationState,
  loadStorageFileHandlers,
  resolveStorageInitialPath,
  shouldEmitStoragePathChange,
} = await import("../../../views/storage/storage-page-state.ts");

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

Deno.test("resolveStorageInitialPath - prefers file parent path", () => {
  assertEquals(
    resolveStorageInitialPath("/docs", "/docs/README.md"),
    "/docs",
  );
});

Deno.test("shouldEmitStoragePathChange - waits for initial load", () => {
  assertEquals(
    shouldEmitStoragePathChange("/", "/docs", undefined, false),
    false,
  );
});

Deno.test("shouldEmitStoragePathChange - emits only after load and path change", () => {
  assertEquals(
    shouldEmitStoragePathChange("/docs", "/docs", undefined, true),
    false,
  );
  assertEquals(
    shouldEmitStoragePathChange("/images", "/docs", undefined, true),
    true,
  );
});

Deno.test("buildStorageNavigationState - clears stale route state", () => {
  assertEquals(buildStorageNavigationState("ws-1", "/"), {
    view: "storage",
    spaceId: "ws-1",
    storagePath: "/",
    filePath: undefined,
    fileLine: undefined,
    threadId: undefined,
    runId: undefined,
    messageId: undefined,
    username: undefined,
    repoId: undefined,
    repoName: undefined,
    appId: undefined,
    workerId: undefined,
    deploySection: undefined,
    storeTab: undefined,
    shareToken: undefined,
    legalPage: undefined,
    oauthQuery: undefined,
    spaceSlug: undefined,
    workspaceSlug: undefined,
  });
});

Deno.test("loadStorageFileHandlers - ignores stale responses", async () => {
  type MockResponse = {
    ok: boolean;
    json: () => Promise<{ handlers?: FileHandler[] }>;
  };

  const responses = {
    "space-a": createDeferred<MockResponse>(),
    "space-b": createDeferred<MockResponse>(),
  };
  let latestRequestVersion = 1;

  const fetchImpl = (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/space-a/")) return responses["space-a"].promise;
    if (url.includes("/space-b/")) return responses["space-b"].promise;
    throw new Error(`unexpected request url: ${url}`);
  };

  const firstRequest = loadStorageFileHandlers(
    "space-a",
    () => latestRequestVersion === 1,
    fetchImpl as typeof fetch,
  );
  latestRequestVersion = 2;
  const secondRequest = loadStorageFileHandlers(
    "space-b",
    () => latestRequestVersion === 2,
    fetchImpl as typeof fetch,
  );

  responses["space-b"].resolve({
    ok: true,
    json: async () => ({
      handlers: [{
        id: "current-handler",
        name: "Current Handler",
        mime_types: [],
        extensions: [],
        open_url: "https://example.com/current",
      }],
    }),
  });
  assertEquals(await secondRequest, [{
    id: "current-handler",
    name: "Current Handler",
    mime_types: [],
    extensions: [],
    open_url: "https://example.com/current",
  }]);

  responses["space-a"].resolve({
    ok: true,
    json: async () => ({
      handlers: [{
        id: "stale-handler",
        name: "Stale Handler",
        mime_types: [],
        extensions: [],
        open_url: "https://example.com/stale",
      }],
    }),
  });
  assertEquals(await firstRequest, null);
});
