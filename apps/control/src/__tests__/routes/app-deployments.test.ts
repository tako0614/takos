import { Hono } from "hono";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { isAppError } from "takos-common/errors";
import type { Env } from "@/types";
import {
  type AppDeploymentMutationResult,
  type AppDeploymentRecord,
  AppDeploymentService,
} from "@/services/platform/app-deployments";
import { routeAuthDeps } from "@/routes/route-auth";
import appDeploymentRoutes from "@/routes/apps/deployments";

const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;

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

const sampleApplyResult: AppDeploymentMutationResult["applyResult"] = {
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
  app.route("/", appDeploymentRoutes);
  return app;
}

function makeEnv(): Partial<Env> {
  return {
    DB: {} as Env["DB"],
  };
}

Deno.test("app deployment routes - deploys from a repository URL", async () => {
  const deployStub = stub(
    AppDeploymentService.prototype,
    "deploy",
    async () => ({
      appDeployment: sampleDeployment,
      applyResult: sampleApplyResult,
    }),
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/app-deployments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: "demo-group",
          env: "staging",
          provider: "cloudflare",
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
      app_deployment: sampleDeployment,
      apply_result: sampleApplyResult,
    });
    assertSpyCalls(deployStub, 1);
    assertSpyCallArgs(deployStub, 0, [
      "ws1",
      "user-1",
      {
        groupName: "demo-group",
        providerName: "cloudflare",
        envName: "staging",
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

Deno.test("app deployment routes - plans from a repository URL without mutating", async () => {
  const planStub = stub(
    AppDeploymentService.prototype,
    "plan",
    async () => samplePlanResult,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/app-deployments/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: "demo-group",
          env: "staging",
          provider: "cloudflare",
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
        providerName: "cloudflare",
        envName: "staging",
      },
    ]);
  } finally {
    planStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("app deployment routes - lists deployments", async () => {
  const listStub = stub(
    AppDeploymentService.prototype,
    "list",
    async () => [sampleDeployment],
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request("/spaces/ws1/app-deployments", {
      method: "GET",
    }, makeEnv());

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), {
      app_deployments: [sampleDeployment],
    });
    assertSpyCalls(listStub, 1);
    assertSpyCallArgs(listStub, 0, ["ws1"]);
  } finally {
    listStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("app deployment routes - gets a deployment", async () => {
  const getStub = stub(
    AppDeploymentService.prototype,
    "get",
    async () => sampleDeployment,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/app-deployments/appdep-1",
      { method: "GET" },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), {
      app_deployment: sampleDeployment,
    });
    assertSpyCalls(getStub, 1);
    assertSpyCallArgs(getStub, 0, ["ws1", "appdep-1"]);
  } finally {
    getStub.restore();
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});

Deno.test("app deployment routes - rolls back a deployment", async () => {
  const rollbackStub = stub(
    AppDeploymentService.prototype,
    "rollback",
    async () => ({
      appDeployment: {
        ...sampleDeployment,
        id: "appdep-2",
        rollback_of_app_deployment_id: "appdep-1",
      },
      applyResult: sampleApplyResult,
    }),
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/app-deployments/appdep-1/rollback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );

    assertEquals(res.status, 200);
    await assertObjectMatch(await res.json(), {
      app_deployment: {
        id: "appdep-2",
        rollback_of_app_deployment_id: "appdep-1",
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

Deno.test("app deployment routes - removes a deployment history record", async () => {
  const removeStub = stub(
    AppDeploymentService.prototype,
    "remove",
    async () => undefined,
  );

  try {
    mockSpaceAccess();
    const app = createApp({ id: "user-1" });
    const res = await app.request(
      "/spaces/ws1/app-deployments/appdep-1",
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
