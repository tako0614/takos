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
  provider: string | null;
  env: string | null;
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  sourceCommitSha: string | null;
  currentAppDeploymentId: string | null;
  desiredSpecJson: string | null;
  providerStateJson: string | null;
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
    provider: "cloudflare",
    env: "staging",
    sourceKind: null,
    sourceRepositoryUrl: null,
    sourceRef: null,
    sourceRefType: null,
    sourceCommitSha: null,
    currentAppDeploymentId: null,
    desiredSpecJson: null,
    providerStateJson: "{}",
    reconcileStatus: "idle",
    lastAppliedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
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
      provider: "aws",
      supported: true,
      requirements: [],
      resources: [],
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
      provider: "aws",
      supported: true,
      requirements: [],
      resources: [],
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

Deno.test("groups routes - passes provider/env overrides to the group-id plan route without mutating the group", async () => {
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
      provider: "aws",
      supported: true,
      requirements: [],
      resources: [],
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

    const res = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "aws",
          env: "production",
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    assertEquals(updateCalls.length, 0);
    assertSpyCalls(planManifestSpy, 1);
    const callArgs = planManifestSpy.calls[0]?.args as unknown[];
    assertEquals(callArgs[0], { DB: {} });
    assertEquals(callArgs[1], "group-1");
    assertEquals(callArgs[2], manifest);
    assertObjectMatch(callArgs[3] ?? {}, {
      providerName: "aws",
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

Deno.test("groups routes - updates provider/env on the group-id apply route before apply", async () => {
  const originalDeps = {
    getDb: groupsRouteDeps.getDb,
    getGroupState: groupsRouteDeps.getGroupState,
    planManifest: groupsRouteDeps.planManifest,
    applyManifest: groupsRouteDeps.applyManifest,
    parseAppManifestYaml: groupsRouteDeps.parseAppManifestYaml,
    requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  };

  const { db, updateCalls } = createGroupDb(createGroupRow());
  const applyManifestSpy = spy(async () => ({
    groupId: "group-1",
    applied: [],
    skipped: [],
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      provider: "aws",
      supported: true,
      requirements: [],
      resources: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  }));
  groupsRouteDeps.getDb = (() => db) as any;
  groupsRouteDeps.getGroupState = async () => null;
  groupsRouteDeps.planManifest = async () => ({
    diff: {
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      provider: "aws",
      supported: true,
      requirements: [],
      resources: [],
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
          provider: "k8s",
          env: "preview",
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    assertEquals(updateCalls.length, 1);
    assertObjectMatch(updateCalls[0], {
      provider: "k8s",
      env: "preview",
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

Deno.test("groups routes - local_upload source projection intentionally clears current app deployment id", async () => {
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
    currentAppDeploymentId: "appdep-old",
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
      provider: "cloudflare",
      supported: true,
      requirements: [],
      resources: [],
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
      currentAppDeploymentId: null,
    });

    const groupRes = await app.fetch(
      new Request("http://localhost/spaces/ws1/groups/group-1", {
        method: "GET",
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    assertEquals(groupRes.status, 200);
    await assertObjectMatch(await groupRes.json(), {
      id: "group-1",
      sourceKind: "local_upload",
      currentAppDeploymentId: null,
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
