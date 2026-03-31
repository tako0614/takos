import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// [Deno] vi.mock removed - manually stub imports from '@/services/source/repos'
// [Deno] vi.mock removed - manually stub imports from '@/services/source/explore'
// [Deno] vi.mock removed - manually stub imports from '@/services/source/fork'
import { checkRepoAccess } from "@/services/source/repos";
import { listCatalogItems } from "@/services/source/explore";
import { forkWithWorkflows } from "@/services/source/fork";

import {
  REPO_FORK,
  repoForkHandler,
  STORE_SEARCH,
  storeSearchHandler,
  WORKSPACE_SOURCE_HANDLERS,
  WORKSPACE_SOURCE_TOOLS,
} from "@/tools/builtin/space-source";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {
      GIT_OBJECTS: {},
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

Deno.test("workspace source tool definitions - defines two tools", () => {
  assertEquals(WORKSPACE_SOURCE_TOOLS.length, 2);
  const names = WORKSPACE_SOURCE_TOOLS.map((t) => t.name);
  assertStringIncludes(names, "store_search");
  assertStringIncludes(names, "repo_fork");
});
Deno.test("workspace source tool definitions - all tools have workspace category", () => {
  for (const def of WORKSPACE_SOURCE_TOOLS) {
    assertEquals(def.category, "workspace");
  }
});
Deno.test("workspace source tool definitions - WORKSPACE_SOURCE_HANDLERS maps all tools", () => {
  for (const def of WORKSPACE_SOURCE_TOOLS) {
    assert(def.name in WORKSPACE_SOURCE_HANDLERS);
  }
});
Deno.test("workspace source tool definitions - store_search has no required params", () => {
  assertEquals(STORE_SEARCH.parameters.required, []);
});
Deno.test("workspace source tool definitions - repo_fork requires repo_id", () => {
  assertEquals(REPO_FORK.parameters.required, ["repo_id"]);
});
Deno.test("workspace source tool definitions - store_search has sort enum", () => {
  assertStringIncludes(
    STORE_SEARCH.parameters.properties.sort.enum,
    "trending",
  );
  assertStringIncludes(STORE_SEARCH.parameters.properties.sort.enum, "new");
  assertStringIncludes(STORE_SEARCH.parameters.properties.sort.enum, "stars");
});
Deno.test("workspace source tool definitions - store_search has type enum", () => {
  assertStringIncludes(STORE_SEARCH.parameters.properties.type.enum, "all");
  assertStringIncludes(STORE_SEARCH.parameters.properties.type.enum, "repo");
  assertStringIncludes(
    STORE_SEARCH.parameters.properties.type.enum,
    "deployable-app",
  );
});
// ---------------------------------------------------------------------------
// storeSearchHandler
// ---------------------------------------------------------------------------

Deno.test("storeSearchHandler - returns search results formatted as JSON", async () => {
  listCatalogItems = (async () => ({
    items: [
      {
        repo: {
          id: "r1",
          name: "cool-app",
          owner: { username: "alice" },
          description: "A cool app",
          stars: 42,
          forks: 5,
          language: "TypeScript",
          license: "MIT",
        },
        takopack: {
          available: true,
          app_id: "app-1",
          latest_version: "1.0.0",
          category: "productivity",
          tags: ["tool"],
          publish_status: "published",
        },
        installation: { installed: true, bundle_deployment_id: "bd-1" },
      },
    ],
    total: 1,
    has_more: false,
  } as any)) as any;

  const result = JSON.parse(await storeSearchHandler({}, makeContext()));

  assertEquals(result.sort, "trending");
  assertEquals(result.type, "all");
  assertEquals(result.total, 1);
  assertEquals(result.items[0].repo_id, "r1");
  assertEquals(result.items[0].repo_name, "cool-app");
  assertEquals(result.items[0].owner_username, "alice");
  assertEquals(result.items[0].stars, 42);
  assertEquals(result.items[0].takopack_available, true);
  assertEquals(result.items[0].installed_in_current_space, true);
});
Deno.test("storeSearchHandler - passes search parameters to listCatalogItems", async () => {
  listCatalogItems =
    (async () => ({ items: [], total: 0, has_more: false } as any)) as any;

  await storeSearchHandler(
    {
      query: "test app",
      sort: "stars",
      type: "deployable-app",
      limit: 5,
      category: "productivity",
      language: "TypeScript",
      tags: "cool,useful",
      certified_only: true,
    },
    makeContext(),
  );

  assertSpyCallArgs(listCatalogItems, 0, [
    expect.anything(),
    {
      sort: "stars",
      type: "deployable-app",
      limit: 5,
      searchQuery: "test app",
      category: "productivity",
      language: "TypeScript",
      tagsRaw: "cool,useful",
      certifiedOnly: true,
    },
  ]);
});
Deno.test("storeSearchHandler - normalizes invalid sort to default", async () => {
  listCatalogItems =
    (async () => ({ items: [], total: 0, has_more: false } as any)) as any;

  await storeSearchHandler({ sort: "invalid" }, makeContext());

  assertSpyCallArgs(listCatalogItems, 0, [
    expect.anything(),
    { sort: "trending" },
  ]);
});
Deno.test("storeSearchHandler - clamps limit to max 20", async () => {
  listCatalogItems =
    (async () => ({ items: [], total: 0, has_more: false } as any)) as any;

  await storeSearchHandler({ limit: 100 }, makeContext());

  assertSpyCallArgs(listCatalogItems, 0, [
    expect.anything(),
    { limit: 20 },
  ]);
});
Deno.test("storeSearchHandler - handles installation not present", async () => {
  listCatalogItems = (async () => ({
    items: [
      {
        repo: {
          id: "r1",
          name: "app",
          owner: { username: "bob" },
          description: "",
          stars: 0,
          forks: 0,
          language: null,
          license: null,
        },
        takopack: {
          available: false,
          app_id: null,
          latest_version: null,
          category: null,
          tags: [],
          publish_status: null,
        },
        installation: null,
      },
    ],
    total: 1,
    has_more: false,
  } as any)) as any;

  const result = JSON.parse(await storeSearchHandler({}, makeContext()));
  assertEquals(result.items[0].installed_in_current_space, false);
  assertEquals(result.items[0].installation_bundle_deployment_id, null);
});
// ---------------------------------------------------------------------------
// repoForkHandler
// ---------------------------------------------------------------------------

Deno.test("repoForkHandler - throws when repo_id is empty", async () => {
  await assertRejects(async () => {
    await repoForkHandler({ repo_id: "" }, makeContext());
  }, "repo_id is required");
});
Deno.test("repoForkHandler - throws when repo_id is not provided", async () => {
  await assertRejects(async () => {
    await repoForkHandler({}, makeContext());
  }, "repo_id is required");
});
Deno.test("repoForkHandler - throws when repository is not accessible", async () => {
  checkRepoAccess = (async () => null) as any;

  await assertRejects(async () => {
    await repoForkHandler({ repo_id: "r-inaccessible" }, makeContext());
  }, "not found or inaccessible");
});
Deno.test("repoForkHandler - forks a repository", async () => {
  checkRepoAccess = (async () => ({ canRead: true } as any)) as any;
  forkWithWorkflows = (async () => ({
    repository: { id: "r-fork", name: "forked-repo" },
    forked_from: { id: "r-original" },
  } as any)) as any;

  const result = JSON.parse(
    await repoForkHandler({ repo_id: "r-original" }, makeContext()),
  );

  assertEquals(result.success, true);
  assertEquals(result.repository.id, "r-fork");
  assertEquals(result.forked_from.id, "r-original");
});
Deno.test("repoForkHandler - passes custom name to fork", async () => {
  checkRepoAccess = (async () => ({ canRead: true } as any)) as any;
  forkWithWorkflows = (async () => ({
    repository: { id: "r-fork", name: "my-fork" },
    forked_from: { id: "r-original" },
  } as any)) as any;

  await repoForkHandler(
    { repo_id: "r-original", name: "my-fork" },
    makeContext(),
  );

  assertSpyCallArgs(forkWithWorkflows, 0, [
    expect.anything(),
    expect.anything(),
    "r-original",
    "ws-test",
    { name: "my-fork" },
  ]);
});
Deno.test("repoForkHandler - trims repo_id whitespace", async () => {
  checkRepoAccess = (async () => ({ canRead: true } as any)) as any;
  forkWithWorkflows = (async () => ({
    repository: { id: "r-fork" },
    forked_from: { id: "r-1" },
  } as any)) as any;

  await repoForkHandler({ repo_id: "  r-1  " }, makeContext());

  assertSpyCallArgs(checkRepoAccess, 0, [
    expect.anything(),
    "r-1",
    "user-1",
    undefined,
    { allowPublicRead: true },
  ]);
});
