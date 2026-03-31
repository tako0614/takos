import { CloudflareStateRefreshProvider } from "../src/lib/state/cloudflare-refresh-provider.ts";
import { refreshState } from "../src/lib/state/refresh.ts";
import type { RefreshableProvider } from "../src/lib/state/refresh.ts";
import type { TakosState } from "../src/lib/state/state-types.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";

function makeState(overrides: Partial<TakosState> = {}): TakosState {
  return {
    version: 1,
    provider: "cloudflare",
    env: "staging",
    group: "default",
    groupName: "test-group",
    updatedAt: "2026-01-01T00:00:00Z",
    resources: {},
    workers: {},
    containers: {},
    services: {},
    routes: {},
    ...overrides,
  };
}

Deno.test("refreshState - removes confirmed missing resources and workers", async () => {
  const provider: RefreshableProvider = {
    async checkResourceExists(
      type: string,
      id: string,
    ): Promise<boolean | null> {
      if (type === "d1" && id === "missing-db") return false;
      if (type === "worker" && id === "missing-worker") return false;
      return true;
    },
  };

  const state = makeState({
    resources: {
      db: {
        type: "d1",
        id: "missing-db",
        binding: "DB",
        createdAt: "2026-01-01T00:00:00Z",
      },
      cache: {
        type: "kv",
        id: "live-kv",
        binding: "CACHE",
        createdAt: "2026-01-01T00:00:00Z",
      },
      token: {
        type: "secretRef",
        id: "secret-value",
        binding: "TOKEN",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    workers: {
      web: {
        scriptName: "missing-worker",
        deployedAt: "2026-01-01T00:00:00Z",
        codeHash: "sha256:1",
      },
    },
    containers: {
      api: {
        deployedAt: "2026-01-01T00:00:00Z",
        imageHash: "sha256:container",
      },
    },
    services: {
      backend: {
        deployedAt: "2026-01-01T00:00:00Z",
        imageHash: "sha256:service",
        ipv4: "10.0.0.1",
      },
    },
    routes: {
      home: { target: "workers.web", path: "/" },
    },
  });

  const result = await refreshState(state, provider);

  assertEquals(state.resources.db, undefined);
  assert(state.resources.cache !== undefined);
  assertEquals(state.workers.web, undefined);
  assertEquals(
    result.changes.some((change) =>
      change.key === "resources.db" && change.action === "removed"
    ),
    true,
  );
  assertEquals(
    result.changes.some((change) =>
      change.key === "workers.web" && change.action === "removed"
    ),
    true,
  );
  assertEquals(
    result.changes.some((change) =>
      change.key === "resources.token" && change.action === "warning"
    ),
    true,
  );
  assertEquals(
    result.changes.some((change) =>
      change.key === "containers.api" && change.action === "warning"
    ),
    true,
  );
  assertEquals(
    result.changes.some((change) =>
      change.key === "services.backend" && change.action === "warning"
    ),
    true,
  );
  assertEquals(
    result.changes.some((change) =>
      change.key === "routes.home" && change.action === "warning"
    ),
    true,
  );
});

Deno.test("refreshState - does not delete entries when verification is unavailable", async () => {
  const provider: RefreshableProvider = {
    async checkResourceExists(): Promise<boolean | null> {
      return null;
    },
  };

  const state = makeState({
    resources: {
      db: {
        type: "d1",
        id: "db-id",
        binding: "DB",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    workers: {
      web: {
        scriptName: "web-script",
        deployedAt: "2026-01-01T00:00:00Z",
        codeHash: "sha256:1",
      },
    },
  });

  const result = await refreshState(state, provider);

  assert(state.resources.db !== undefined);
  assert(state.workers.web !== undefined);
  assertEquals(
    result.changes.map(({ key, action }) => ({ key, action })),
    [
      { key: "resources.db", action: "warning" },
      { key: "workers.web", action: "warning" },
    ],
  );
});

Deno.test("CloudflareStateRefreshProvider - checks the Cloudflare endpoints used by state refresh", async () => {
  const fetchMock = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/workers/scripts/missing-worker")) {
      return new Response("", { status: 404 });
    }
    return new Response("", { status: 200 });
  };

  const fetchSpy = stub(globalThis, "fetch", fetchMock);
  try {
    const provider = new CloudflareStateRefreshProvider(
      "acct-123",
      "token-456",
    );

    assertEquals(await provider.checkResourceExists("d1", "db-1", "db"), true);
    assertEquals(
      await provider.checkResourceExists("r2", "bucket-name", "bucket"),
      true,
    );
    assertEquals(
      await provider.checkResourceExists("kv", "namespace-id", "cache"),
      true,
    );
    assertEquals(
      await provider.checkResourceExists("queue", "task-queue", "queue"),
      true,
    );
    assertEquals(
      await provider.checkResourceExists("vectorize", "embeddings", "vector"),
      true,
    );
    assertEquals(
      await provider.checkResourceExists("worker", "missing-worker", "web"),
      false,
    );
    assertEquals(
      await provider.checkResourceExists("secretRef", "secret-value", "secret"),
      null,
    );

    assertSpyCalls(fetchSpy, 6);
    assertSpyCallArgs(fetchSpy, 0, [
      "https://api.cloudflare.com/client/v4/accounts/acct-123/d1/database/db-1",
      {
        method: "GET",
        headers: { Authorization: "Bearer token-456" },
      },
    ]);
    assertSpyCallArgs(fetchSpy, 1, [
      "https://api.cloudflare.com/client/v4/accounts/acct-123/r2/buckets/bucket-name",
      {
        method: "GET",
        headers: { Authorization: "Bearer token-456" },
      },
    ]);
    assertSpyCallArgs(fetchSpy, 2, [
      "https://api.cloudflare.com/client/v4/accounts/acct-123/storage/kv/namespaces/namespace-id",
      {
        method: "GET",
        headers: { Authorization: "Bearer token-456" },
      },
    ]);
    assertSpyCallArgs(fetchSpy, 3, [
      "https://api.cloudflare.com/client/v4/accounts/acct-123/queues/task-queue",
      {
        method: "GET",
        headers: { Authorization: "Bearer token-456" },
      },
    ]);
    assertSpyCallArgs(fetchSpy, 4, [
      "https://api.cloudflare.com/client/v4/accounts/acct-123/vectorize/v2/indexes/embeddings",
      {
        method: "GET",
        headers: { Authorization: "Bearer token-456" },
      },
    ]);
    assertSpyCallArgs(fetchSpy, 5, [
      "https://api.cloudflare.com/client/v4/accounts/acct-123/workers/scripts/missing-worker",
      {
        method: "GET",
        headers: { Authorization: "Bearer token-456" },
      },
    ]);
  } finally {
    fetchSpy.restore();
  }
});
