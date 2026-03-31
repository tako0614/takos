import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mockListWorkspaceCommonEnv = ((..._args: any[]) => undefined) as any;
const mockUpsertWorkspaceCommonEnv = ((..._args: any[]) => undefined) as any;
const mockDeleteWorkspaceCommonEnv = ((..._args: any[]) => undefined) as any;
const mockReconcileServicesForEnvKey = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/services/common-env'
import {
  WORKSPACE_COMMON_ENV_TOOLS,
  WORKSPACE_ENV_DELETE,
  WORKSPACE_ENV_LIST,
  WORKSPACE_ENV_SET,
  workspaceEnvDeleteHandler,
  workspaceEnvListHandler,
  workspaceEnvSetHandler,
} from "@/tools/builtin/space-common-env";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("workspace common env tools - definitions - WORKSPACE_ENV_LIST has correct name", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(WORKSPACE_ENV_LIST.name, "workspace_env_list");
  assertEquals(WORKSPACE_ENV_LIST.category, "workspace");
});
Deno.test("workspace common env tools - definitions - WORKSPACE_ENV_SET requires name and value", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(WORKSPACE_ENV_SET.name, "workspace_env_set");
  assertEquals(WORKSPACE_ENV_SET.parameters.required, ["name", "value"]);
});
Deno.test("workspace common env tools - definitions - WORKSPACE_ENV_DELETE requires name", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(WORKSPACE_ENV_DELETE.name, "workspace_env_delete");
  assertEquals(WORKSPACE_ENV_DELETE.parameters.required, ["name"]);
});
Deno.test("workspace common env tools - definitions - exports all three tools", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(WORKSPACE_COMMON_ENV_TOOLS.length, 3);
  assertEquals(WORKSPACE_COMMON_ENV_TOOLS.map((t) => t.name), [
    "workspace_env_list",
    "workspace_env_set",
    "workspace_env_delete",
  ]);
});

Deno.test("workspace common env tools - workspaceEnvListHandler - returns list of environment variables", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockListWorkspaceCommonEnv = (async () => [
    { name: "API_KEY", value: "***", secret: true },
    { name: "NODE_ENV", value: "production", secret: false },
  ]) as any;

  const result = JSON.parse(await workspaceEnvListHandler({}, makeContext()));

  assertEquals(result.count, 2);
  assertEquals(result.env.length, 2);
  assertEquals(result.env[0].name, "API_KEY");
});
Deno.test("workspace common env tools - workspaceEnvListHandler - returns empty list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockListWorkspaceCommonEnv = (async () => []) as any;

  const result = JSON.parse(await workspaceEnvListHandler({}, makeContext()));
  assertEquals(result.count, 0);
  assertEquals(result.env, []);
});

Deno.test("workspace common env tools - workspaceEnvSetHandler - creates an environment variable", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockUpsertWorkspaceCommonEnv = (async () => undefined) as any;
  mockReconcileServicesForEnvKey = (async () => undefined) as any;

  const result = JSON.parse(
    await workspaceEnvSetHandler(
      { name: "MY_VAR", value: "my_value" },
      makeContext(),
    ),
  );

  assertEquals(result.success, true);
  assertEquals(result.name, "MY_VAR");
  assertEquals(result.secret, false);
});
Deno.test("workspace common env tools - workspaceEnvSetHandler - creates a secret environment variable", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockUpsertWorkspaceCommonEnv = (async () => undefined) as any;
  mockReconcileServicesForEnvKey = (async () => undefined) as any;

  const result = JSON.parse(
    await workspaceEnvSetHandler(
      { name: "API_KEY", value: "secret123", secret: true },
      makeContext(),
    ),
  );

  assertEquals(result.success, true);
  assertEquals(result.secret, true);
});
Deno.test("workspace common env tools - workspaceEnvSetHandler - throws when name is empty", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await workspaceEnvSetHandler({ name: "", value: "val" }, makeContext());
  }, "name is required");
});
Deno.test("workspace common env tools - workspaceEnvSetHandler - throws when name is whitespace only", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await workspaceEnvSetHandler({ name: "   ", value: "val" }, makeContext());
  }, "name is required");
});
Deno.test("workspace common env tools - workspaceEnvSetHandler - reconciles workers after setting env", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockUpsertWorkspaceCommonEnv = (async () => undefined) as any;
  mockReconcileServicesForEnvKey = (async () => undefined) as any;

  await workspaceEnvSetHandler(
    { name: "MY_VAR", value: "val" },
    makeContext(),
  );

  assertSpyCallArgs(mockReconcileServicesForEnvKey, 0, [
    "ws-test",
    "MY_VAR",
    "workspace_env_put",
  ]);
});

Deno.test("workspace common env tools - workspaceEnvDeleteHandler - deletes an environment variable", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockDeleteWorkspaceCommonEnv = (async () => true) as any;
  mockReconcileServicesForEnvKey = (async () => undefined) as any;

  const result = JSON.parse(
    await workspaceEnvDeleteHandler({ name: "MY_VAR" }, makeContext()),
  );

  assertEquals(result.success, true);
  assertEquals(result.name, "MY_VAR");
});
Deno.test("workspace common env tools - workspaceEnvDeleteHandler - throws when name is empty", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await workspaceEnvDeleteHandler({ name: "" }, makeContext());
  }, "name is required");
});
Deno.test("workspace common env tools - workspaceEnvDeleteHandler - throws when variable not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockDeleteWorkspaceCommonEnv = (async () => false) as any;

  await assertRejects(async () => {
    await workspaceEnvDeleteHandler({ name: "MISSING" }, makeContext());
  }, "Environment variable not found: MISSING");
});
Deno.test("workspace common env tools - workspaceEnvDeleteHandler - reconciles workers after deletion", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockDeleteWorkspaceCommonEnv = (async () => true) as any;
  mockReconcileServicesForEnvKey = (async () => undefined) as any;

  await workspaceEnvDeleteHandler({ name: "MY_VAR" }, makeContext());

  assertSpyCallArgs(mockReconcileServicesForEnvKey, 0, [
    "ws-test",
    "MY_VAR",
    "workspace_env_delete",
  ]);
});
