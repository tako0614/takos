import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { getTableName } from "drizzle-orm";

import type { Env } from "../../../../shared/types/index.ts";
import {
  clearDefaultAppDistributionCache,
  clearDefaultAppDistributionEntries,
  defaultAppDistributionDeps,
  enqueueDefaultAppPreinstallJob,
  preinstallDefaultAppsForSpace,
  processDefaultAppPreinstallJobs,
  resolveDefaultAppDistribution,
  resolveDefaultAppDistributionForBootstrap,
  saveDefaultAppDistributionEntries,
} from "../default-app-distribution.ts";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env["DB"],
    ...overrides,
  } as Env;
}

function isDefaultAppDistributionConfigTable(table: unknown): boolean {
  try {
    return getTableName(table as never) === "default_app_distribution_config";
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

Deno.test("resolveDefaultAppDistribution returns docs, excel, and slide by default", () => {
  const entries = resolveDefaultAppDistribution(makeEnv());

  assertEquals(entries.map((entry) => entry.name), [
    "takos-docs",
    "takos-excel",
    "takos-slide",
  ]);
  assertEquals(entries.every((entry) => entry.preinstall), true);
  assertEquals(
    entries.map((entry) => entry.repositoryUrl),
    [
      "https://github.com/tako0614/takos-docs.git",
      "https://github.com/tako0614/takos-excel.git",
      "https://github.com/tako0614/takos-slide.git",
    ],
  );
});

Deno.test("resolveDefaultAppDistribution lets operators replace the distribution", () => {
  const entries = resolveDefaultAppDistribution(makeEnv({
    TAKOS_DEFAULT_APPS_PREINSTALL: "false",
    TAKOS_DEFAULT_APP_REF: "stable",
    TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
      {
        name: "operator-docs",
        title: "Docs",
        repositoryUrl: "https://example.com/operator-docs.git",
        preinstall: true,
      },
    ]),
  }));

  assertEquals(entries, [{
    name: "operator-docs",
    title: "Docs",
    repositoryUrl: "https://example.com/operator-docs.git",
    ref: "stable",
    refType: "branch",
    preinstall: true,
  }]);
});

Deno.test("resolveDefaultAppDistribution prefers distribution JSON over repository list JSON", () => {
  const entries = resolveDefaultAppDistribution(makeEnv({
    TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
      {
        name: "distribution-docs",
        title: "Distribution Docs",
        repositoryUrl: "https://example.com/distribution-docs.git",
      },
    ]),
    TAKOS_DEFAULT_APP_REPOSITORIES_JSON: JSON.stringify([
      {
        name: "repository-docs",
        title: "Repository Docs",
        url: "https://example.com/repository-docs.git",
      },
    ]),
  }));

  assertEquals(entries.map((entry) => entry.name), ["distribution-docs"]);
});

Deno.test("resolveDefaultAppDistribution accepts repository list JSON", () => {
  const entries = resolveDefaultAppDistribution(makeEnv({
    TAKOS_DEFAULT_APP_REF: "stable",
    TAKOS_DEFAULT_APP_REF_TYPE: "tag",
    TAKOS_DEFAULT_APP_REPOSITORIES_JSON: JSON.stringify([
      {
        name: "operator-docs",
        title: "Docs",
        url: "https://example.com/operator-docs.git",
      },
      "https://example.com/takos-whiteboard.git",
    ]),
  }));

  assertEquals(entries, [
    {
      name: "operator-docs",
      title: "Docs",
      repositoryUrl: "https://example.com/operator-docs.git",
      ref: "stable",
      refType: "tag",
      preinstall: true,
    },
    {
      name: "takos-whiteboard",
      title: "takos-whiteboard",
      repositoryUrl: "https://example.com/takos-whiteboard.git",
      ref: "stable",
      refType: "tag",
      preinstall: true,
    },
  ]);
});

Deno.test("resolveDefaultAppDistributionForBootstrap prefers repository list env over DB", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const entries = await resolveDefaultAppDistributionForBootstrap(makeEnv({
      TAKOS_DEFAULT_APP_REPOSITORIES_JSON: JSON.stringify([
        {
          name: "repository-docs",
          title: "Repository Docs",
          url: "https://example.com/repository-docs.git",
        },
      ]),
    }));

    assertEquals(selectCalled, false);
    assertEquals(entries.map((entry) => entry.name), ["repository-docs"]);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("resolveDefaultAppDistribution rejects non-portable repository URLs", () => {
  assertThrows(
    () =>
      resolveDefaultAppDistribution(makeEnv({
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "git@example.com:operator/docs.git",
          },
        ]),
      })),
    Error,
    "must use HTTPS",
  );
});

Deno.test("resolveDefaultAppDistribution rejects invalid global ref type", () => {
  assertThrows(
    () =>
      resolveDefaultAppDistribution(makeEnv({
        TAKOS_DEFAULT_APP_REF_TYPE: "branches",
      })),
    Error,
    "TAKOS_DEFAULT_APP_REF_TYPE is invalid",
  );
});

Deno.test("resolveDefaultAppDistribution rejects invalid global backend", () => {
  assertThrows(
    () =>
      resolveDefaultAppDistribution(makeEnv({
        TAKOS_DEFAULT_APP_BACKEND: "cloudfare",
      })),
    Error,
    "TAKOS_DEFAULT_APP_BACKEND is invalid",
  );
});

Deno.test("resolveDefaultAppDistributionForBootstrap keeps an empty DB distribution empty", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let selectCalls = 0;
  const db = {
    select: () => {
      let table: unknown;
      return {
        from: (value: unknown) => {
          table = value;
          return {
            where: () =>
              isDefaultAppDistributionConfigTable(table)
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const entries = await resolveDefaultAppDistributionForBootstrap(makeEnv());

    assertEquals(selectCalls, 2);
    assertEquals(entries, []);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("resolveDefaultAppDistributionForBootstrap falls back when DB read fails", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => {
              throw new Error("default_app_distribution_entries is missing");
            },
          }),
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const entries = await resolveDefaultAppDistributionForBootstrap(makeEnv());

    assertEquals(entries.map((entry) => entry.name), [
      "takos-docs",
      "takos-excel",
      "takos-slide",
    ]);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("resolveDefaultAppDistributionForBootstrap rejects invalid DB configuration instead of falling back", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const db = {
    select: () => {
      let table: unknown;
      return {
        from: (value: unknown) => {
          table = value;
          return {
            where: () =>
              isDefaultAppDistributionConfigTable(table)
                ? {
                  get: async () => ({ configured: true }),
                }
                : {
                  orderBy: () => ({
                    all: async () => [{
                      name: "persisted-docs",
                      title: "Docs",
                      repositoryUrl: "https://example.com/persisted-docs.git",
                      ref: "main",
                      refType: "branches",
                      preinstall: true,
                      backendName: null,
                      envName: null,
                    }],
                  }),
                },
          };
        },
      };
    },
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    await assertRejects(
      () => resolveDefaultAppDistributionForBootstrap(makeEnv()),
      Error,
      "entry.refType is invalid",
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("resolveDefaultAppDistributionForBootstrap reads persisted distribution once per cache window", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let selectCalls = 0;
  const db = {
    select: () => {
      let table: unknown;
      return {
        from: (value: unknown) => {
          table = value;
          return {
            where: () =>
              isDefaultAppDistributionConfigTable(table)
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
                      return [{
                        name: "persisted-docs",
                        title: "Docs",
                        repositoryUrl: "https://example.com/persisted-docs.git",
                        ref: "main",
                        refType: "branch",
                        preinstall: true,
                        backendName: null,
                        envName: null,
                      }];
                    },
                  }),
                },
          };
        },
      };
    },
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv();
    const first = await resolveDefaultAppDistributionForBootstrap(env);
    const second = await resolveDefaultAppDistributionForBootstrap(env);

    assertEquals(first.map((entry) => entry.name), ["persisted-docs"]);
    assertEquals(second.map((entry) => entry.name), ["persisted-docs"]);
    assertEquals(selectCalls, 2);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("resolveDefaultAppDistributionForBootstrap keeps cache entries scoped per DB binding", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  function makeDb(name: string) {
    return {
      select: () => {
        let table: unknown;
        return {
          from: (value: unknown) => {
            table = value;
            return {
              where: () =>
                isDefaultAppDistributionConfigTable(table)
                  ? {
                    get: async () => ({ configured: true }),
                  }
                  : {
                    orderBy: () => ({
                      all: async () => [{
                        name,
                        title: name,
                        repositoryUrl: `https://example.com/${name}.git`,
                        ref: "main",
                        refType: "branch",
                        preinstall: true,
                        backendName: null,
                        envName: null,
                      }],
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
  defaultAppDistributionDeps.getDb = ((db: Env["DB"]) => db) as any;

  try {
    const first = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({ DB: db1 as unknown as Env["DB"] }),
    );
    const second = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({ DB: db2 as unknown as Env["DB"] }),
    );

    assertEquals(first.map((entry) => entry.name), ["persisted-one"]);
    assertEquals(second.map((entry) => entry.name), ["persisted-two"]);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("saveDefaultAppDistributionEntries rejects duplicate names before mutating the DB", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    await assertRejects(
      () =>
        saveDefaultAppDistributionEntries(
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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("saveDefaultAppDistributionEntries replaces persisted repositories and warms cache", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let deletedEntries = false;
  let deletedConfig = false;
  let selectCalled = false;
  let inserted: Array<Record<string, unknown>> = [];
  const db = {
    delete: (table: unknown) =>
      isDefaultAppDistributionConfigTable(table)
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
      isDefaultAppDistributionConfigTable(table)
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
          if (isDefaultAppDistributionConfigTable(table)) {
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_DEFAULT_APP_REF: "stable" });
    const saved = await saveDefaultAppDistributionEntries(
      env,
      [{
        name: "cached-docs",
        title: "Docs",
        repositoryUrl: "https://example.com/cached-docs.git",
      }],
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );
    const resolved = await resolveDefaultAppDistributionForBootstrap(
      env,
    );

    assertEquals(deletedEntries, true);
    assertEquals(deletedConfig, true);
    assertEquals(saved.map((entry) => entry.name), ["cached-docs"]);
    assertEquals(resolved.map((entry) => entry.name), ["cached-docs"]);
    assertEquals(selectCalled, false);
    assertEquals(inserted[0].id, "cached-docs");
    assertEquals(inserted[0].ref, "stable");
    assertEquals(inserted[0].position, 0);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("clearDefaultAppDistributionEntries disables DB distribution and requeues blocked jobs", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const deletedTables: string[] = [];
  const insertedConfigs: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const db = {
    delete: (table: unknown) =>
      isDefaultAppDistributionConfigTable(table)
        ? {
          where: () => ({
            run: async () => {
              deletedTables.push("default_app_distribution_config");
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
          if (isDefaultAppDistributionConfigTable(table)) {
            insertedConfigs.push(row);
          }
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    await clearDefaultAppDistributionEntries(
      makeEnv(),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(deletedTables, [
      "default_app_distribution_entries",
      "default_app_distribution_config",
    ]);
    assertEquals(insertedConfigs[0].configured, false);
    assertEquals(jobUpdates[0].status, "queued");
    assertEquals(jobUpdates[0].distributionJson, null);
    assertEquals(jobUpdates[0].expectedGroupIdsJson, null);
    assertEquals(jobUpdates[0].deploymentQueuedAt, null);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("enqueueDefaultAppPreinstallJob persists a queued job and honors the kill switch", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const disabled = await enqueueDefaultAppPreinstallJob(
      makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "false" }),
      { spaceId: "space-disabled", createdByAccountId: "user-1" },
    );
    const id = await enqueueDefaultAppPreinstallJob(
      makeEnv(),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(disabled, null);
    assertEquals(id, "default-app-preinstall:space-1");
    assertEquals(inserted.length, 1);
    assertEquals(inserted[0].table, "default_app_preinstall_jobs");
    assertEquals(inserted[0].spaceId, "space-1");
    assertEquals(inserted[0].status, "queued");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("enqueueDefaultAppPreinstallJob stores the resolved preinstall snapshot", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    await enqueueDefaultAppPreinstallJob(
      makeEnv({
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
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

    const snapshot = JSON.parse(
      String(inserted[0].distributionJson),
    ) as Array<Record<string, unknown>>;
    assertEquals(inserted[0].status, "queued");
    assertEquals(snapshot.map((entry) => entry.name), ["operator-docs"]);
    assertEquals(inserted[0].expectedGroupIdsJson, null);
    assertEquals(inserted[0].deploymentQueuedAt, null);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs pauses queued jobs when preinstall is disabled", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    distributionJson: JSON.stringify([{
      name: "operator-docs",
      title: "Docs",
      repositoryUrl: "https://example.com/operator-docs.git",
      ref: "main",
      refType: "branch",
      preinstall: true,
    }]),
    expectedGroupIdsJson: null,
    deploymentQueuedAt: null,
    status: "queued",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const jobUpdates: Array<Record<string, unknown>> = [];
  let sendCalled = false;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "default_app_preinstall_jobs"
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
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "false",
        DEPLOY_QUEUE: {
          send: async () => {
            sendCalled = true;
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.paused, 1);
    assertEquals(summary.deploymentQueued, 0);
    assertEquals(jobUpdates.map((update) => update.status), [
      "in_progress",
      "paused_by_operator",
    ]);
    assertEquals(jobUpdates.at(-1)?.nextAttemptAt, "2026-01-01T00:01:00.000Z");
    assertEquals(sendCalled, false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs completes stale deployment queued jobs when expected groups are applied", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    distributionJson: JSON.stringify([{
      name: "operator-docs",
      title: "Docs",
      repositoryUrl: "https://example.com/operator-docs.git",
      ref: "main",
      refType: "branch",
      preinstall: true,
    }]),
    expectedGroupIdsJson: JSON.stringify(["group-1"]),
    deploymentQueuedAt: "2026-01-01T00:00:00.000Z",
    status: "deployment_queued",
    attempts: 1,
    nextAttemptAt: null,
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const jobUpdates: Array<Record<string, unknown>> = [];
  let sendCalled = false;
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: () => ({
            get: async () =>
              name === "groups"
                ? {
                  id: "group-1",
                  spaceId: "space-1",
                  currentGroupDeploymentSnapshotId: "snapshot-1",
                }
                : undefined,
            orderBy: () => ({
              limit: () => ({
                all: async () =>
                  name === "default_app_preinstall_jobs" ? jobRows : [],
              }),
            }),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        DEPLOY_QUEUE: {
          send: async () => {
            sendCalled = true;
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      {
        timestamp: "2026-01-01T01:00:00.000Z",
        deploymentWatchdogMs: 15 * 60_000,
      },
    );

    assertEquals(summary.completed, 1);
    assertEquals(summary.deploymentQueued, 0);
    assertEquals(jobUpdates.map((update) => update.status), [
      "in_progress",
      "completed",
    ]);
    assertEquals(sendCalled, false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs retries stale deployment queued jobs with the stored snapshot", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    distributionJson: JSON.stringify([{
      name: "operator-docs",
      title: "Docs",
      repositoryUrl: "https://example.com/operator-docs.git",
      ref: "main",
      refType: "branch",
      preinstall: true,
    }]),
    expectedGroupIdsJson: JSON.stringify(["group-1"]),
    deploymentQueuedAt: "2026-01-01T00:00:00.000Z",
    status: "deployment_queued",
    attempts: 1,
    nextAttemptAt: null,
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const sentMessages: Array<Record<string, unknown>> = [];
  const groupUpdates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: () => ({
            get: async () =>
              name === "groups"
                ? {
                  id: "group-1",
                  spaceId: "space-1",
                  name: "operator-docs",
                  sourceKind: "git_ref",
                  sourceRepositoryUrl: "https://example.com/operator-docs.git",
                  sourceRef: "main",
                  sourceRefType: "branch",
                  currentGroupDeploymentSnapshotId: null,
                }
                : undefined,
            orderBy: () => ({
              limit: () => ({
                all: async () =>
                  name === "default_app_preinstall_jobs" ? jobRows : [],
              }),
            }),
          }),
        };
      },
    }),
    insert: () => ({
      values: async () => undefined,
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            if (tableName(table) === "groups") {
              groupUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([{
          name: "changed-docs",
          title: "Changed",
          repositoryUrl: "https://example.com/changed-docs.git",
        }]),
        DEPLOY_QUEUE: {
          send: async (message: Record<string, unknown>) => {
            sentMessages.push(message);
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      {
        timestamp: "2026-01-01T01:00:00.000Z",
        deploymentWatchdogMs: 15 * 60_000,
      },
    );

    assertEquals(summary.deploymentQueued, 1);
    assertEquals(sentMessages.map((message) => message.groupName), [
      "operator-docs",
    ]);
    assertEquals(groupUpdates.length, 1);
    assertEquals(jobUpdates.at(-1)?.status, "deployment_queued");
    assertEquals(
      jobUpdates.at(-1)?.deploymentQueuedAt,
      "2026-01-01T01:00:00.000Z",
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs sends deployment jobs and waits for deployment outcome", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    status: "queued",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const groupsInserted: Array<Record<string, unknown>> = [];
  const jobStatuses: unknown[] = [];
  const sentMessages: Array<Record<string, unknown>> = [];
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
                  name === "default_app_preinstall_jobs" ? jobRows : [],
              }),
              all: async () => [],
            }),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: Record<string, unknown>) => {
        if (tableName(table) === "groups") groupsInserted.push(value);
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobStatuses.push(value.status);
            }
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        DEPLOY_QUEUE: {
          send: async (message: Record<string, unknown>) => {
            sentMessages.push(message);
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.completed, 0);
    assertEquals(summary.deploymentQueued, 1);
    assertEquals(summary.requeued, 0);
    assertEquals(jobStatuses, ["in_progress", "deployment_queued"]);
    assertEquals(groupsInserted.length, 3);
    assertEquals(sentMessages.length, 3);
    assertEquals(sentMessages[0].reason, "default_app_preinstall");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs requeues when deployment queue send fails", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    status: "queued",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const groupsInserted: Array<Record<string, unknown>> = [];
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
                  name === "default_app_preinstall_jobs" ? jobRows : [],
              }),
              all: async () => [],
            }),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: Record<string, unknown>) => {
        if (tableName(table) === "groups") groupsInserted.push(value);
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        DEPLOY_QUEUE: {
          send: async () => {
            throw new Error("queue unavailable");
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.completed, 0);
    assertEquals(summary.requeued, 1);
    assertEquals(groupsInserted.length, 1);
    assertEquals(jobUpdates.at(-1)?.status, "queued");
    assertEquals(jobUpdates.at(-1)?.lastError, "queue unavailable");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs reclaims stale in-progress jobs only", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
      id: "default-app-preinstall:active-space",
      spaceId: "active-space",
      createdByAccountId: "user-1",
      status: "in_progress",
      attempts: 1,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: "2026-01-01T00:55:00.000Z",
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:55:00.000Z",
    },
    {
      id: "default-app-preinstall:stale-space",
      spaceId: "stale-space",
      createdByAccountId: "user-1",
      status: "in_progress",
      attempts: 1,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: "2026-01-01T00:30:00.000Z",
      lastError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:30:00.000Z",
    },
  ];
  const sentMessages: Array<Record<string, unknown>> = [];
  const processedSpaces: string[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: () => ({
            get: async () => {
              if (name === "groups") return undefined;
              return undefined;
            },
            orderBy: () => ({
              limit: () => ({
                all: async () =>
                  name === "default_app_preinstall_jobs" ? jobRows : [],
              }),
              all: async () => [],
            }),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: async (value: Record<string, unknown>) => {
        if (tableName(table) === "groups") {
          processedSpaces.push(value.spaceId as string);
        }
      },
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: () => ({
          run: async () =>
            tableName(table) === "default_app_preinstall_jobs"
              ? { success: true, meta: { changes: 1 } }
              : undefined,
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([{
          name: "operator-docs",
          title: "Docs",
          repositoryUrl: "https://example.com/operator-docs.git",
        }]),
        DEPLOY_QUEUE: {
          send: async (message: Record<string, unknown>) => {
            sentMessages.push(message);
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      {
        timestamp: "2026-01-01T01:00:00.000Z",
        leaseMs: 15 * 60_000,
      },
    );

    assertEquals(summary.scanned, 2);
    assertEquals(summary.processed, 1);
    assertEquals(summary.deploymentQueued, 1);
    assertEquals(processedSpaces, ["stale-space"]);
    assertEquals(sentMessages.length, 1);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs skips rows another worker already claimed", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    status: "queued",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  let sendCalled = false;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: async () => undefined,
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "default_app_preinstall_jobs"
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
            tableName(table) === "default_app_preinstall_jobs"
              ? { success: true, meta: { changes: 0 } }
              : undefined,
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([{
          name: "operator-docs",
          title: "Docs",
          repositoryUrl: "https://example.com/operator-docs.git",
        }]),
        DEPLOY_QUEUE: {
          send: async () => {
            sendCalled = true;
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.scanned, 1);
    assertEquals(summary.processed, 0);
    assertEquals(sendCalled, false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs blocks invalid config without permanent failure", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    status: "queued",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: async () => undefined,
          orderBy: () => ({
            limit: () => ({
              all: async () =>
                tableName(table) === "default_app_preinstall_jobs"
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
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APP_REF_TYPE: "invalid",
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.blocked, 1);
    assertEquals(summary.failed, 0);
    assertEquals(jobUpdates.at(-1)?.status, "blocked_by_config");
    assertEquals(jobUpdates.at(-1)?.nextAttemptAt, "2026-01-01T00:01:00.000Z");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("processDefaultAppPreinstallJobs fails conflicting existing groups", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [{
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    createdByAccountId: "user-1",
    status: "queued",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lockedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: () => ({
            get: async () =>
              name === "groups"
                ? {
                  id: "group-1",
                  spaceId: "space-1",
                  name: "operator-docs",
                  sourceKind: "git_ref",
                  sourceRepositoryUrl: "https://example.com/other.git",
                  sourceRef: "main",
                  sourceRefType: "branch",
                }
                : undefined,
            orderBy: () => ({
              limit: () => ({
                all: async () =>
                  name === "default_app_preinstall_jobs" ? jobRows : [],
              }),
            }),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([{
          name: "operator-docs",
          title: "Docs",
          repositoryUrl: "https://example.com/operator-docs.git",
        }]),
        DEPLOY_QUEUE: {
          send: async () => undefined,
        } as Env["DEPLOY_QUEUE"],
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.failed, 1);
    assertEquals(jobUpdates.at(-1)?.status, "failed");
    assertEquals(
      String(jobUpdates.at(-1)?.lastError).includes("operator-docs"),
      true,
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("preinstallDefaultAppsForSpace inserts configured git-ref groups", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const inserts: Array<Record<string, unknown>> = [];
  const sentMessages: Array<Record<string, unknown>> = [];
  const db = {
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
      values: async (value: Record<string, unknown>) => {
        inserts.push(value);
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          run: async () => undefined,
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const installed = await preinstallDefaultAppsForSpace(
      makeEnv({
        DEPLOY_QUEUE: {
          send: async (message: Record<string, unknown>) => {
            sentMessages.push(message);
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(installed.map((entry) => entry.name), [
      "takos-docs",
      "takos-excel",
      "takos-slide",
    ]);
    assertEquals(inserts.length, 3);
    assertEquals(inserts[0].spaceId, "space-1");
    assertEquals(inserts[0].name, "takos-docs");
    assertEquals(inserts[0].sourceKind, "git_ref");
    assertEquals(
      inserts[0].sourceRepositoryUrl,
      "https://github.com/tako0614/takos-docs.git",
    );
    assertEquals(inserts[0].sourceRef, "main");
    assertEquals(inserts[0].reconcileStatus, "pending");
    assertEquals(sentMessages.length, 3);
    assertEquals(sentMessages[0].type, "group_deployment_snapshot");
    assertEquals(sentMessages[0].spaceId, "space-1");
    assertEquals(sentMessages[0].groupId, inserts[0].id);
    assertEquals(sentMessages[0].groupName, "takos-docs");
    assertEquals(
      sentMessages[0].repositoryUrl,
      "https://github.com/tako0614/takos-docs.git",
    );
    assertEquals(sentMessages[0].ref, "main");
    assertEquals(sentMessages[0].refType, "branch");
    assertEquals(sentMessages[0].createdByAccountId, "user-1");
    assertEquals(sentMessages[0].reason, "default_app_preinstall");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("preinstallDefaultAppsForSpace skips database and queue work when preinstall is disabled", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let getDbCalled = false;
  let sendCalled = false;
  defaultAppDistributionDeps.getDb = ((db: Env["DB"]) => {
    getDbCalled = true;
    return db;
  }) as any;

  try {
    const installed = await preinstallDefaultAppsForSpace(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "false",
        DEPLOY_QUEUE: {
          send: async () => {
            sendCalled = true;
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(installed, []);
    assertEquals(getDbCalled, false);
    assertEquals(sendCalled, false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

Deno.test("preinstallDefaultAppsForSpace honors the kill switch even when env entries request preinstall", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let getDbCalled = false;
  let sendCalled = false;
  let inserted = false;
  defaultAppDistributionDeps.getDb = ((db: Env["DB"]) => {
    getDbCalled = true;
    return db;
  }) as any;

  try {
    const installed = await preinstallDefaultAppsForSpace(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "false",
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
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
        DEPLOY_QUEUE: {
          send: async () => {
            sendCalled = true;
          },
        } as Env["DEPLOY_QUEUE"],
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(installed, []);
    assertEquals(getDbCalled, false);
    assertEquals(sendCalled, false);
    assertEquals(inserted, false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});
