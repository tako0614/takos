import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";
import { APP_DEPLOYMENTS_REMOVED_MESSAGE } from "@/services/platform/app-deployments";
import {
  APP_DEPLOYMENT_DEPLOY_FROM_REPO,
  APP_DEPLOYMENT_GET,
  APP_DEPLOYMENT_LIST,
  APP_DEPLOYMENT_REMOVE,
  APP_DEPLOYMENT_ROLLBACK,
  appDeploymentDeployFromRepoHandler,
  appDeploymentGetHandler,
  appDeploymentListHandler,
  appDeploymentRemoveHandler,
  appDeploymentRollbackHandler,
  WORKSPACE_APP_DEPLOYMENT_HANDLERS,
  WORKSPACE_APP_DEPLOYMENT_TOOLS,
} from "@/tools/builtin/space-app-deployments";

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

Deno.test("workspace app deployment tool definitions stay stable", () => {
  assertEquals(WORKSPACE_APP_DEPLOYMENT_TOOLS.length, 5);

  const names = WORKSPACE_APP_DEPLOYMENT_TOOLS.map((tool) => tool.name);
  assert(names.includes("app_deployment_list"));
  assert(names.includes("app_deployment_get"));
  assert(names.includes("app_deployment_deploy_from_repo"));
  assert(names.includes("app_deployment_remove"));
  assert(names.includes("app_deployment_rollback"));

  for (const def of WORKSPACE_APP_DEPLOYMENT_TOOLS) {
    assertEquals(def.category, "workspace");
    assert(def.name in WORKSPACE_APP_DEPLOYMENT_HANDLERS);
  }

  assertEquals(APP_DEPLOYMENT_LIST.parameters.required, undefined);
  assertEquals(APP_DEPLOYMENT_GET.parameters.required, ["app_deployment_id"]);
  assertEquals(APP_DEPLOYMENT_DEPLOY_FROM_REPO.parameters.required, [
    "repo_id",
    "ref",
  ]);
  assertEquals(APP_DEPLOYMENT_REMOVE.parameters.required, [
    "app_deployment_id",
  ]);
  assertEquals(APP_DEPLOYMENT_ROLLBACK.parameters.required, [
    "app_deployment_id",
  ]);
});

Deno.test("app deployment handlers - surface removed API contract for valid calls", async () => {
  await assertRejects(
    async () => {
      await appDeploymentListHandler({}, makeContext());
    },
    Error,
    APP_DEPLOYMENTS_REMOVED_MESSAGE,
  );

  await assertRejects(
    async () => {
      await appDeploymentGetHandler(
        { app_deployment_id: "ad-1" },
        makeContext(),
      );
    },
    Error,
    APP_DEPLOYMENTS_REMOVED_MESSAGE,
  );

  await assertRejects(
    async () => {
      await appDeploymentDeployFromRepoHandler(
        { repo_id: "r-1", ref: "main", ref_type: "branch" },
        makeContext(),
      );
    },
    Error,
    APP_DEPLOYMENTS_REMOVED_MESSAGE,
  );

  await assertRejects(
    async () => {
      await appDeploymentRemoveHandler(
        { app_deployment_id: "ad-1" },
        makeContext(),
      );
    },
    Error,
    APP_DEPLOYMENTS_REMOVED_MESSAGE,
  );

  await assertRejects(
    async () => {
      await appDeploymentRollbackHandler(
        { app_deployment_id: "ad-1" },
        makeContext(),
      );
    },
    Error,
    APP_DEPLOYMENTS_REMOVED_MESSAGE,
  );
});

Deno.test("appDeploymentGetHandler - validates app_deployment_id before service access", async () => {
  await assertRejects(
    async () => {
      await appDeploymentGetHandler({ app_deployment_id: "" }, makeContext());
    },
    Error,
    "app_deployment_id is required",
  );
});

Deno.test("appDeploymentDeployFromRepoHandler - validates required repo arguments", async () => {
  await assertRejects(
    async () => {
      await appDeploymentDeployFromRepoHandler(
        { repo_id: "", ref: "main" },
        makeContext(),
      );
    },
    Error,
    "repo_id is required",
  );

  await assertRejects(
    async () => {
      await appDeploymentDeployFromRepoHandler(
        { repo_id: "r-1", ref: "" },
        makeContext(),
      );
    },
    Error,
    "ref is required",
  );

  await assertRejects(
    async () => {
      await appDeploymentDeployFromRepoHandler(
        { repo_id: "r-1", ref: "v1.0", ref_type: "invalid" },
        makeContext(),
      );
    },
    Error,
    "ref_type must be one of",
  );
});

Deno.test("remove and rollback handlers - validate app_deployment_id before service access", async () => {
  await assertRejects(
    async () => {
      await appDeploymentRemoveHandler(
        { app_deployment_id: "" },
        makeContext(),
      );
    },
    Error,
    "app_deployment_id is required",
  );

  await assertRejects(
    async () => {
      await appDeploymentRollbackHandler(
        { app_deployment_id: "" },
        makeContext(),
      );
    },
    Error,
    "app_deployment_id is required",
  );
});
