import { Hono } from "hono";
import type { Env, User } from "@/types";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

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

Deno.test("groups routes - updates provider/env on the group-id plan route before planning", async () => {
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
    assertEquals(updateCalls.length, 1);
    assertObjectMatch(updateCalls[0], {
      provider: "aws",
      env: "production",
    });
    assertSpyCalls(planManifestSpy, 1);
    const callArgs = planManifestSpy.calls[0]?.args as unknown[];
    assertEquals(callArgs[0], { DB: {} });
    assertEquals(callArgs[1], "group-1");
    assertEquals(callArgs[2], manifest);
    assertObjectMatch(callArgs[3] ?? {}, { envName: "production" });
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
