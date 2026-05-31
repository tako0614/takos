import type { ToolContext } from "@/tools/types";
import type { Env } from "@/types";

import { assertEquals, assertRejects } from "@std/assert";

import {
  REPO_HANDLERS,
  REPO_LIST,
  REPO_STATUS,
  REPO_SWITCH,
  REPO_TOOLS,
  repoListHandler,
  repoStatusHandler,
  repoSwitchHandler,
} from "@/tools/custom/repo";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { noopDep } from "@test/dep-stubs";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: ["repo.read"],
    sessionId: undefined,
    env: {} as Env,
    db: noopSqlDatabaseBinding(),
    setSessionId: noopDep<ToolContext["setSessionId"]>("setSessionId"),
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: noopDep<
      ToolContext["setLastContainerStartFailure"]
    >("setLastContainerStartFailure"),
    ...overrides,
  };
}

Deno.test("repo tools - exports the custom repo tools", () => {
  assertEquals(REPO_TOOLS.map((tool) => tool.name), [
    "repo_list",
    "repo_status",
    "repo_switch",
  ]);
  assertEquals(Object.keys(REPO_HANDLERS).sort(), [
    "repo_list",
    "repo_status",
    "repo_switch",
  ]);
  assertEquals(REPO_LIST.parameters.required, []);
  assertEquals(REPO_STATUS.parameters.required, []);
  assertEquals(REPO_SWITCH.parameters.required, ["repo_id"]);
});

Deno.test("repoListHandler - rejects when no container session is active", async () => {
  await assertRejects(
    async () => {
      await repoListHandler({}, makeContext());
    },
    "using file operations",
  );
});

Deno.test("repoStatusHandler - rejects when no container session is active", async () => {
  await assertRejects(
    async () => {
      await repoStatusHandler({}, makeContext());
    },
    "checking mounted repositories",
  );
});

Deno.test("repoSwitchHandler - rejects when repo_id is missing", async () => {
  await assertRejects(
    async () => {
      await repoSwitchHandler({}, makeContext({ sessionId: "session-1" }));
    },
    "repo_id is required",
  );
});
