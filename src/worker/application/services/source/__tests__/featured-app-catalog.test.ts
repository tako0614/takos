import { test } from "bun:test";
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "@takos/test/assert";
import { getTableName } from "drizzle-orm";

import type { Env } from "../../../../shared/types/index.ts";
import {
  clearFeaturedAppCatalogCache,
  clearFeaturedAppCatalogEntries,
  featuredAppCatalogDeps,
  enqueueFeaturedAppPreinstallJob,
  getFeaturedAppReconcileStatus,
  preinstallFeaturedAppsForSpace,
  processFeaturedAppPreinstallJobs,
  resolveFeaturedAppCatalog,
  resolveFeaturedAppCatalogForBootstrap,
  resolveFeaturedAppInstallConfig,
  saveFeaturedAppCatalogEntries,
} from "../featured-app-catalog.ts";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    ...overrides,
  } as Env;
}

function isFeaturedAppCatalogConfigTable(table: unknown): boolean {
  try {
    return getTableName(table as never) === "featured_app_catalog_config";
  } catch {
    return false;
  }
}

function tableName(table: unknown): string | null {
  try {
    return getTableName(table as never);
  } catch {
    return null;
  }
}

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  assert(
    value != null && typeof value === "object" && !Array.isArray(value),
    `${field} must be an object`,
  );
  return value as Record<string, unknown>;
}

type FeaturedInstallPlanState = {
  id: string;
  workspaceId: string;
  source: Record<string, unknown>;
  capsule: Record<string, unknown>;
  options: Record<string, unknown>;
  phase: "syncing_source" | "reviewable";
  generation: number;
  sourceId?: string;
  capsuleId?: string;
  planRunId?: string;
};

const featuredInstallPlans = new Map<string, FeaturedInstallPlanState>();

function featuredInstallPlanBody(
  state: FeaturedInstallPlanState,
): Record<string, unknown> {
  return {
    id: state.id,
    workspaceId: state.workspaceId,
    createdBy: "subject_1",
    requestDigest: `digest_${state.id}`,
    source: state.source,
    capsule: state.capsule,
    options: state.options,
    phase: state.phase,
    generation: state.generation,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...(state.sourceId ? { sourceId: state.sourceId } : {}),
    ...(state.capsuleId ? { capsuleId: state.capsuleId } : {}),
    ...(state.planRunId ? { planRunId: state.planRunId } : {}),
  };
}

function canonicalFeaturedInstallResponse(
  input: string | URL | Request,
  init?: RequestInit,
): Response {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  if (
    method === "POST" &&
    last === "install-plans" &&
    segments.at(-3) === "workspaces"
  ) {
    const body = JSON.parse(String(init?.body)) as {
      source: Record<string, unknown>;
      capsule: Record<string, unknown>;
      options: Record<string, unknown>;
    };
    const capsuleName = String(body.capsule.name);
    const id = `gip_${capsuleName}`;
    const state: FeaturedInstallPlanState = {
      id,
      workspaceId: segments.at(-2) ?? "",
      source: body.source,
      capsule: body.capsule,
      options: body.options,
      phase: "syncing_source",
      generation: 0,
    };
    featuredInstallPlans.set(id, state);
    return Response.json(
      {
        installPlan: featuredInstallPlanBody(state),
        nextAction: "reconcile",
        links: {
          self: `/api/v1/install-plans/${id}`,
          reconcile: `/api/v1/install-plans/${id}/reconcile`,
        },
      },
      { status: 201 },
    );
  }
  if (method === "GET" && last !== "reconcile" && segments.at(-2) === "install-plans") {
    const state = featuredInstallPlans.get(last);
    if (!state) return Response.json({ error: "unknown install plan" }, { status: 404 });
    return Response.json({
      installPlan: featuredInstallPlanBody(state),
      nextAction: state.phase === "reviewable" ? "review_run" : "reconcile",
      links: {
        self: `/api/v1/install-plans/${state.id}`,
        ...(state.phase === "reviewable"
          ? { run: `/api/v1/runs/${state.planRunId}` }
          : { reconcile: `/api/v1/install-plans/${state.id}/reconcile` }),
      },
    });
  }
  if (method === "POST" && last === "reconcile" && segments.at(-3) === "install-plans") {
    const planId = segments.at(-2) ?? "";
    const state = featuredInstallPlans.get(planId);
    if (!state) return Response.json({ error: "unknown install plan" }, { status: 404 });
    const capsuleName = String(state.capsule.name);
    state.phase = "reviewable";
    state.generation = 1;
    state.sourceId = `src_${capsuleName}`;
    state.capsuleId = `cap_${capsuleName}`;
    state.planRunId = `run_plan_${capsuleName}`;
    return Response.json({
      installPlan: featuredInstallPlanBody(state),
      nextAction: "review_run",
      links: {
        self: `/api/v1/install-plans/${state.id}`,
        run: `/api/v1/runs/${state.planRunId}`,
      },
    });
  }
  if (method === "GET" && last.startsWith("run_plan_")) {
    const state = [...featuredInstallPlans.values()].find(
      (plan) => plan.planRunId === last,
    );
    if (!state) return Response.json({ error: "unknown plan Run" }, { status: 404 });
    return Response.json({
      run: {
        id: last,
        workspaceId: state.workspaceId,
        capsuleId: state.capsuleId,
        type: "plan",
        status: "succeeded",
      },
    });
  }
  if (
    method === "POST" &&
    last === "apply" &&
    segments.at(-2)?.startsWith("run_plan_")
  ) {
    const planRunId = segments.at(-2) ?? "";
    return Response.json(
      { run: { id: `run_apply_${planRunId}`, status: "queued" } },
      { status: 202 },
    );
  }
  return Response.json(
    { error: "unexpected canonical request" },
    { status: 500 },
  );
}

test("resolveFeaturedAppCatalog keeps fallback catalog empty", () => {
  const entries = resolveFeaturedAppCatalog(makeEnv());

  assertEquals(entries, []);
});

test("resolveFeaturedAppCatalog does not synthesize ecosystem app entries", () => {
  const entries = resolveFeaturedAppCatalog(
    makeEnv({
      TAKOS_FEATURED_APPS_PREINSTALL: "true",
    }),
  );

  assertEquals(entries, []);
});

test("resolveFeaturedAppCatalog keeps fallback apps catalog-only when global preinstall is enabled", () => {
  const entries = resolveFeaturedAppCatalog(
    makeEnv({
      TAKOS_FEATURED_APPS_PREINSTALL: "true",
    }),
  );

  assertEquals(
    entries.filter((entry) => entry.preinstall).map((entry) => entry.name),
    [],
  );
});

test("resolveFeaturedAppCatalog lets operators replace the catalog", () => {
  const entries = resolveFeaturedAppCatalog(
    makeEnv({
      TAKOS_FEATURED_APPS_PREINSTALL: "false",
      TAKOS_FEATURED_APP_REF: "stable",
      TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
        {
          name: "operator-docs",
          title: "Docs",
          repositoryUrl: "https://example.com/operator-docs.git",
          preinstall: true,
        },
      ]),
    }),
  );

  assertEquals(entries, [
    {
      name: "operator-docs",
      title: "Docs",
      repositoryUrl: "https://example.com/operator-docs.git",
      ref: "stable",
      refType: "branch",
      preinstall: true,
    },
  ]);
});

test("resolveFeaturedAppCatalog prefers catalog JSON over repository list JSON", () => {
  const entries = resolveFeaturedAppCatalog(
    makeEnv({
      TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
        {
          name: "catalog-docs",
          title: "Catalog Docs",
          repositoryUrl: "https://example.com/catalog-docs.git",
        },
      ]),
      TAKOS_FEATURED_APP_REPOSITORIES_JSON: JSON.stringify([
        {
          name: "repository-docs",
          title: "Repository Docs",
          url: "https://example.com/repository-docs.git",
        },
      ]),
    }),
  );

  assertEquals(
    entries.map((entry) => entry.name),
    ["catalog-docs"],
  );
});

test("resolveFeaturedAppCatalog accepts repository list JSON", () => {
  const entries = resolveFeaturedAppCatalog(
    makeEnv({
      TAKOS_FEATURED_APP_REF: "stable",
      TAKOS_FEATURED_APP_REF_TYPE: "tag",
      TAKOS_FEATURED_APP_REPOSITORIES_JSON: JSON.stringify([
        {
          name: "operator-docs",
          title: "Docs",
          url: "https://example.com/operator-docs.git",
        },
        "https://example.com/takos-whiteboard.git",
      ]),
    }),
  );

  assertEquals(entries, [
    {
      name: "operator-docs",
      title: "Docs",
      repositoryUrl: "https://example.com/operator-docs.git",
      ref: "stable",
      refType: "tag",
      preinstall: false,
    },
    {
      name: "takos-whiteboard",
      title: "takos-whiteboard",
      repositoryUrl: "https://example.com/takos-whiteboard.git",
      ref: "stable",
      refType: "tag",
      preinstall: false,
    },
  ]);
});

test("resolveFeaturedAppCatalogForBootstrap prefers repository list env over DB", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let selectCalled = false;
  const db = {
    select: () => {
      selectCalled = true;
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({
              all: async () => {
                throw new Error(
                  "should not read DB when env repositories are configured",
                );
              },
            }),
          }),
        }),
      };
    },
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const entries = await resolveFeaturedAppCatalogForBootstrap(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_REPOSITORIES_JSON: JSON.stringify([
          {
            name: "repository-docs",
            title: "Repository Docs",
            url: "https://example.com/repository-docs.git",
          },
        ]),
      }),
    );

    assertEquals(selectCalled, false);
    assertEquals(
      entries.map((entry) => entry.name),
      ["repository-docs"],
    );
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("resolveFeaturedAppCatalogForBootstrap honors the preinstall kill switch before parsing overrides", async () => {
  const entries = await resolveFeaturedAppCatalogForBootstrap(
    makeEnv({
      TAKOS_FEATURED_APPS_PREINSTALL: "false",
      TAKOS_FEATURED_APP_CATALOG_JSON: "{not json",
      TAKOS_FEATURED_APP_REPOSITORIES_JSON: "{also not json",
    }),
  );

  assertEquals(entries, []);
});

test("resolveFeaturedAppInstallConfig resolves explicit canonical operator automation", () => {
  assertEquals(
    resolveFeaturedAppInstallConfig(
      makeEnv({
        TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal/",
        TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
        TAKOS_APP_INSTALL_ACCOUNT_ID: "ws_operator",
        TAKOS_APP_INSTALL_MODE: "shared-cell",
      }),
    ),
    {
      controlUrl: "https://accounts.internal/",
      token: "accounts-token",
      workspaceId: "ws_operator",
      mode: "shared-cell",
    },
  );
  assertEquals(
    resolveFeaturedAppInstallConfig(
      makeEnv({
        TAKOS_FEATURED_APP_INSTALL_URL: "https://installer.internal/control",
        TAKOS_FEATURED_APP_INSTALL_TOKEN: "default-token",
        TAKOS_FEATURED_APP_INSTALL_ACCOUNT_ID: "ws_default",
        TAKOS_APP_INSTALL_SUBJECT: "tsub_shared",
      }),
    ),
    {
      controlUrl: "https://installer.internal/control",
      token: "default-token",
      workspaceId: "ws_default",
    },
  );
});

test("resolveFeaturedAppInstallConfig ignores retired generic URL/token aliases", () => {
  assertEquals(
    resolveFeaturedAppInstallConfig(
      {
        DB: {} as Env["DB"],
        TAKOS_APP_INSTALLATIONS_URL: "https://legacy.example/control",
        TAKOS_APP_INSTALL_TOKEN: "legacy-token",
      } as Env,
    ),
    null,
  );
});

test("resolveFeaturedAppCatalog rejects non-portable repository URLs", () => {
  assertThrows(
    () =>
      resolveFeaturedAppCatalog(
        makeEnv({
          TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
            {
              name: "operator-docs",
              title: "Docs",
              repositoryUrl: "git@example.com:operator/docs.git",
            },
          ]),
        }),
      ),
    Error,
    "must use HTTPS",
  );
});

test("resolveFeaturedAppCatalog rejects invalid global ref type", () => {
  assertThrows(
    () =>
      resolveFeaturedAppCatalog(
        makeEnv({
          TAKOS_FEATURED_APP_REF_TYPE: "branches",
        }),
      ),
    Error,
    "TAKOS_FEATURED_APP_REF_TYPE is invalid",
  );
});

test("resolveFeaturedAppCatalog rejects invalid global backend", () => {
  assertThrows(
    () =>
      resolveFeaturedAppCatalog(
        makeEnv({
          TAKOS_FEATURED_APP_BACKEND: "cloudfare",
        }),
      ),
    Error,
    "TAKOS_FEATURED_APP_BACKEND is invalid",
  );
});

test("getFeaturedAppReconcileStatus reports env catalog and preinstall jobs", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const jobRows = [
    {
      id: "featured-app-preinstall:space-1",
      spaceId: "space-1",
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "featured-app-preinstall:space-2",
      spaceId: "space-2",
      status: "blocked_by_config",
      attempts: 1,
      nextAttemptAt: "2026-01-01T00:01:00.000Z",
      lockedAt: null,
      lastError: "invalid ref",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    },
  ];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        all: async () =>
          tableName(table) === "featured_app_preinstall_jobs" ? jobRows : [],
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const status = await getFeaturedAppReconcileStatus(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "https://example.com/operator-docs.git",
            ref: "main",
            refType: "branch",
            preinstall: true,
          },
          {
            name: "operator-notes",
            title: "Notes",
            repositoryUrl: "https://example.com/operator-notes.git",
            ref: "main",
            refType: "branch",
            preinstall: false,
          },
        ]),
      }),
    );

    assertEquals(status.catalog.source, "env_catalog");
    assertEquals(status.catalog.totalEntries, 2);
    assertEquals(status.catalog.preinstallEntries, 1);
    assertEquals(status.jobs.available, true);
    assertEquals(status.jobs.total, 2);
    assertEquals(status.jobs.byStatus.queued, 1);
    assertEquals(status.jobs.byStatus.blocked_by_config, 1);
    assertEquals(status.jobs.latestUpdatedAt, "2026-01-01T00:02:00.000Z");
    assertEquals(status.jobs.lastErrors[0].spaceId, "space-2");
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("resolveFeaturedAppCatalogForBootstrap keeps an empty DB catalog empty", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let selectCalls = 0;
  const db = {
    select: () => {
      let table: unknown;
      return {
        from: (value: unknown) => {
          table = value;
          return {
            where: () =>
              isFeaturedAppCatalogConfigTable(table)
                ? {
                    get: async () => {
                      selectCalls++;
                      return { configured: true };
                    },
                  }
                : {
                    orderBy: () => ({
                      all: async () => {
                        selectCalls++;
                        return [];
                      },
                    }),
                  },
          };
        },
      };
    },
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const entries = await resolveFeaturedAppCatalogForBootstrap(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
      }),
    );

    assertEquals(selectCalls, 2);
    assertEquals(entries, []);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("resolveFeaturedAppCatalogForBootstrap falls back when DB read fails", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => {
              throw new Error("featured_app_catalog_entries is missing");
            },
          }),
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const entries = await resolveFeaturedAppCatalogForBootstrap(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
      }),
    );

    assertEquals(entries, []);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("resolveFeaturedAppCatalogForBootstrap rejects invalid DB configuration instead of falling back", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const db = {
    select: () => {
      let table: unknown;
      return {
        from: (value: unknown) => {
          table = value;
          return {
            where: () =>
              isFeaturedAppCatalogConfigTable(table)
                ? {
                    get: async () => ({ configured: true }),
                  }
                : {
                    orderBy: () => ({
                      all: async () => [
                        {
                          name: "persisted-docs",
                          title: "Docs",
                          repositoryUrl:
                            "https://example.com/persisted-docs.git",
                          ref: "main",
                          refType: "branches",
                          preinstall: true,
                          backendName: null,
                          envName: null,
                        },
                      ],
                    }),
                  },
          };
        },
      };
    },
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    await assertRejects(
      () =>
        resolveFeaturedAppCatalogForBootstrap(
          makeEnv({
            TAKOS_FEATURED_APPS_PREINSTALL: "true",
          }),
        ),
      Error,
      "entry.refType is invalid",
    );
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("resolveFeaturedAppCatalogForBootstrap reads persisted catalog once per cache window", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let selectCalls = 0;
  const db = {
    select: () => {
      let table: unknown;
      return {
        from: (value: unknown) => {
          table = value;
          return {
            where: () =>
              isFeaturedAppCatalogConfigTable(table)
                ? {
                    get: async () => {
                      selectCalls++;
                      return { configured: true };
                    },
                  }
                : {
                    orderBy: () => ({
                      all: async () => {
                        selectCalls++;
                        return [
                          {
                            name: "persisted-docs",
                            title: "Docs",
                            icon: "/icons/docs.svg",
                            repositoryUrl:
                              "https://example.com/persisted-docs.git",
                            ref: "main",
                            refType: "branch",
                            preinstall: true,
                            backendName: null,
                            envName: null,
                          },
                        ];
                      },
                    }),
                  },
          };
        },
      };
    },
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "true" });
    const first = await resolveFeaturedAppCatalogForBootstrap(env);
    const second = await resolveFeaturedAppCatalogForBootstrap(env);

    assertEquals(
      first.map((entry) => entry.name),
      ["persisted-docs"],
    );
    assertEquals(first[0].icon, "/icons/docs.svg");
    assertEquals(
      second.map((entry) => entry.name),
      ["persisted-docs"],
    );
    assertEquals(second[0].icon, "/icons/docs.svg");
    assertEquals(selectCalls, 2);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("resolveFeaturedAppCatalogForBootstrap keeps cache entries scoped per DB binding", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  function makeDb(name: string) {
    return {
      select: () => {
        let table: unknown;
        return {
          from: (value: unknown) => {
            table = value;
            return {
              where: () =>
                isFeaturedAppCatalogConfigTable(table)
                  ? {
                      get: async () => ({ configured: true }),
                    }
                  : {
                      orderBy: () => ({
                        all: async () => [
                          {
                            name,
                            title: name,
                            repositoryUrl: `https://example.com/${name}.git`,
                            ref: "main",
                            refType: "branch",
                            preinstall: true,
                            backendName: null,
                            envName: null,
                          },
                        ],
                      }),
                    },
            };
          },
        };
      },
    };
  }
  const db1 = makeDb("persisted-one");
  const db2 = makeDb("persisted-two");
  featuredAppCatalogDeps.getDb = ((db: Env["DB"]) => db) as any;

  try {
    const first = await resolveFeaturedAppCatalogForBootstrap(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        DB: db1 as unknown as Env["DB"],
      }),
    );
    const second = await resolveFeaturedAppCatalogForBootstrap(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        DB: db2 as unknown as Env["DB"],
      }),
    );

    assertEquals(
      first.map((entry) => entry.name),
      ["persisted-one"],
    );
    assertEquals(
      second.map((entry) => entry.name),
      ["persisted-two"],
    );
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("saveFeaturedAppCatalogEntries rejects duplicate names before mutating the DB", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let deleted = false;
  let inserted = false;
  const db = {
    delete: () => ({
      run: async () => {
        deleted = true;
      },
    }),
    insert: () => ({
      values: () => ({
        run: async () => {
          inserted = true;
        },
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    await assertRejects(() =>
      saveFeaturedAppCatalogEntries(
        makeEnv(),
        [
          {
            name: "duplicate-docs",
            title: "Docs A",
            repositoryUrl: "https://example.com/duplicate-docs-a.git",
          },
          {
            name: "duplicate-docs",
            title: "Docs B",
            repositoryUrl: "https://example.com/duplicate-docs-b.git",
          },
        ],
        { timestamp: "2026-01-01T00:00:00.000Z" },
      ),
    );
    assertEquals(deleted, false);
    assertEquals(inserted, false);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("saveFeaturedAppCatalogEntries replaces persisted repositories and warms cache", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let deletedEntries = false;
  let deletedConfig = false;
  let selectCalled = false;
  let inserted: Array<Record<string, unknown>> = [];
  const db = {
    delete: (table: unknown) =>
      isFeaturedAppCatalogConfigTable(table)
        ? {
            where: () => ({
              run: async () => {
                deletedConfig = true;
              },
            }),
          }
        : {
            run: async () => {
              deletedEntries = true;
            },
          },
    insert: (table: unknown) =>
      isFeaturedAppCatalogConfigTable(table)
        ? {
            values: () => ({
              run: async () => undefined,
            }),
          }
        : {
            values: (rows: Array<Record<string, unknown>>) => {
              inserted = rows;
              return { run: async () => undefined };
            },
          },
    update: () => ({
      set: () => ({
        where: () => ({
          run: async () => undefined,
        }),
      }),
    }),
    select: () => {
      selectCalled = true;
      return {
        from: (table: unknown) => {
          if (isFeaturedAppCatalogConfigTable(table)) {
            return {
              where: () => ({
                get: async () => ({ configured: true }),
              }),
            };
          }
          return {
            where: () => ({
              orderBy: () => ({
                all: async () => {
                  throw new Error("cache miss");
                },
              }),
            }),
          };
        },
      };
    },
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({
      TAKOS_FEATURED_APPS_PREINSTALL: "true",
      TAKOS_FEATURED_APP_REF: "stable",
    });
    const saved = await saveFeaturedAppCatalogEntries(
      env,
      [
        {
          name: "cached-docs",
          title: "Docs",
          icon: "/icons/cached.svg",
          repositoryUrl: "https://example.com/cached-docs.git",
        },
      ],
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );
    const resolved = await resolveFeaturedAppCatalogForBootstrap(env);

    assertEquals(deletedEntries, true);
    assertEquals(deletedConfig, true);
    assertEquals(
      saved.map((entry) => entry.name),
      ["cached-docs"],
    );
    assertEquals(saved[0].icon, "/icons/cached.svg");
    assertEquals(
      resolved.map((entry) => entry.name),
      ["cached-docs"],
    );
    assertEquals(resolved[0].icon, "/icons/cached.svg");
    assertEquals(selectCalled, false);
    assertEquals(inserted[0].id, "cached-docs");
    assertEquals(inserted[0].icon, "/icons/cached.svg");
    assertEquals(inserted[0].ref, "stable");
    assertEquals(inserted[0].position, 0);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("clearFeaturedAppCatalogEntries disables DB catalog and requeues blocked jobs", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const deletedTables: string[] = [];
  const insertedConfigs: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const db = {
    delete: (table: unknown) =>
      isFeaturedAppCatalogConfigTable(table)
        ? {
            where: () => ({
              run: async () => {
                deletedTables.push("featured_app_catalog_config");
              },
            }),
          }
        : {
            run: async () => {
              deletedTables.push(String(tableName(table)));
            },
          },
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        run: async () => {
          if (isFeaturedAppCatalogConfigTable(table)) {
            insertedConfigs.push(row);
          }
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "featured_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    await clearFeaturedAppCatalogEntries(
      makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "true" }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(deletedTables, [
      "featured_app_catalog_entries",
      "featured_app_catalog_config",
    ]);
    assertEquals(insertedConfigs[0].configured, false);
    assertEquals(jobUpdates[0].status, "queued");
    assertEquals(jobUpdates[0].catalogJson, null);
    assertEquals(jobUpdates[0].expectedGroupIdsJson, null);
    assertEquals(jobUpdates[0].applyQueuedAt, null);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("enqueueFeaturedAppPreinstallJob persists a queued job and honors the kill switch", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          run: async () => {
            inserted.push({ table: tableName(table), ...row });
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const disabled = await enqueueFeaturedAppPreinstallJob(
      makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "false" }),
      { spaceId: "space-disabled", createdByAccountId: "user-1" },
    );
    const id = await enqueueFeaturedAppPreinstallJob(
      makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "true" }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(disabled, null);
    assertEquals(id, "featured-app-preinstall:space-1");
    assertEquals(inserted.length, 1);
    assertEquals(inserted[0].table, "featured_app_preinstall_jobs");
    assertEquals(inserted[0].spaceId, "space-1");
    assertEquals(inserted[0].status, "queued");
    assertEquals(inserted[0].catalogJson, null);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("enqueueFeaturedAppPreinstallJob defers source resolution until processing", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          run: async () => {
            inserted.push({ table: tableName(table), ...row });
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    await enqueueFeaturedAppPreinstallJob(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "https://example.com/operator-docs.git",
            preinstall: true,
          },
          {
            name: "operator-notes",
            title: "Notes",
            repositoryUrl: "https://example.com/operator-notes.git",
            preinstall: false,
          },
        ]),
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(inserted[0].status, "queued");
    assertEquals(inserted[0].catalogJson, null);
    assertEquals(inserted[0].expectedGroupIdsJson, null);
    assertEquals(inserted[0].applyQueuedAt, null);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("processFeaturedAppPreinstallJobs pauses queued jobs when preinstall is disabled", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const jobRows = [
    {
      id: "featured-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      catalogJson: JSON.stringify([
        {
          name: "operator-docs",
          title: "Docs",
          repositoryUrl: "https://example.com/operator-docs.git",
          ref: "main",
          refType: "branch",
          preinstall: true,
        },
      ]),
      expectedGroupIdsJson: null,
      applyQueuedAt: null,
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "featured_app_preinstall_jobs"
                  ? jobRows
                  : [],
            }),
          }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "featured_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const summary = await processFeaturedAppPreinstallJobs(
      makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "false" }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.paused, 1);
    assertEquals(
      jobUpdates.map((update) => update.status),
      ["in_progress", "paused_by_operator"],
    );
    assertEquals(jobUpdates.at(-1)?.nextAttemptAt, "2026-01-01T00:01:00.000Z");
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("processFeaturedAppPreinstallJobs applies featured apps through Capsule install when configured", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  const originalFetch = featuredAppCatalogDeps.fetch;
  clearFeaturedAppCatalogCache();
  const jobRows = [
    {
      id: "featured-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "acct-owner",
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
      catalogJson: JSON.stringify([
        {
          name: "takos-office",
          title: "Office",
          repositoryUrl: "https://github.com/tako0614/takos-office.git",
          ref: "v0.1.0",
          refType: "tag",
          preinstall: true,
        },
        {
          name: "takos-computer",
          title: "Computer",
          repositoryUrl: "https://github.com/tako0614/takos-computer.git",
          ref: "v2.1.2",
          refType: "tag",
          preinstall: true,
        },
        {
          name: "yurucommu",
          title: "Yurucommu",
          repositoryUrl: "https://github.com/tako0614/yurucommu.git",
          ref: "main",
          refType: "branch",
          modulePath: ".",
          preinstall: true,
        },
      ]),
      expectedGroupIdsJson: null,
      applyQueuedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const jobStatuses: unknown[] = [];
  const sentRequests: Request[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: () => ({
            get: async () => undefined,
            orderBy: () => ({
              limit: () => ({
                all: async () =>
                  name === "featured_app_preinstall_jobs" ? jobRows : [],
              }),
              all: async () => [],
            }),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "featured_app_preinstall_jobs") {
              jobStatuses.push(value.status);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;
  featuredAppCatalogDeps.fetch = async (input, init) => {
    sentRequests.push(new Request(input, init));
    return canonicalFeaturedInstallResponse(input, init);
  };

  try {
    const summary = await processFeaturedAppPreinstallJobs(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_INSTALL_URL: "https://installer.internal/control",
        TAKOS_FEATURED_APP_INSTALL_TOKEN: "install-token",
        TAKOS_FEATURED_APP_INSTALL_ACCOUNT_ID: "ws_operator",
        TAKOS_FEATURED_APP_INSTALL_MODE: "shared-cell",
        TAKOS_FEATURED_APP_INSTALL_RUNTIME_BASE_URL:
          "https://apps.example.test",
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.completed, 1);
    assertEquals(jobStatuses, ["in_progress", "completed"]);
    assertEquals(sentRequests.length, 18);
    assertEquals(
      sentRequests[0].url,
      "https://installer.internal/control/api/v1/workspaces/ws_operator/install-plans",
    );
    assertEquals(
      sentRequests[0].headers.get("authorization"),
      "Bearer install-token",
    );
    assertEquals(
      sentRequests[0].headers.get("Idempotency-Key"),
      "featured-app-preinstall:space-1:takos-office",
    );
    const body = await sentRequests[0].json();
    assertEquals(body, {
      source: {
        name: "takos-office-source",
        url: "https://github.com/tako0614/takos-office.git",
        ref: "v0.1.0",
        path: ".",
      },
      capsule: { name: "takos-office", environment: "production" },
      options: {},
    });
    assertEquals(
      sentRequests[5].url,
      "https://installer.internal/control/api/v1/runs/run_plan_takos-office/apply",
    );
    assertEquals(await sentRequests[5].json(), {});
    assertEquals(
      sentRequests.some((request) => new URL(request.url).pathname.endsWith("/approve")),
      false,
    );
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
    featuredAppCatalogDeps.fetch = originalFetch;
  }
});

test("processFeaturedAppPreinstallJobs blocks incomplete Capsule install config", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  const originalFetch = featuredAppCatalogDeps.fetch;
  clearFeaturedAppCatalogCache();
  const jobRows = [
    {
      id: "featured-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const jobUpdates: Array<Record<string, unknown>> = [];
  let fetchCalled = false;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: async () => undefined,
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "featured_app_preinstall_jobs"
                  ? jobRows
                  : [],
            }),
          }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "featured_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;
  featuredAppCatalogDeps.fetch = async () => {
    fetchCalled = true;
    return Response.json({ ok: true });
  };

  try {
    const summary = await processFeaturedAppPreinstallJobs(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "https://example.com/operator-docs.git",
          },
        ]),
        TAKOS_FEATURED_APP_INSTALL_URL: "https://installer.internal/control",
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.blocked, 1);
    assertEquals(fetchCalled, false);
    assertEquals(
      jobUpdates.map((update) => update.status),
      ["in_progress", "blocked_by_config"],
    );
    assertEquals(
      String(jobUpdates.at(-1)?.lastError).includes(
        "canonical control URL, token, and Takosumi Workspace id",
      ),
      true,
    );
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
    featuredAppCatalogDeps.fetch = originalFetch;
  }
});

test("processFeaturedAppPreinstallJobs skips rows another processor already claimed", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const jobRows = [
    {
      id: "featured-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: async () => undefined,
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "featured_app_preinstall_jobs"
                  ? jobRows
                  : [],
            }),
          }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: () => ({
          run: async () =>
            tableName(table) === "featured_app_preinstall_jobs"
              ? { success: true, meta: { changes: 0 } }
              : undefined,
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const summary = await processFeaturedAppPreinstallJobs(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "https://example.com/operator-docs.git",
          },
        ]),
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.scanned, 1);
    assertEquals(summary.processed, 0);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("processFeaturedAppPreinstallJobs blocks invalid config without permanent failure", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const jobRows = [
    {
      id: "featured-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: async () => undefined,
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "featured_app_preinstall_jobs"
                  ? jobRows
                  : [],
            }),
          }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "featured_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const summary = await processFeaturedAppPreinstallJobs(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_REF_TYPE: "invalid",
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.blocked, 1);
    assertEquals(summary.failed, 0);
    assertEquals(jobUpdates.at(-1)?.status, "blocked_by_config");
    assertEquals(jobUpdates.at(-1)?.nextAttemptAt, "2026-01-01T00:01:00.000Z");
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("preinstallFeaturedAppsForSpace requires Capsule install config", async () => {
  await assertRejects(
    () =>
      preinstallFeaturedAppsForSpace(
        makeEnv({
          TAKOS_FEATURED_APPS_PREINSTALL: "true",
          TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
            {
              name: "operator-docs",
              title: "Docs",
              repositoryUrl: "https://example.com/operator-docs.git",
              preinstall: true,
            },
          ]),
        }),
        {
          spaceId: "space-1",
          createdByAccountId: "user-1",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ),
    Error,
    "Featured app preinstall requires Capsule install API config",
  );
});

test("preinstallFeaturedAppsForSpace applies explicitly opted-in apps through Capsule install when configured", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  const originalFetch = featuredAppCatalogDeps.fetch;
  clearFeaturedAppCatalogCache();
  const fetchCalls: Array<{
    url: string;
    method: string;
    authorization: string | null;
    body: Record<string, unknown> | null;
  }> = [];
  featuredAppCatalogDeps.getDb = (() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => [],
          }),
          get: async () => undefined,
        }),
      }),
    }),
  })) as any;
  featuredAppCatalogDeps.fetch = async (input, init) => {
    fetchCalls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null,
    });
    return canonicalFeaturedInstallResponse(input, init);
  };

  try {
    const installed = await preinstallFeaturedAppsForSpace(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "true",
        TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
          {
            name: "takos-office",
            title: "Office",
            repositoryUrl: "https://github.com/tako0614/takos-office.git",
            ref: "v0.1.0",
            refType: "tag",
            sourcePath: "outputs.tf",
            preinstall: true,
          },
          {
            name: "takos-computer",
            title: "Computer",
            repositoryUrl: "https://github.com/tako0614/takos-computer.git",
            ref: "v2.1.2",
            refType: "tag",
            sourcePath: "outputs.tf",
            preinstall: true,
          },
          {
            name: "yurucommu",
            title: "Yurucommu",
            repositoryUrl: "https://github.com/tako0614/yurucommu.git",
            ref: "main",
            refType: "branch",
            modulePath: ".",
            preinstall: true,
          },
        ]),
        TAKOS_FEATURED_APP_INSTALL_URL: "https://installer.internal/control",
        TAKOS_FEATURED_APP_INSTALL_TOKEN: "install-token",
        TAKOS_FEATURED_APP_INSTALL_ACCOUNT_ID: "ws_operator",
        TAKOS_FEATURED_APP_INSTALL_MODE: "shared-cell",
        TAKOS_FEATURED_APP_INSTALL_RUNTIME_BASE_URL:
          "https://takos.example.com",
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "acct-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(
      installed.map((entry) => entry.name),
      ["takos-office", "takos-computer", "yurucommu"],
    );
    assertEquals(fetchCalls.length, 18);
    assertEquals(
      fetchCalls[0].url,
      "https://installer.internal/control/api/v1/workspaces/ws_operator/install-plans",
    );
    assertEquals(
      fetchCalls.at(-1)?.url,
      "https://installer.internal/control/api/v1/runs/run_plan_yurucommu/apply",
    );
    assertEquals(
      fetchCalls.every((call) => call.authorization === "Bearer install-token"),
      true,
    );
    assertEquals(
      fetchCalls.some((call) => new URL(call.url).pathname.endsWith("/approve")),
      false,
    );
    const installPlanCreates = fetchCalls.filter(
      (call) =>
        call.method === "POST" &&
        new URL(call.url).pathname.endsWith("/install-plans"),
    );
    assertEquals(
      installPlanCreates.map((call) => call.body?.source),
      [
        {
          name: "takos-office-source",
          url: "https://github.com/tako0614/takos-office.git",
          ref: "v0.1.0",
          path: ".",
        },
        {
          name: "takos-computer-source",
          url: "https://github.com/tako0614/takos-computer.git",
          ref: "v2.1.2",
          path: ".",
        },
        {
          name: "yurucommu-source",
          url: "https://github.com/tako0614/yurucommu.git",
          ref: "main",
          path: ".",
        },
      ],
    );
    assertEquals(
      installPlanCreates.map((call) => call.body?.capsule),
      [
        { name: "takos-office", environment: "production" },
        { name: "takos-computer", environment: "production" },
        { name: "yurucommu", environment: "production" },
      ],
    );
    assertEquals(
      installPlanCreates.every((call) =>
        Object.keys(call.body?.options ?? {}).length === 0,
      ),
      true,
    );
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
    featuredAppCatalogDeps.fetch = originalFetch;
  }
});

test("preinstallFeaturedAppsForSpace skips database work when preinstall is disabled", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let getDbCalled = false;
  featuredAppCatalogDeps.getDb = ((db: Env["DB"]) => {
    getDbCalled = true;
    return db;
  }) as any;

  try {
    const installed = await preinstallFeaturedAppsForSpace(
      makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "false" }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(installed, []);
    assertEquals(getDbCalled, false);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("preinstallFeaturedAppsForSpace honors the kill switch even when env entries request preinstall", async () => {
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  let getDbCalled = false;
  let inserted = false;
  featuredAppCatalogDeps.getDb = ((db: Env["DB"]) => {
    getDbCalled = true;
    return db;
  }) as any;

  try {
    const installed = await preinstallFeaturedAppsForSpace(
      makeEnv({
        TAKOS_FEATURED_APPS_PREINSTALL: "false",
        TAKOS_FEATURED_APP_CATALOG_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "https://example.com/operator-docs.git",
            preinstall: true,
          },
        ]),
        DB: {
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  all: async () => [],
                }),
                get: async () => undefined,
              }),
            }),
          }),
          insert: () => ({
            values: async () => {
              inserted = true;
            },
          }),
        } as unknown as Env["DB"],
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(installed, []);
    assertEquals(getDbCalled, false);
    assertEquals(inserted, false);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("invalidateCatalogCache drops the in-memory cache entry for a DB binding", async () => {
  const { getCatalogCacheEntry, invalidateCatalogCache, setCatalogCacheEntry } =
    await import("../featured-app-catalog-internal.ts");

  const dbBinding = {} as Env["DB"];
  setCatalogCacheEntry(dbBinding, {
    key: "test-key",
    catalog: { configured: true, entries: [] },
    expiresAt: Date.now() + 30_000,
  });
  assert(getCatalogCacheEntry(dbBinding) !== null);

  invalidateCatalogCache(dbBinding);
  assertEquals(getCatalogCacheEntry(dbBinding), null);
});

test("saveFeaturedAppCatalogEntries invalidates the cache before reseeding fresh data", async () => {
  const { getCatalogCacheEntry, setCatalogCacheEntry } =
    await import("../featured-app-catalog-internal.ts");
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const db = {
    delete: (table: unknown) =>
      isFeaturedAppCatalogConfigTable(table)
        ? { where: () => ({ run: async () => undefined }) }
        : { run: async () => undefined },
    insert: () => ({
      values: () => ({ run: async () => undefined }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ run: async () => undefined }) }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "true" });
    // Seed a stale entry that should not survive the writer.
    setCatalogCacheEntry(env.DB, {
      key: "STALE",
      catalog: {
        configured: true,
        entries: [
          {
            name: "stale-app",
            title: "Stale",
            repositoryUrl: "https://example.com/stale.git",
            ref: "main",
            refType: "branch",
            preinstall: false,
          },
        ],
      },
      expiresAt: Date.now() + 30_000,
    });
    assertEquals(getCatalogCacheEntry(env.DB)?.key, "STALE");

    await saveFeaturedAppCatalogEntries(
      env,
      [
        {
          name: "fresh-app",
          title: "Fresh",
          repositoryUrl: "https://example.com/fresh.git",
        },
      ],
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    const cached = getCatalogCacheEntry(env.DB);
    assert(cached !== null);
    assertEquals(
      cached.catalog.entries.map((e) => e.name),
      ["fresh-app"],
    );
    // The pre-existing stale key must have been dropped before reseeding.
    assertEquals(cached.key === "STALE", false);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});

test("clearFeaturedAppCatalogEntries invalidates the cache before reseeding empty state", async () => {
  const { getCatalogCacheEntry, setCatalogCacheEntry } =
    await import("../featured-app-catalog-internal.ts");
  const originalGetDb = featuredAppCatalogDeps.getDb;
  clearFeaturedAppCatalogCache();
  const db = {
    delete: (table: unknown) =>
      isFeaturedAppCatalogConfigTable(table)
        ? { where: () => ({ run: async () => undefined }) }
        : { run: async () => undefined },
    insert: () => ({
      values: () => ({ run: async () => undefined }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ run: async () => undefined }) }),
    }),
  };
  featuredAppCatalogDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_FEATURED_APPS_PREINSTALL: "true" });
    setCatalogCacheEntry(env.DB, {
      key: "STALE-CLEAR",
      catalog: {
        configured: true,
        entries: [
          {
            name: "stale",
            title: "Stale",
            repositoryUrl: "https://example.com/stale.git",
            ref: "main",
            refType: "branch",
            preinstall: false,
          },
        ],
      },
      expiresAt: Date.now() + 30_000,
    });

    await clearFeaturedAppCatalogEntries(env, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const cached = getCatalogCacheEntry(env.DB);
    assert(cached !== null);
    assertEquals(cached.catalog.configured, false);
    assertEquals(cached.catalog.entries, []);
    assertEquals(cached.key === "STALE-CLEAR", false);
  } finally {
    clearFeaturedAppCatalogCache();
    featuredAppCatalogDeps.getDb = originalGetDb;
  }
});
