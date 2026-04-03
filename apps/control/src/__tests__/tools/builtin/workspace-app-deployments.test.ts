import type { D1Database } from "@cloudflare/workers-types";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";
import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";
import {
  type AppDeploymentMutationResult,
  type AppDeploymentRecord,
  AppDeploymentService,
} from "@/services/platform/app-deployments";
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

const sampleDeployment: AppDeploymentRecord = {
  id: "appdep-1",
  group: { id: "group-1", name: "demo-group" },
  source: {
    kind: "git_ref",
    repository_url: "https://github.com/acme/demo.git",
    ref: "main",
    ref_type: "branch",
    commit_sha: "sha-1",
    resolved_repo_id: null,
  },
  snapshot: {
    state: "available",
    rollback_ready: true,
    format: "takopack-v1",
  },
  status: "applied",
  manifest_version: "1.0.0",
  hostnames: ["demo.example.com"],
  rollback_of_app_deployment_id: null,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

const sampleMutation: AppDeploymentMutationResult = {
  appDeployment: sampleDeployment,
  applyResult: {
    groupId: "group-1",
    applied: [
      {
        name: "gateway",
        category: "worker",
        action: "create",
        status: "success" as const,
      },
    ],
    skipped: [],
    diff: {
      hasChanges: true,
      entries: [{ name: "gateway", category: "worker", action: "create" }],
      summary: {
        create: 1,
        update: 0,
        delete: 0,
        unchanged: 0,
      },
    },
    translationReport: {
      provider: "cloudflare",
      supported: true,
      requirements: [],
      resources: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  },
};

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
    "repository_url",
  ]);
  assertEquals(APP_DEPLOYMENT_REMOVE.parameters.required, [
    "app_deployment_id",
  ]);
  assertEquals(APP_DEPLOYMENT_ROLLBACK.parameters.required, [
    "app_deployment_id",
  ]);
});

Deno.test("app deployment handlers - call current service methods", async () => {
  const listStub = stub(
    AppDeploymentService.prototype,
    "list",
    async () => [sampleDeployment],
  );
  const getStub = stub(
    AppDeploymentService.prototype,
    "get",
    async () => sampleDeployment,
  );
  const deployStub = stub(
    AppDeploymentService.prototype,
    "deploy",
    async () => sampleMutation,
  );
  const removeStub = stub(
    AppDeploymentService.prototype,
    "remove",
    async () => undefined,
  );
  const rollbackStub = stub(
    AppDeploymentService.prototype,
    "rollback",
    async () => sampleMutation,
  );

  try {
    const listResult = JSON.parse(
      await appDeploymentListHandler({}, makeContext()),
    );
    assertEquals(listResult.app_deployments[0].id, "appdep-1");

    const getResult = JSON.parse(
      await appDeploymentGetHandler(
        { app_deployment_id: "appdep-1" },
        makeContext(),
      ),
    );
    assertEquals(getResult.app_deployment.id, "appdep-1");

    const deployResult = JSON.parse(
      await appDeploymentDeployFromRepoHandler(
        {
          repository_url: "https://github.com/acme/demo.git",
          ref: "v1.2.3",
          ref_type: "tag",
        },
        makeContext(),
      ),
    );
    assertEquals(deployResult.success, true);
    assertEquals(deployResult.data.appDeployment.id, "appdep-1");

    const removeResult = JSON.parse(
      await appDeploymentRemoveHandler(
        { app_deployment_id: "appdep-1" },
        makeContext(),
      ),
    );
    assertEquals(removeResult.success, true);

    const rollbackResult = JSON.parse(
      await appDeploymentRollbackHandler(
        { app_deployment_id: "appdep-1" },
        makeContext(),
      ),
    );
    assertEquals(rollbackResult.success, true);

    assertSpyCalls(listStub, 1);
    assertSpyCallArgs(getStub, 0, ["ws-test", "appdep-1"]);
    assertSpyCallArgs(deployStub, 0, [
      "ws-test",
      "user-1",
      {
        source: {
          kind: "git_ref",
          repositoryUrl: "https://github.com/acme/demo.git",
          ref: "v1.2.3",
          refType: "tag",
        },
      },
    ]);
    assertSpyCallArgs(removeStub, 0, ["ws-test", "appdep-1"]);
    assertSpyCallArgs(rollbackStub, 0, ["ws-test", "user-1", "appdep-1"]);
  } finally {
    listStub.restore();
    getStub.restore();
    deployStub.restore();
    removeStub.restore();
    rollbackStub.restore();
  }
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

Deno.test("appDeploymentDeployFromRepoHandler - validates repository_url and ref_type", async () => {
  await assertRejects(
    async () => {
      await appDeploymentDeployFromRepoHandler(
        { repository_url: "" },
        makeContext(),
      );
    },
    Error,
    "repository_url is required",
  );

  await assertRejects(
    async () => {
      await appDeploymentDeployFromRepoHandler(
        {
          repository_url: "https://github.com/acme/demo.git",
          ref_type: "invalid",
        },
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
