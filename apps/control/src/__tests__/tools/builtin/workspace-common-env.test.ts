import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";
import {
  WORKSPACE_COMMON_ENV_TOOLS,
  WORKSPACE_ENV_DELETE,
  WORKSPACE_ENV_LIST,
  WORKSPACE_ENV_SET,
  workspaceEnvDeleteHandler,
  workspaceEnvSetHandler,
} from "@/tools/builtin/space-common-env";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

Deno.test("workspace common env tools - definitions stay stable", () => {
  assertEquals(WORKSPACE_ENV_LIST.name, "workspace_env_list");
  assertEquals(WORKSPACE_ENV_LIST.category, "workspace");

  assertEquals(WORKSPACE_ENV_SET.name, "workspace_env_set");
  assertEquals(WORKSPACE_ENV_SET.parameters.required, ["name", "value"]);

  assertEquals(WORKSPACE_ENV_DELETE.name, "workspace_env_delete");
  assertEquals(WORKSPACE_ENV_DELETE.parameters.required, ["name"]);

  assertEquals(WORKSPACE_COMMON_ENV_TOOLS.length, 3);
  assertEquals(
    WORKSPACE_COMMON_ENV_TOOLS.map((tool) => tool.name),
    ["workspace_env_list", "workspace_env_set", "workspace_env_delete"],
  );
});

Deno.test("workspaceEnvSetHandler - rejects missing or whitespace-only names", async () => {
  await assertRejects(
    async () => {
      await workspaceEnvSetHandler({ name: "", value: "val" }, makeContext());
    },
    Error,
    "name is required",
  );

  await assertRejects(
    async () => {
      await workspaceEnvSetHandler(
        { name: "   ", value: "val" },
        makeContext(),
      );
    },
    Error,
    "name is required",
  );
});

Deno.test("workspaceEnvDeleteHandler - rejects missing names", async () => {
  await assertRejects(
    async () => {
      await workspaceEnvDeleteHandler({ name: "" }, makeContext());
    },
    Error,
    "name is required",
  );

  await assertRejects(
    async () => {
      await workspaceEnvDeleteHandler({ name: "   " }, makeContext());
    },
    Error,
    "name is required",
  );
});

Deno.test("workspace common env tools - definition names remain unique", () => {
  const names = WORKSPACE_COMMON_ENV_TOOLS.map((tool) => tool.name);
  assertEquals(new Set(names).size, names.length);
  assert(names.includes("workspace_env_list"));
  assert(names.includes("workspace_env_set"));
  assert(names.includes("workspace_env_delete"));
});
