import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import type { FileHandler } from "../../../views/storage/storageUtils.tsx";

const {
  buildStorageNavigationState,
  loadStorageFileHandlers,
  resolveStorageInitialPath,
  shouldEmitStoragePathChange,
} = await import("../../../views/storage/storage-page-state.ts");
const { buildFileHandlerLaunchUrl } = await import(
  "../../../views/storage/fileHandlerUrls.ts"
);

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
        open_url: "https://example.com/current/:id",
      }],
    }),
  });
  assertEquals(await secondRequest, [{
    id: "current-handler",
    name: "Current Handler",
    mime_types: [],
    extensions: [],
    open_url: "https://example.com/current/:id",
  }]);

  responses["space-a"].resolve({
    ok: true,
    json: async () => ({
      handlers: [{
        id: "stale-handler",
        name: "Stale Handler",
        mime_types: [],
        extensions: [],
        open_url: "https://example.com/stale/:id",
      }],
    }),
  });
  assertEquals(await firstRequest, null);
});

Deno.test("loadStorageFileHandlers - includes current file mime and ext query params", async () => {
  const requestedUrls: string[] = [];

  const fetchImpl = async (input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return {
      ok: true,
      json: async () => ({
        handlers: [],
      }),
    };
  };

  await loadStorageFileHandlers(
    "space-a",
    () => true,
    fetchImpl as typeof fetch,
    {
      name: "README.md",
      mime_type: "text/markdown",
    },
  );

  assertEquals(requestedUrls.length, 1);
  assertStringIncludes(
    requestedUrls[0],
    "/api/spaces/space-a/storage/file-handlers?",
  );
  assertStringIncludes(requestedUrls[0], "mime=text%2Fmarkdown");
  assertStringIncludes(requestedUrls[0], "ext=.md");
});

Deno.test("buildFileHandlerLaunchUrl - replaces :id path template with file id", () => {
  const url = buildFileHandlerLaunchUrl(
    {
      open_url: "https://docs.example.com/files/:id#edit",
    },
    {
      id: "file 1",
      space_id: "ws-1",
    },
    "fallback-space",
  );

  assertEquals(
    url,
    "https://docs.example.com/files/file%201?space_id=ws-1#edit",
  );
});

Deno.test("buildFileHandlerLaunchUrl - requires :id in the path", () => {
  assertThrows(
    () =>
      buildFileHandlerLaunchUrl(
        {
          open_url: "https://docs.example.com/open?next=:id",
        },
        {
          id: "file 1",
          space_id: "ws-1",
        },
        "fallback-space",
      ),
    Error,
    "FileHandler open_url must include :id in the path",
  );
});
