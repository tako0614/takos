import { Hono } from "hono";
import type { Env, User } from "@/types";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import { isAppError } from "takos-common/errors";

import groupsRouter from "@/routes/groups";
import { groupsRouteDeps } from "../../../../../packages/control/src/server/routes/groups/routes.ts";
import { routeAuthDeps } from "@/routes/route-auth";

type GroupRow = {
  id: string;
  spaceId: string;
  name: string;
  appVersion: string | null;
  backend: string | null;
  env: string | null;
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  sourceCommitSha: string | null;
  currentGroupDeploymentSnapshotId: string | null;
  desiredSpecJson: string | null;
  backendStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function createUser(id = "user-1"): User {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    username: id,
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function createGroupRow(): GroupRow {
  return {
    id: "group-1",
    spaceId: "ws1",
    name: "demo-group",
    appVersion: "1.0.0",
    backend: "cloudflare",
    env: "staging",
    sourceKind: null,
    sourceRepositoryUrl: null,
    sourceRef: null,
    sourceRefType: null,
    sourceCommitSha: null,
    currentGroupDeploymentSnapshotId: null,
    desiredSpecJson: null,
    backendStateJson: "{}",
    reconcileStatus: "idle",
    lastAppliedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
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

function createGroupDb(initialRow: GroupRow) {
  let row = initialRow;
  const updateCalls: Array<Record<string, unknown>> = [];

  return {
    db: {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  get: async () => row,
                  all: async () => [row],
                };
              },
            };
          },
        };
      },
      update() {
        return {
          set(payload: Record<string, unknown>) {
            updateCalls.push(payload);
            row = {
              ...row,
              ...payload,
            };
            return {
              where() {
                return {
                  run: async () => undefined,
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoUpdate() {
                return Promise.resolve(undefined);
              },
            };
          },
        };
      },
      delete() {
        return {
          where() {
            return {
              run: async () => undefined,
            };
          },
        };
      },
    },
    updateCalls,
  };
}

function createApp(user = createUser()) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
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
    c.set("user", user);
    await next();
  });
  app.route("/", groupsRouter);
  return app;
}

Deno.test("groups routes - does not expose the legacy /entities inventory endpoints", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db } = createGroupDb(createGroupRow());
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest = spy(async () => ({
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      backend: "aws",
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  })) as typeof groupsRouteDeps.planManifest;
  groupsRouteDeps.applyManifest = async () => ({
    groupId: "group-1",
    applied: [],
    skipped: [],
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      backend: "aws",
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  });
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const res = await app.request("/spaces/ws1/groups/group-1/entities", {
      method: "GET",
    });

    assertEquals(res.status, 404);
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});

Deno.test("groups routes - passes env overrides to the group-id plan route without mutating the group", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db, updateCalls } = createGroupDb(createGroupRow());
  const planManifestSpy = spy(async () =>
    ({
      diff: {
        entries: [],
        hasChanges: false,
        summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
      },
      translationReport: {
        backend: "aws",
        supported: true,
        requirements: [],
        workloads: [{
          name: "gateway",
          category: "worker",
          backend: "takos-worker-runtime",
          runtime: "workers",
          runtimeProfile: "workers",
          status: "compatible",
          requirements: [],
        }],
        routes: [{
          name: "gateway",
          target: "gateway",
          backend: "takos-routing",
          status: "compatible",
          requirements: [],
        }],
        unsupported: [],
      },
    }) as unknown as Awaited<ReturnType<typeof groupsRouteDeps.planManifest>>
  );
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest =
    planManifestSpy as typeof groupsRouteDeps.planManifest;
  groupsRouteDeps.applyManifest = async () => {
    throw new Error("applyManifest should not be called");
  };
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const manifest = {
      metadata: { name: "demo-group" },
      spec: { version: "1.0.0" },
    };

    const res = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          env: "production",
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    const json = await res.json() as {
      translationReport?: Record<string, unknown>;
    };
    assertNoPublicBackendFields(json);
    assertEquals(updateCalls.length, 0);
    assertSpyCalls(planManifestSpy, 1);
    const callArgs = planManifestSpy.calls[0]?.args as unknown[];
    assertEquals(callArgs[0], { DB: {} });
    assertEquals(callArgs[1], "group-1");
    assertEquals(callArgs[2], manifest);
    assertObjectMatch(callArgs[3] ?? {}, {
      backendName: "cloudflare",
      envName: "production",
      groupName: "demo-group",
    });
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});

Deno.test("groups routes - rejects backend fields inside public manifest input", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db } = createGroupDb(createGroupRow());
  const planManifestSpy = spy(async () => ({
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  }));
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest =
    planManifestSpy as typeof groupsRouteDeps.planManifest;
  groupsRouteDeps.applyManifest = async () => {
    throw new Error("applyManifest should not be called");
  };
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest: {
            name: "demo-group",
            backend: "cloudflare",
            compute: {},
            routes: [],
            publish: [],
          },
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 400);
    await assertObjectMatch(await res.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "manifest must not contain backend fields",
      },
    });
    assertSpyCalls(planManifestSpy, 0);
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});

Deno.test("groups routes - rejects backend input on public group mutation routes", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db, updateCalls } = createGroupDb(createGroupRow());
  const planManifestSpy = spy(async () => ({
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      backend: "aws",
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  }));
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest =
    planManifestSpy as typeof groupsRouteDeps.planManifest;
  groupsRouteDeps.applyManifest = async () => {
    throw new Error("applyManifest should not be called");
  };
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const manifest = {
      metadata: { name: "demo-group" },
      spec: { version: "1.0.0" },
    };

    const planRes = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "aws",
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(planRes.status, 400);
    await assertObjectMatch(await planRes.json(), {
      error: {
        code: "BAD_REQUEST",
        message:
          "retired backend fields are not accepted on public group routes",
      },
    });
    assertSpyCalls(planManifestSpy, 0);

    const patchRes = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/metadata", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "aws",
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(patchRes.status, 400);
    await assertObjectMatch(await patchRes.json(), {
      error: {
        code: "BAD_REQUEST",
        message:
          "retired backend fields are not accepted on public group routes",
      },
    });
    assertEquals(updateCalls.length, 0);
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});

Deno.test("groups routes - updates env on the group-id apply route before apply", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db, updateCalls } = createGroupDb(createGroupRow());
  const applyManifestSpy = spy(async () => {
    assertEquals(updateCalls.length, 1);
    assertObjectMatch(updateCalls[0], {
      env: "preview",
    });
    return {
      groupId: "group-1",
      applied: [],
      skipped: [],
      diff: {
        entries: [],
        hasChanges: false,
        summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
      },
      translationReport: {
        backend: "aws",
        supported: true,
        requirements: [],
        workloads: [],
        routes: [],
        unsupported: [],
      },
    };
  });
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest = async () => ({
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      backend: "aws",
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  });
  groupsRouteDeps.applyManifest =
    applyManifestSpy as typeof groupsRouteDeps.applyManifest;
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const manifest = {
      metadata: { name: "demo-group" },
      spec: { version: "1.0.0" },
    };

    const res = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          env: "preview",
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    const json = await res.json() as {
      translationReport?: Record<string, unknown>;
    };
    assertNoPublicBackendFields(json);
    assertEquals(updateCalls.length, 2);
    assertObjectMatch(updateCalls[0], {
      env: "preview",
    });
    assertEquals("backend" in updateCalls[0], false);
    assertObjectMatch(updateCalls[1], {
      sourceKind: "local_upload",
      currentGroupDeploymentSnapshotId: null,
    });
    assertSpyCalls(applyManifestSpy, 1);
    const callArgs = applyManifestSpy.calls[0]?.args as unknown[] | undefined;
    assertEquals(callArgs?.[0], { DB: {} });
    assertEquals(callArgs?.[1], "group-1");
    assertEquals(callArgs?.[2], manifest);
    assertObjectMatch(
      (callArgs?.[3] as Record<string, unknown> | undefined) ?? {},
      {
        envName: "preview",
      },
    );
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});

Deno.test("groups routes - local_upload source projection intentionally clears current deployment snapshot id", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db, updateCalls } = createGroupDb({
    ...createGroupRow(),
    sourceKind: "git_ref",
    sourceRepositoryUrl: "https://github.com/acme/demo.git",
    sourceRef: "main",
    sourceRefType: "branch",
    sourceCommitSha: "commit-old",
    currentGroupDeploymentSnapshotId: "appdep-old",
  });
  const applyManifestSpy = spy(async () => ({
    groupId: "group-1",
    applied: [{
      name: "gateway",
      category: "worker",
      action: "create",
      status: "success",
    }],
    skipped: [],
    diff: {
      entries: [{
        name: "gateway",
        category: "worker",
        action: "create",
      }],
      hasChanges: true,
      summary: { create: 1, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      backend: "cloudflare",
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  }));
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest = async () => {
    throw new Error("planManifest should not be called");
  };
  groupsRouteDeps.applyManifest =
    applyManifestSpy as typeof groupsRouteDeps.applyManifest;
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const manifest = {
      metadata: { name: "demo-group" },
      spec: { version: "1.0.0" },
    };

    const res = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest,
          source: { kind: "local_upload" },
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    assertSpyCalls(applyManifestSpy, 1);
    assertEquals(updateCalls.length, 1);
    assertObjectMatch(updateCalls[0], {
      sourceKind: "local_upload",
      sourceRepositoryUrl: null,
      sourceRef: null,
      sourceRefType: null,
      sourceCommitSha: null,
      currentGroupDeploymentSnapshotId: null,
    });

    const groupRes = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1", {
        method: "GET",
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(groupRes.status, 200);
    const groupJson = await groupRes.json() as Record<string, unknown>;
    await assertObjectMatch(groupJson, {
      id: "group-1",
      sourceKind: "local_upload",
      currentGroupDeploymentSnapshotId: null,
    });
    assertEquals("backend" in groupJson, false);
    assertEquals("backendStateJson" in groupJson, false);
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});

Deno.test("groups routes - rejects non-https git_ref source projection on apply", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db } = createGroupDb(createGroupRow());
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest = async () => {
    throw new Error("planManifest should not be called");
  };
  groupsRouteDeps.applyManifest = async () => {
    throw new Error("applyManifest should not be called");
  };
  routeAuthDeps.requireSpaceAccess = async () => ({
    space: { id: "ws1" },
  } as any);

  try {
    const app = createApp();
    const manifest = {
      metadata: { name: "demo-group" },
      spec: { version: "1.0.0" },
    };

    const res = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifest,
          source: {
            kind: "git_ref",
            repository_url: "ssh://github.com/acme/demo.git",
            ref: "main",
            ref_type: "branch",
          },
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 400);
    await assertObjectMatch(await res.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "source.repository_url must use https://",
      },
    });
  } finally {
    groupsRouteDeps.getDb = originalDeps.getDb;
    groupsRouteDeps.getGroupState = originalDeps.getGroupState;
    groupsRouteDeps.planManifest = originalDeps.planManifest;
    groupsRouteDeps.applyManifest = originalDeps.applyManifest;
    groupsRouteDeps.parseAppManifestYaml = originalDeps.parseAppManifestYaml;
    routeAuthDeps.requireSpaceAccess = originalDeps.requireSpaceAccess;
  }
});
