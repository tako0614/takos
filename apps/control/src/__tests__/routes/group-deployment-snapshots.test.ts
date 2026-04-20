import { Hono } from "hono";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { isAppError } from "takos-common/errors";
import type { Env } from "@/types";
import {
  type GroupDeploymentSnapshotMutationResult,
  type GroupDeploymentSnapshotRecord,
  GroupDeploymentSnapshotService,
} from "@/services/platform/group-deployment-snapshots";
import { routeAuthDeps } from "@/routes/route-auth";
import groupDeploymentSnapshotRoutes from "@/routes/group-deployment-snapshots.ts";

const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;

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

function toApiSampleDeployment(deployment: GroupDeploymentSnapshotRecord) {
  const { rollback_of_group_deployment_snapshot_id, ...rest } = deployment;
  return {
    ...rest,
    rollback_of_group_deployment_snapshot_id:
      rollback_of_group_deployment_snapshot_id,
  };
}

const sampleApplyResult: GroupDeploymentSnapshotMutationResult["applyResult"] =
  {
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
  };

const samplePlanResult = {
  group: { id: null, name: "demo-group", exists: false },
  diff: sampleApplyResult.diff,
  translationReport: sampleApplyResult.translationReport,
};

function mockSpaceAccess() {
  routeAuthDeps.requireSpaceAccess = (async () => ({
    space: { id: "ws1" },
    membership: { role: "owner" },
  })) as unknown as typeof routeAuthDeps.requireSpaceAccess;
}

function createApp(user?: { id: string }) {
  const app = new Hono<
    { Bindings: Env; Variables: { user?: { id: string } } }
  >();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/", groupDeploymentSnapshotRoutes);
  return app;
}

function makeEnv(): Partial<Env> {
  return {
    DB: {} as Env["DB"],
  };
}

const publicBackendFieldNames = new Set([
  "backend",
  "backendName",
  "backend_name",
  "backendStateJson",
  "backend_state_json",
  "backend",
  "backendName",
  "backend_name",
  "backendState",
  "backendStateJson",
  "backend_state",
  "backend_state_json",
]);

function assertNoPublicBackendFields(value: unknown) {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPublicBackendFields(entry);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assertEquals(publicBackendFieldNames.has(key), false, key);
    assertNoPublicBackendFields(entry);
  }
}

Deno.test("group deployment snapshot backend routes - deploys from a repository URL", async () => {
  const deployStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "deploy",
    async () => ({
      groupDeploymentSnapshot: sampleDeployment,
      applyResult: sampleApplyResult,
    }),
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: "demo-group",
          env: "staging",
          target: ["gateway", "gateway:/"],
          source: {
            kind: "git_ref",
            repository_url: "https://github.com/acme/demo.git",
            ref: "main",
            ref_type: "branch",
          },
        }),
      },
      makeEnv(),
    );

    assertEquals(res.status, 201);
    await assertObjectMatch(await res.json(), {
      group_deployment_snapshot: toApiSampleDeployment(sampleDeployment),
      apply_result: sampleApplyResult,
    });
    assertSpyCalls(deployStub, 1);
    assertSpyCallArgs(deployStub, 0, [
      "ws1",
      "user-1",
      {
        groupName: "demo-group",
        envName: "staging",
        targets: ["gateway", "gateway:/"],
        source: {
          kind: "git_ref",
          repositoryUrl: "https://github.com/acme/demo.git",
          ref: "main",
          refType: "branch",
        },
      },
    ]);
  } finally {
    deployStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - rejects backend field in public requests", async () => {
  const deployStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "deploy",
    async () => {
      throw new Error("deploy should not be called");
    },
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: "demo-group",
          env: "staging",
          backend: "cloudflare",
          source: {
            kind: "git_ref",
            repository_url: "https://github.com/acme/demo.git",
          },
        }),
      },
      makeEnv(),
    );

    const expectedStatus = 400;
    assertEquals(res.status, expectedStatus);
    assertSpyCalls(deployStub, 0);
  } finally {
    deployStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - strips backend fields from plan responses", async () => {
  const planStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "plan",
    async () =>
      ({
        ...samplePlanResult,
        translationReport: {
          backend: "aws",
          supported: true,
          requirements: [],
          workloads: [
            {
              name: "gateway",
              category: "worker",
              backend: "takos-worker-runtime",
              runtime: "workers",
              runtimeProfile: "workers",
              status: "compatible",
              requirements: [],
            },
          ],
          routes: [
            {
              name: "gateway",
              target: "gateway",
              backend: "takos-routing",
              status: "compatible",
              requirements: [],
            },
          ],
          unsupported: [],
        },
      }) as unknown as Awaited<
        ReturnType<GroupDeploymentSnapshotService["plan"]>
      >,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: "demo-group",
          source: {
            kind: "git_ref",
            repository_url: "https://github.com/acme/demo.git",
          },
        }),
      },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    assertNoPublicBackendFields(await res.json());
  } finally {
    planStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - rejects backend fields in manifest source", async () => {
  const deployStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "deployFromManifest",
    async () => {
      throw new Error("deployFromManifest should not be called");
    },
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: {
            kind: "manifest",
            manifest: {
              name: "demo-group",
              backend: "cloudflare",
              compute: {},
              routes: [],
              publish: [],
            },
          },
        }),
      },
      makeEnv(),
    );

    assertEquals(res.status, 400);
    assertSpyCalls(deployStub, 0);
  } finally {
    deployStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - plans from a repository URL without mutating", async () => {
  const planStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "plan",
    async () => samplePlanResult,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: "demo-group",
          env: "staging",
          target: ["gateway"],
          source: {
            kind: "git_ref",
            repository_url: "https://github.com/acme/demo.git",
            ref: "main",
            ref_type: "branch",
          },
        }),
      },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), samplePlanResult);
    assertSpyCalls(planStub, 1);
    assertSpyCallArgs(planStub, 0, [
      "ws1",
      "user-1",
      {
        source: {
          kind: "git_ref",
          repositoryUrl: "https://github.com/acme/demo.git",
          ref: "main",
          refType: "branch",
        },
        groupName: "demo-group",
        envName: "staging",
        targets: ["gateway"],
      },
    ]);
  } finally {
    planStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - lists deployments", async () => {
  const listStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "list",
    async () => [sampleDeployment],
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request("/spaces/ws1/group-deployment-snapshots", {
      method: "GET",
    }, makeEnv());

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), {
      group_deployment_snapshots: [toApiSampleDeployment(sampleDeployment)],
    });
    assertSpyCalls(listStub, 1);
    assertSpyCallArgs(listStub, 0, ["ws1"]);
  } finally {
    listStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - gets a deployment", async () => {
  const getStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "get",
    async () => sampleDeployment,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots/appdep-1",
      { method: "GET" },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), {
      group_deployment_snapshot: toApiSampleDeployment(sampleDeployment),
    });
    assertSpyCalls(getStub, 1);
    assertSpyCallArgs(getStub, 0, ["ws1", "appdep-1"]);
  } finally {
    getStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - rolls back a deployment", async () => {
  const rollbackStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "rollback",
    async () => ({
      groupDeploymentSnapshot: {
        ...sampleDeployment,
        id: "appdep-2",
        rollback_of_group_deployment_snapshot_id: "appdep-1",
      },
      applyResult: sampleApplyResult,
    }),
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots/appdep-1/rollback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), {
      group_deployment_snapshot: {
        id: "appdep-2",
        rollback_of_group_deployment_snapshot_id: "appdep-1",
      },
      apply_result: sampleApplyResult,
    });
    assertSpyCalls(rollbackStub, 1);
    assertSpyCallArgs(rollbackStub, 0, ["ws1", "user-1", "appdep-1"]);
  } finally {
    rollbackStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("group deployment snapshot backend routes - removes a deployment history record", async () => {
  const removeStub = stub(
    GroupDeploymentSnapshotService.prototype,
    "remove",
    async () => undefined,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/group-deployment-snapshots/appdep-1",
      { method: "DELETE" },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), { deleted: true });
    assertSpyCalls(removeStub, 1);
    assertSpyCallArgs(removeStub, 0, ["ws1", "appdep-1"]);
  } finally {
    removeStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});
