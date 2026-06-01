import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import { sourceInstallationKey } from "../../hooks/sourceInstall.ts";
import { useSourceFetchActions } from "../../hooks/useSourceFetchActions.ts";
import { useSourceFetchQueries } from "../../hooks/useSourceFetchQueries.ts";
import type { SourceItem } from "../../hooks/useSourceData.ts";
import { test } from "bun:test";


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeItem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "repo-1",
    name: "demo",
    description: null,
    visibility: "public",
    default_branch: "main",
    updated_at: "2026-04-01T00:00:00.000Z",
    stars: 0,
    forks: 0,
    is_starred: false,
    is_mine: false,
    catalog_origin: "repository",
    owner: {
      name: "Acme",
      username: "acme",
      avatar_url: null,
    },
    package: {
      available: true,
      app_id: "demo",
      latest_version: "1.0.0",
      latest_tag: "v1.0.0",
      release_tag: "v1.0.0",
      asset_id: null,
      tags: [],
      downloads: 0,
      certified: false,
      description: null,
      icon: null,
    },
    source: {
      kind: "git_ref",
      repository_url: "https://github.com/acme/demo.git",
      ref: "main",
      ref_type: "branch",
      env: "staging",
    },
    ...overrides,
  };
}

test(
  "source install state - fetchAll trusts catalog installation data",
  async () => {
    const originalFetch = globalThis.fetch;
    let installationReadbackCalls = 0;
    let dispose: (() => void) | undefined;
    let items!: () => SourceItem[];
    let queries!: ReturnType<typeof useSourceFetchQueries>;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/explore/catalog")) {
        return Promise.resolve(jsonResponse({
          items: [{
            repo: {
              id: "repo-1",
              name: "demo",
              description: null,
              visibility: "public",
              default_branch: "main",
              stars: 0,
              forks: 0,
              category: "app",
              language: "TypeScript",
              license: null,
              is_starred: false,
              created_at: "2026-04-01T00:00:00.000Z",
              updated_at: "2026-04-01T00:00:00.000Z",
              space: { id: "space-1", name: "Personal" },
              owner: {
                id: "owner-1",
                name: "Acme",
                username: "acme",
                avatar_url: null,
              },
              catalog_origin: "repository",
            },
            package: {
              available: true,
              app_id: "demo",
              latest_version: "1.0.0",
              latest_tag: "v1.0.0",
              release_id: "rel-1",
              release_tag: "v1.0.0",
              asset_id: null,
              description: null,
              icon: null,
              category: "app",
              tags: [],
              downloads: 0,
              rating_avg: null,
              rating_count: 0,
              publish_status: "approved",
              certified: true,
              published_at: "2026-04-01T00:00:00.000Z",
            },
            source: {
              kind: "git_ref",
              repository_url: "https://github.com/acme/demo.git",
              ref: "main",
              ref_type: "branch",
              env: "staging",
            },
            installation: {
              installed: false,
              group_id: null,
              group_name: null,
              installed_version: null,
              installed_commit: null,
              deployed_at: null,
            },
          }],
          total: 1,
          has_more: false,
        }));
      }
      if (url.includes("/app-installations")) {
        installationReadbackCalls += 1;
        return Promise.resolve(jsonResponse({ installations: [] }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [debouncedQuery] = createSignal("");
        const [sort] = createSignal("updated");
        const [category] = createSignal("");
        const [itemsSignal, setItems] = createSignal<SourceItem[]>([]);
        const [, setLoading] = createSignal(false);
        const [, setHasMore] = createSignal(false);
        const [, setTotal] = createSignal(0);
        const [, setSelectedItem] = createSignal<SourceItem | null>(null);
        items = itemsSignal;
        queries = useSourceFetchQueries({
          isAuthenticated,
          effectiveSpaceId,
          debouncedQuery,
          sort,
          category,
          setItems,
          setLoading,
          setHasMore,
          setTotal,
          setSelectedItem,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
        });
      });

      await queries.fetchAll();

      assertEquals(items()[0]?.installation, {
        installed: false,
        group_id: null,
        group_name: null,
        installed_version: null,
        installed_commit: null,
        deployed_at: null,
      });
      assertEquals(installationReadbackCalls, 0);
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "source install state - fetchInstallations keeps the newest AppInstallation",
  async () => {
    const originalFetch = globalThis.fetch;
    let dispose: (() => void) | undefined;
    let queries!: ReturnType<typeof useSourceFetchQueries>;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/app-installations")) {
        return Promise.resolve(jsonResponse({
          installations: [
            {
              id: "inst-new",
              app_id: "demo",
              status: "ready",
              created_at: "2026-04-03T00:00:00.000Z",
              updated_at: "2026-04-03T00:00:00.000Z",
              source: {
                resolved_repo_id: "repo-1",
                gitUrl: "https://github.com/acme/demo.git",
                ref: "main",
                commit: "newsha",
              },
            },
            {
              id: "inst-old",
              app_id: "demo",
              status: "ready",
              created_at: "2026-04-01T00:00:00.000Z",
              updated_at: "2026-04-01T00:00:00.000Z",
              source: {
                resolved_repo_id: "repo-1",
                gitUrl: "https://github.com/acme/demo.git",
                ref: "main",
                commit: "oldsha",
              },
            },
          ],
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [debouncedQuery] = createSignal("");
        const [sort] = createSignal("updated");
        const [category] = createSignal("");
        const [, setItems] = createSignal<SourceItem[]>([]);
        const [, setLoading] = createSignal(false);
        const [, setHasMore] = createSignal(false);
        const [, setTotal] = createSignal(0);
        const [, setSelectedItem] = createSignal<SourceItem | null>(null);
        queries = useSourceFetchQueries({
          isAuthenticated,
          effectiveSpaceId,
          debouncedQuery,
          sort,
          category,
          setItems,
          setLoading,
          setHasMore,
          setTotal,
          setSelectedItem,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
        });
      });

      const installations = await queries.fetchInstallations();
      const sourceKey = sourceInstallationKey({
        repository_url: "https://github.com/acme/demo.git",
        ref: "main",
        ref_type: "branch",
      });

      assertEquals(
        installations.get("repo-1")?.installation_id,
        "inst-new",
      );
      assertEquals(
        sourceKey ? installations.get(sourceKey)?.installation_id : null,
        "inst-new",
      );
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "source install state - repository catalog install opens Git URL approval flow",
  async () => {
    const originalFetch = globalThis.fetch;
    const item = makeItem({
      package: {
        available: true,
        app_id: "demo",
        latest_version: "2.0.0",
        latest_tag: "v2.0.0",
        release_tag: "v2.0.0",
        asset_id: null,
        tags: [],
        downloads: 0,
        certified: false,
        description: null,
        icon: null,
      },
      source: {
        kind: "git_ref",
        repository_url: "https://github.com/acme/demo.git",
        ref: "v2.0.0",
        ref_type: "tag",
        env: "staging",
      },
    });
    let dispose: (() => void) | undefined;
    let actions!: ReturnType<typeof useSourceFetchActions>;
    let delegated:
      | { source: SourceItem["source"]; itemId: string }
      | undefined;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [filter] = createSignal("all");
        const [, setItems] = createSignal<SourceItem[]>([item]);
        const [, setSelectedItem] = createSignal<SourceItem | null>(item);
        const [, setInstallingId] = createSignal<string | null>(null);
        actions = useSourceFetchActions({
          isAuthenticated,
          effectiveSpaceId,
          filter,
          onNavigateToRepo: () => {},
          onRequireLogin: () => {},
          setItems,
          setSelectedItem,
          setInstallingId,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
          fetchMine: async () => {},
          onInstallGitUrl: (source, currentItem) => {
            delegated = { source, itemId: currentItem.id };
          },
        });
      });

      await actions.install(item);

      assertEquals(delegated, {
        source: {
          kind: "git_ref",
          repository_url: "https://github.com/acme/demo.git",
          ref: "v2.0.0",
          ref_type: "tag",
          env: "staging",
        },
        itemId: "repo-1",
      });
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "source install state - repository install fails closed without approval flow",
  async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const item = makeItem({
      package: {
        available: true,
        app_id: "demo",
        latest_version: "2.0.0",
        latest_tag: "v2.0.0",
        release_tag: "v2.0.0",
        asset_id: null,
        tags: [],
        downloads: 0,
        certified: false,
        description: null,
        icon: null,
      },
    });
    let dispose: (() => void) | undefined;
    let actions!: ReturnType<typeof useSourceFetchActions>;
    let items!: () => SourceItem[];
    let selectedItem!: () => SourceItem | null;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;
    globalThis.setTimeout =
      ((_: TimerHandler, __?: number) => 0) as typeof setTimeout;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [filter] = createSignal("all");
        const [itemsSignal, setItems] = createSignal<SourceItem[]>([item]);
        const [selectedItemSignal, setSelectedItem] = createSignal<
          SourceItem | null
        >(item);
        items = itemsSignal;
        selectedItem = selectedItemSignal;
        actions = useSourceFetchActions({
          isAuthenticated,
          effectiveSpaceId,
          filter,
          onNavigateToRepo: () => {},
          onRequireLogin: () => {},
          setItems,
          setSelectedItem,
          setInstallingId: () => undefined,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
          fetchMine: async () => {},
        });
      });

      await actions.install(item);

      assertEquals(items()[0]?.installation, undefined);
      assertEquals(selectedItem()?.installation, undefined);
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }
  },
);

test(
  "source install state - default app install uses Installation apply",
  async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const item = makeItem({
      id: "default-app:takos-docs",
      name: "Takos Docs",
      catalog_origin: "default_app",
      installable_app: {
        app_id: "jp.takos.docs",
        name: "Takos Docs",
        description: null,
        publisher: "Takos",
        homepage: null,
        source_path: "package.json",
        runtime_modes: ["shared-cell"],
        bindings: [],
      },
      package: {
        available: true,
        app_id: "jp.takos.docs",
        latest_version: "v0.1.2",
        latest_tag: "v0.1.2",
        release_tag: "v0.1.2",
        asset_id: null,
        tags: [],
        downloads: 0,
        certified: true,
        description: null,
        icon: null,
      },
    });
    let dispose: (() => void) | undefined;
    let actions!: ReturnType<typeof useSourceFetchActions>;
    let items!: () => SourceItem[];
    let selectedItem!: () => SourceItem | null;
    let installRequest: { url: string; body: unknown } | null = null;

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (
        url.includes("/app-installations/apply") &&
        init?.method === "POST"
      ) {
        installRequest = {
          url,
          body: JSON.parse(String(init.body ?? "{}")),
        };
        return Promise.resolve(jsonResponse({
          installation: {
            installed: true,
            installation_id: "inst_1",
            app_id: "jp.takos.docs",
            status: "ready",
            runtime_mode: "shared-cell",
            group_id: null,
            group_name: null,
            installed_version: "v0.1.2",
            installed_commit: null,
            installed_at: "2026-04-05T00:00:00.000Z",
            updated_at: "2026-04-05T00:00:00.000Z",
            deployed_at: null,
          },
        }, 202));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;
    globalThis.setTimeout =
      ((_: TimerHandler, __?: number) => 0) as typeof setTimeout;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [filter] = createSignal("all");
        const [itemsSignal, setItems] = createSignal<SourceItem[]>([item]);
        const [selectedItemSignal, setSelectedItem] = createSignal<
          SourceItem | null
        >(item);
        const [, setInstallingId] = createSignal<string | null>(null);
        items = itemsSignal;
        selectedItem = selectedItemSignal;
        actions = useSourceFetchActions({
          isAuthenticated,
          effectiveSpaceId,
          filter,
          onNavigateToRepo: () => {},
          onRequireLogin: () => {},
          setItems,
          setSelectedItem,
          setInstallingId,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
          fetchMine: async () => {},
        });
      });

      await actions.install(item);

      assertEquals(installRequest, {
        url: "/api/spaces/space-1/app-installations/apply",
        body: { app_id: "jp.takos.docs" },
      });
      assertEquals(items()[0]?.installation, {
        installed: true,
        installation_id: "inst_1",
        app_id: "jp.takos.docs",
        status: "ready",
        runtime_mode: "shared-cell",
        group_id: null,
        group_name: null,
        installed_version: "v0.1.2",
        installed_commit: null,
        installed_at: "2026-04-05T00:00:00.000Z",
        updated_at: "2026-04-05T00:00:00.000Z",
        deployed_at: null,
      });
      assertEquals(selectedItem()?.installation, items()[0]?.installation);
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }
  },
);

test(
  "source install state - installed default app update opens Git URL revision flow",
  async () => {
    const originalFetch = globalThis.fetch;
    const item = makeItem({
      id: "default-app:takos-docs",
      name: "Takos Docs",
      catalog_origin: "default_app",
      installable_app: {
        app_id: "jp.takos.docs",
        name: "Takos Docs",
        description: null,
        publisher: "Takos",
        homepage: null,
        source_path: "package.json",
        runtime_modes: ["shared-cell"],
        bindings: [],
      },
      package: {
        available: true,
        app_id: "jp.takos.docs",
        latest_version: "v0.1.3",
        latest_tag: "v0.1.3",
        release_tag: "v0.1.3",
        asset_id: null,
        tags: [],
        downloads: 0,
        certified: true,
        description: null,
        icon: null,
      },
      source: {
        kind: "git_ref",
        repository_url: "https://github.com/tako0614/takos-docs.git",
        ref: "v0.1.3",
        ref_type: "tag",
        env: "staging",
      },
      installation: {
        installed: true,
        installation_id: "inst_docs",
        app_id: "jp.takos.docs",
        status: "ready",
        runtime_mode: "shared-cell",
        group_id: null,
        group_name: null,
        installed_version: "v0.1.2",
        installed_commit: "oldsha",
        installed_at: "2026-04-05T00:00:00.000Z",
        updated_at: "2026-04-05T00:00:00.000Z",
        deployed_at: null,
      },
    });
    let dispose: (() => void) | undefined;
    let actions!: ReturnType<typeof useSourceFetchActions>;
    let delegated:
      | { source: SourceItem["source"]; itemId: string; installationId: string }
      | undefined;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [filter] = createSignal("all");
        const [, setItems] = createSignal<SourceItem[]>([item]);
        const [, setSelectedItem] = createSignal<SourceItem | null>(item);
        const [, setInstallingId] = createSignal<string | null>(null);
        actions = useSourceFetchActions({
          isAuthenticated,
          effectiveSpaceId,
          filter,
          onNavigateToRepo: () => {},
          onRequireLogin: () => {},
          setItems,
          setSelectedItem,
          setInstallingId,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
          fetchMine: async () => {},
          onInstallGitUrl: (source, currentItem) => {
            delegated = {
              source,
              itemId: currentItem.id,
              installationId: currentItem.installation?.installation_id ?? "",
            };
          },
        });
      });

      await actions.install(item);

      assertEquals(delegated, {
        source: {
          kind: "git_ref",
          repository_url: "https://github.com/tako0614/takos-docs.git",
          ref: "v0.1.3",
          ref_type: "tag",
          env: "staging",
        },
        itemId: "default-app:takos-docs",
        installationId: "inst_docs",
      });
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
    }
  },
);

test(
  "source install state - rollback opens AppInstallation revision flow",
  async () => {
    const originalFetch = globalThis.fetch;
    const item = makeItem({
      installation: {
        installed: true,
        installation_id: "inst-current",
        app_id: "demo",
        status: "ready",
        runtime_mode: "shared-cell",
        group_id: null,
        group_name: null,
        installed_version: "2.0.0",
        installed_commit: "currentsha",
        installed_at: "2026-04-05T00:00:00.000Z",
        updated_at: "2026-04-05T00:00:00.000Z",
        deployed_at: null,
      },
    });
    let dispose: (() => void) | undefined;
    let actions!: ReturnType<typeof useSourceFetchActions>;
    let delegated:
      | {
        source: SourceItem["source"];
        itemId: string;
        operation: "upgrade" | "rollback" | undefined;
      }
      | undefined;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [isAuthenticated] = createSignal(true);
        const [effectiveSpaceId] = createSignal<string | null>("space-1");
        const [filter] = createSignal("all");
        const [, setInstallingId] = createSignal<string | null>(null);
        actions = useSourceFetchActions({
          isAuthenticated,
          effectiveSpaceId,
          filter,
          onNavigateToRepo: () => {},
          onRequireLogin: () => {},
          setItems: () => undefined,
          setSelectedItem: () => undefined,
          setInstallingId,
          refs: {
            requestSeqRef: 0,
            appendInFlightRef: false,
          },
          fetchMine: async () => {},
          onInstallGitUrl: (source, currentItem, operation) => {
            delegated = { source, itemId: currentItem.id, operation };
          },
        });
      });

      await actions.rollback(item);

      assertEquals(delegated, {
        source: {
          kind: "git_ref",
          repository_url: "https://github.com/acme/demo.git",
          ref: "2.0.0",
          ref_type: "branch",
          env: "staging",
        },
        itemId: "repo-1",
        operation: "rollback",
      });
    } finally {
      dispose?.();
      globalThis.fetch = originalFetch;
    }
  },
);

test("source install state - uninstall removes the AppInstallation", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const item = makeItem({
    installation: {
      installed: true,
      installation_id: "inst-current",
      app_id: "demo",
      status: "ready",
      runtime_mode: "shared-cell",
      group_id: null,
      group_name: null,
      installed_version: "2.0.0",
      installed_commit: "currentsha",
      installed_at: "2026-04-05T00:00:00.000Z",
      updated_at: "2026-04-05T00:00:00.000Z",
      deployed_at: null,
    },
  });
  let dispose: (() => void) | undefined;
  let actions!: ReturnType<typeof useSourceFetchActions>;
  let items!: () => SourceItem[];
  let selectedItem!: () => SourceItem | null;
  let uninstallRequest: { url: string; body: unknown } | null = null;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const url = input instanceof Request ? input.url : String(input);
    if (
      url.includes("/app-installations/inst-current") &&
      init?.method === "DELETE"
    ) {
      uninstallRequest = {
        url,
        body: JSON.parse(String(init.body ?? "{}")),
      };
      return jsonResponse({
        installation: { id: "inst-current", status: "suspended" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;
  globalThis.setTimeout =
    ((_: TimerHandler, __?: number) => 0) as typeof setTimeout;

  try {
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [isAuthenticated] = createSignal(true);
      const [effectiveSpaceId] = createSignal<string | null>("space-1");
      const [filter] = createSignal("all");
      const [itemsSignal, setItems] = createSignal<SourceItem[]>([item]);
      const [selectedItemSignal, setSelectedItem] = createSignal<
        SourceItem | null
      >(item);
      const [, setInstallingId] = createSignal<string | null>(null);
      items = itemsSignal;
      selectedItem = selectedItemSignal;
      actions = useSourceFetchActions({
        isAuthenticated,
        effectiveSpaceId,
        filter,
        onNavigateToRepo: () => {},
        onRequireLogin: () => {},
        setItems,
        setSelectedItem,
        setInstallingId,
        refs: {
          requestSeqRef: 0,
          appendInFlightRef: false,
        },
        fetchMine: async () => {},
      });
    });

    await actions.uninstall(item);

    assertEquals(uninstallRequest, {
      url: "/api/spaces/space-1/app-installations/inst-current",
      body: { reason: "user removed app" },
    });
    assertEquals(items()[0]?.installation, undefined);
    assertEquals(selectedItem()?.installation, undefined);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
