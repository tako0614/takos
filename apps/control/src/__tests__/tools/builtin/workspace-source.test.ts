import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import {
  REPO_FORK,
  repoForkHandler,
  STORE_SEARCH,
  WORKSPACE_SOURCE_HANDLERS,
  WORKSPACE_SOURCE_TOOLS,
} from "@/tools/builtin/space-source";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

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

Deno.test("workspace source tool definitions - defines two tools", () => {
  assertEquals(WORKSPACE_SOURCE_TOOLS.length, 2);
  const names = WORKSPACE_SOURCE_TOOLS.map((tool) => tool.name);
  assert(names.includes("store_search"));
  assert(names.includes("repo_fork"));
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

Deno.test("workspace source tool definitions - store_search has valid sort enum", () => {
  const sortEnum =
    (STORE_SEARCH.parameters.properties.sort.enum ?? []) as string[];
  assert(sortEnum.includes("trending"));
  assert(sortEnum.includes("new"));
  assert(sortEnum.includes("stars"));
});

Deno.test("workspace source tool definitions - store_search has valid type enum", () => {
  const typeEnum =
    (STORE_SEARCH.parameters.properties.type.enum ?? []) as string[];
  assert(typeEnum.includes("all"));
  assert(typeEnum.includes("repo"));
  assert(typeEnum.includes("deployable-app"));
});

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
