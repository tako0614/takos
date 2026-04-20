import type { D1Database } from "@cloudflare/workers-types";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";
import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";
import {
  type GroupDeploymentSnapshotMutationResult,
  type GroupDeploymentSnapshotRecord,
  GroupDeploymentSnapshotService,
} from "@/services/platform/group-deployment-snapshots";
import {
  GROUP_DEPLOYMENT_SNAPSHOT_DEPLOY_FROM_REPO,
  GROUP_DEPLOYMENT_SNAPSHOT_GET,
  GROUP_DEPLOYMENT_SNAPSHOT_LIST,
  GROUP_DEPLOYMENT_SNAPSHOT_REMOVE,
  GROUP_DEPLOYMENT_SNAPSHOT_ROLLBACK,
  groupDeploymentSnapshotDeployFromRepoHandler,
  groupDeploymentSnapshotGetHandler,
  groupDeploymentSnapshotListHandler,
  groupDeploymentSnapshotRemoveHandler,
  groupDeploymentSnapshotRollbackHandler,
  WORKSPACE_DEPLOYMENT_SNAPSHOT_HANDLERS,
  WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS,
} from "@/tools/custom/group-deployment-snapshots";

const sampleDeployment: GroupDeploymentSnapshotRecord = {
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
    format: "deployment-snapshot-v1",
  },
  status: "applied",
  manifest_version: "1.0.0",
  hostnames: ["demo.example.com"],
  rollback_of_group_deployment_snapshot_id: null,
  created_at: "2026-04-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

const sampleMutation: GroupDeploymentSnapshotMutationResult = {
  groupDeploymentSnapshot: sampleDeployment,
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
      supported: true,
      requirements: [],
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

Deno.test("space group deployment snapshot tool definitions stay stable", () => {
  assertEquals(WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS.length, 5);

  const names = WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS.map((tool) => tool.name);
  assert(names.includes("group_deployment_snapshot_list"));
  assert(names.includes("group_deployment_snapshot_get"));
  assert(names.includes("group_deployment_snapshot_deploy_from_repo"));
  assert(names.includes("group_deployment_snapshot_remove"));
  assert(names.includes("group_deployment_snapshot_rollback"));

  for (const def of WORKSPACE_DEPLOYMENT_SNAPSHOT_TOOLS) {
    assertEquals(def.category, "space");
    assert(def.name in WORKSPACE_DEPLOYMENT_SNAPSHOT_HANDLERS);
  }

  assertEquals(GROUP_DEPLOYMENT_SNAPSHOT_LIST.parameters.required, undefined);
  assertEquals(GROUP_DEPLOYMENT_SNAPSHOT_GET.parameters.required, [
    "group_deployment_snapshot_id",
  ]);
  assertEquals(
    GROUP_DEPLOYMENT_SNAPSHOT_DEPLOY_FROM_REPO.parameters.required,
    ["repository_url", "group_name"],
  );
  assertEquals(GROUP_DEPLOYMENT_SNAPSHOT_REMOVE.parameters.required, [
    "group_deployment_snapshot_id",
  ]);
  assertEquals(GROUP_DEPLOYMENT_SNAPSHOT_ROLLBACK.parameters.required, [
    "group_deployment_snapshot_id",
  ]);
});

Deno.test("group deployment snapshot handlers - call current service methods", async () => {
  const listStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "list",
    async () => [sampleDeployment],
  );
  const getStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "get",
    async () => sampleDeployment,
  );
  const deployStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "deploy",
    async () => sampleMutation,
  );
  const removeStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "remove",
    async () => undefined,
  );
  const rollbackStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "rollback",
    async () => sampleMutation,
  );

  try {
    const listResult = JSON.parse(
      await groupDeploymentSnapshotListHandler({}, makeContext()),
    );
    assertEquals(listResult.group_deployment_snapshots[0].id, "appdep-1");

    const getResult = JSON.parse(
      await groupDeploymentSnapshotGetHandler(
        { group_deployment_snapshot_id: "appdep-1" },
        makeContext(),
      ),
    );
    assertEquals(getResult.group_deployment_snapshot.id, "appdep-1");

    const deployResult = JSON.parse(
      await groupDeploymentSnapshotDeployFromRepoHandler(
        {
          repository_url: "https://github.com/acme/demo.git",
          group_name: "demo-group",
          ref: "v1.2.3",
          ref_type: "tag",
        },
        makeContext(),
      ),
    );
    assertEquals(deployResult.success, true);
    assertEquals(deployResult.data.groupDeploymentSnapshot.id, "appdep-1");

    const removeResult = JSON.parse(
      await groupDeploymentSnapshotRemoveHandler(
        { group_deployment_snapshot_id: "appdep-1" },
        makeContext(),
      ),
    );
    assertEquals(removeResult.success, true);
    assertEquals(removeResult.group_deployment_snapshot_id, "appdep-1");

    const rollbackResult = JSON.parse(
      await groupDeploymentSnapshotRollbackHandler(
        { group_deployment_snapshot_id: "appdep-1" },
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
        groupName: "demo-group",
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

Deno.test("groupDeploymentSnapshotGetHandler - validates snapshot id before service access", async () => {
  await assertRejects(
    async () => {
      await groupDeploymentSnapshotGetHandler(
        { group_deployment_snapshot_id: "" },
        makeContext(),
      );
    },
    Error,
    "group_deployment_snapshot_id is required",
  );
});

Deno.test("groupDeploymentSnapshotDeployFromRepoHandler - validates repository_url and ref_type", async () => {
  await assertRejects(
    async () => {
      await groupDeploymentSnapshotDeployFromRepoHandler(
        { repository_url: "" },
        makeContext(),
      );
    },
    Error,
    "repository_url is required",
  );

  await assertRejects(
    async () => {
      await groupDeploymentSnapshotDeployFromRepoHandler(
        {
          repository_url: "https://github.com/acme/demo.git",
          group_name: "demo-group",
          ref_type: "invalid",
        },
        makeContext(),
      );
    },
    Error,
    "ref_type must be one of",
  );

  await assertRejects(
    async () => {
      await groupDeploymentSnapshotDeployFromRepoHandler(
        {
          repository_url: "https://github.com/acme/demo.git",
          group_name: "",
        },
        makeContext(),
      );
    },
    Error,
    "group_name is required",
  );
});

Deno.test("remove and rollback handlers - validate snapshot id before service access", async () => {
  await assertRejects(
    async () => {
      await groupDeploymentSnapshotRemoveHandler(
        { group_deployment_snapshot_id: "" },
        makeContext(),
      );
    },
    Error,
    "group_deployment_snapshot_id is required",
  );

  await assertRejects(
    async () => {
      await groupDeploymentSnapshotRollbackHandler(
        { group_deployment_snapshot_id: "" },
        makeContext(),
      );
    },
    Error,
    "group_deployment_snapshot_id is required",
  );
});
