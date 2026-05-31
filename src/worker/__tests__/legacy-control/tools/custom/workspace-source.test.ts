import type { ToolContext } from "@/tools/types";

import {
  REPO_FORK,
  repoForkHandler,
  STORE_SEARCH,
  WORKSPACE_SOURCE_HANDLERS,
  WORKSPACE_SOURCE_TOOLS,
} from "@/tools/custom/space-source";

import { assert, assertEquals, assertRejects } from "@std/assert";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { noopDep } from "@test/dep-stubs";
import { createMockEnv } from "../../../../test/integration/setup.ts";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: createMockEnv({
      GIT_OBJECTS: undefined,
    }),
    db: noopSqlDatabaseBinding(),
    setSessionId: noopDep<ToolContext["setSessionId"]>("setSessionId"),
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: noopDep<
      ToolContext["setLastContainerStartFailure"]
    >("setLastContainerStartFailure"),
    ...overrides,
  };
}

Deno.test("space source tool definitions - defines two tools", () => {
  assertEquals(WORKSPACE_SOURCE_TOOLS.length, 2);
  const names = WORKSPACE_SOURCE_TOOLS.map((tool) => tool.name);
  assert(names.includes("store_search"));
  assert(names.includes("repo_fork"));
});

Deno.test("space source tool definitions - all tools have space category", () => {
  for (const def of WORKSPACE_SOURCE_TOOLS) {
    assertEquals(def.category, "space");
  }
});

Deno.test("space source tool definitions - WORKSPACE_SOURCE_HANDLERS maps all tools", () => {
  for (const def of WORKSPACE_SOURCE_TOOLS) {
    assert(def.name in WORKSPACE_SOURCE_HANDLERS);
  }
});

Deno.test("space source tool definitions - store_search has no required params", () => {
  assertEquals(STORE_SEARCH.parameters.required, []);
});

Deno.test("space source tool definitions - repo_fork requires repo_id", () => {
  assertEquals(REPO_FORK.parameters.required, ["repo_id"]);
});

Deno.test("space source tool definitions - store_search has valid sort enum", () => {
  const sortEnum =
    (STORE_SEARCH.parameters.properties.sort.enum ?? []) as string[];
  assert(sortEnum.includes("trending"));
  assert(sortEnum.includes("new"));
  assert(sortEnum.includes("stars"));
});

Deno.test("space source tool definitions - store_search has valid type enum", () => {
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
