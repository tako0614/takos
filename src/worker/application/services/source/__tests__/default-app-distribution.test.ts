import { test } from "bun:test";
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "@takos/test/assert";
import { getTableName } from "drizzle-orm";
import { readFile } from "node:fs/promises";

import type { Env } from "../../../../shared/types/index.ts";
import {
  clearDefaultAppDistributionCache,
  clearDefaultAppDistributionEntries,
  defaultAppDistributionDeps,
  enqueueDefaultAppPreinstallJob,
  getDefaultAppReconcileStatus,
  preinstallDefaultAppsForSpace,
  processDefaultAppPreinstallJobs,
  resolveDefaultAppDistribution,
  resolveDefaultAppDistributionForBootstrap,
  resolveDefaultAppInstallConfig,
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

const ECOSYSTEM_ROOT = new URL("../../../../../../../", import.meta.url);

const DEFAULT_APP_SOURCES = [
  {
    name: "takos-docs",
    path: "takos-apps/takos-docs/package.json",
    packageName: "@takos/takos-docs",
    sourcePath: "outputs.tf",
    preinstall: true,
  },
  {
    name: "takos-excel",
    path: "takos-apps/takos-excel/package.json",
    packageName: "@takos-apps/takos-excel",
    sourcePath: "outputs.tf",
    preinstall: true,
  },
  {
    name: "takos-slide",
    path: "takos-apps/takos-slide/package.json",
    packageName: "takos-slide",
    sourcePath: "outputs.tf",
    preinstall: true,
  },
  {
    name: "takos-computer",
    path: "takos-apps/takos-computer/package.json",
    packageName: "@takos-apps/takos-computer",
    sourcePath: "outputs.tf",
    preinstall: true,
  },
  {
    name: "yurucommu",
    path: "yurucommu/package.json",
    packageName: "@takos/yurucommu",
    sourcePath: "outputs.tf",
    preinstall: true,
  },
  {
    name: "road-to-me",
    path: "road-to-me/backend/package.json",
    packageName: "@takos/road-to-me-backend",
    sourcePath: "outputs.tf",
    preinstall: false,
  },
] as const;

type PackageSummary = {
  name: string;
  version: string;
};

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  assert(
    value != null && typeof value === "object" && !Array.isArray(value),
    `${field} must be an object`,
  );
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  assert(typeof value === "string" && value.length > 0, `${field} is required`);
  return value;
}

async function readInstallableAppPackage(
  path: string,
): Promise<PackageSummary> {
  const text = await readFile(new URL(path, ECOSYSTEM_ROOT), "utf8");
  const parsed = objectRecord(JSON.parse(text), path);
  return {
    name: requiredString(parsed.name, `${path}.name`),
    version: requiredString(parsed.version, `${path}.version`),
  };
}

test("resolveDefaultAppDistribution returns default app fallback set", () => {
  const entries = resolveDefaultAppDistribution(makeEnv());

  assertEquals(
    entries.map((entry) => entry.name),
    [
      "takos-docs",
      "takos-excel",
      "takos-slide",
      "takos-computer",
      "yurucommu",
      "road-to-me",
    ],
  );
  assertEquals(
    entries.map((entry) => entry.preinstall),
    [true, true, true, true, true, false],
  );
  assertEquals(
    entries.map((entry) => entry.ref),
    ["v0.1.2", "v0.1.2", "v0.1.2", "v2.1.2", "v1.2.6", "v0.1.0"],
  );
  assertEquals(
    entries.map((entry) => entry.appId),
    [
      "jp.takos.docs",
      "jp.takos.excel",
      "jp.takos.slide",
      "jp.takos.computer",
      "com.yurucommu.app",
      "jp.takos.road-to-me",
    ],
  );
  assertEquals(
    entries.map((entry) => entry.sourcePath),
    DEFAULT_APP_SOURCES.map((source) => source.sourcePath),
  );
  assertEquals(
    entries
      .filter((entry) => entry.name !== "road-to-me")
      .every((entry) => entry.runtimeModes?.includes("shared-cell")),
    true,
  );
  assertEquals(
    entries.find((entry) => entry.name === "road-to-me")?.runtimeModes,
    ["dedicated", "self-hosted"],
  );
  assertEquals(
    entries.every((entry) =>
      entry.bindings?.some(
        (binding) => binding.type === "auth.bootstrap_token",
      ),
    ),
    true,
  );
  assertEquals(
    entries.every((entry) => entry.refType === "tag"),
    true,
  );
  assertEquals(
    entries.map((entry) => entry.repositoryUrl),
    [
      "https://github.com/tako0614/takos-docs.git",
      "https://github.com/tako0614/takos-excel.git",
      "https://github.com/tako0614/takos-slide.git",
      "https://github.com/tako0614/takos-computer.git",
      "https://github.com/tako0614/yurucommu.git",
      "https://github.com/tako0614/road-to-me.git",
    ],
  );
});

test("resolveDefaultAppDistribution stays in sync with installable source packages", async () => {
  const entries = resolveDefaultAppDistribution(
    makeEnv({
      TAKOS_DEFAULT_APPS_PREINSTALL: "true",
    }),
  );
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));

  assertEquals(
    entries.map((entry) => entry.name),
    DEFAULT_APP_SOURCES.map((source) => source.name),
  );

  for (const source of DEFAULT_APP_SOURCES) {
    const entry = entriesByName.get(source.name);
    assert(entry, `Missing default app distribution entry: ${source.name}`);

    const expected = await readInstallableAppPackage(source.path);
    assertEquals(expected.name, source.packageName);
    assert(typeof expected.version === "string" && expected.version.length > 0);
    assertEquals(entry.sourcePath, source.sourcePath);
    assertEquals(entry.refType, "tag");
    assertEquals(entry.preinstall, source.preinstall);
  }
});

test("resolveDefaultAppDistribution keeps road-to-me catalog-only when fallback preinstall is enabled", () => {
  const entries = resolveDefaultAppDistribution(
    makeEnv({
      TAKOS_DEFAULT_APPS_PREINSTALL: "true",
    }),
  );

  assertEquals(
    entries.filter((entry) => entry.preinstall).map((entry) => entry.name),
    ["takos-docs", "takos-excel", "takos-slide", "takos-computer", "yurucommu"],
  );
  assertEquals(
    entries.find((entry) => entry.name === "road-to-me")?.preinstall,
    false,
  );
});

test("resolveDefaultAppDistribution lets operators replace the distribution", () => {
  const entries = resolveDefaultAppDistribution(
    makeEnv({
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

test("resolveDefaultAppDistribution prefers distribution JSON over repository list JSON", () => {
  const entries = resolveDefaultAppDistribution(
    makeEnv({
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
    }),
  );

  assertEquals(
    entries.map((entry) => entry.name),
    ["distribution-docs"],
  );
});

test("resolveDefaultAppDistribution accepts repository list JSON", () => {
  const entries = resolveDefaultAppDistribution(
    makeEnv({
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
    }),
  );

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

test("resolveDefaultAppDistributionForBootstrap prefers repository list env over DB", async () => {
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
    const entries = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        TAKOS_DEFAULT_APP_REPOSITORIES_JSON: JSON.stringify([
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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("resolveDefaultAppDistributionForBootstrap honors the preinstall kill switch before parsing overrides", async () => {
  const entries = await resolveDefaultAppDistributionForBootstrap(
    makeEnv({
      TAKOS_DEFAULT_APPS_PREINSTALL: "false",
      TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: "{not json",
      TAKOS_DEFAULT_APP_REPOSITORIES_JSON: "{also not json",
    }),
  );

  assertEquals(
    entries.map((entry) => entry.name),
    [
      "takos-docs",
      "takos-excel",
      "takos-slide",
      "takos-computer",
      "yurucommu",
      "road-to-me",
    ],
  );
  assertEquals(
    entries.every((entry) => entry.preinstall === false),
    true,
  );
});

test("resolveDefaultAppInstallConfig reuses the shared Takosumi Accounts install surface", () => {
  assertEquals(
    resolveDefaultAppInstallConfig(
      makeEnv({
        TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal/",
        TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
        TAKOSUMI_ACCOUNTS_SUBJECT: "tsub_operator",
        TAKOS_APP_INSTALL_MODE: "shared-cell",
        TAKOS_APP_INSTALL_RUNTIME_BASE_URL: "https://takos.example.com",
      }),
    ),
    {
      installUrl: "https://accounts.internal/v1/installation-projections",
      token: "accounts-token",
      subject: "tsub_operator",
      mode: "shared-cell",
      runtimeBaseUrl: "https://takos.example.com/",
    },
  );
  assertEquals(
    resolveDefaultAppInstallConfig(
      makeEnv({
        TAKOS_DEFAULT_APP_INSTALL_URL:
          "https://installer.internal/v1/installation-projections",
        TAKOS_DEFAULT_APP_INSTALL_TOKEN: "default-token",
        TAKOS_DEFAULT_APP_INSTALL_SUBJECT: "tsub_default",
        TAKOS_APP_INSTALLATIONS_URL: "https://accounts.internal",
        TAKOS_APP_INSTALL_TOKEN: "shared-token",
        TAKOS_APP_INSTALL_SUBJECT: "tsub_shared",
      }),
    ),
    {
      installUrl: "https://installer.internal/v1/installation-projections",
      token: "default-token",
      subject: "tsub_default",
    },
  );
});

test("resolveDefaultAppDistribution rejects non-portable repository URLs", () => {
  assertThrows(
    () =>
      resolveDefaultAppDistribution(
        makeEnv({
          TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
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

test("resolveDefaultAppDistribution rejects invalid global ref type", () => {
  assertThrows(
    () =>
      resolveDefaultAppDistribution(
        makeEnv({
          TAKOS_DEFAULT_APP_REF_TYPE: "branches",
        }),
      ),
    Error,
    "TAKOS_DEFAULT_APP_REF_TYPE is invalid",
  );
});

test("resolveDefaultAppDistribution rejects invalid global backend", () => {
  assertThrows(
    () =>
      resolveDefaultAppDistribution(
        makeEnv({
          TAKOS_DEFAULT_APP_BACKEND: "cloudfare",
        }),
      ),
    Error,
    "TAKOS_DEFAULT_APP_BACKEND is invalid",
  );
});

test("getDefaultAppReconcileStatus reports env distribution and preinstall jobs", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
      id: "default-app-preinstall:space-1",
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
      id: "default-app-preinstall:space-2",
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
          tableName(table) === "default_app_preinstall_jobs" ? jobRows : [],
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const status = await getDefaultAppReconcileStatus(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
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

    assertEquals(status.distribution.source, "env_distribution");
    assertEquals(status.distribution.totalEntries, 2);
    assertEquals(status.distribution.preinstallEntries, 1);
    assertEquals(status.jobs.available, true);
    assertEquals(status.jobs.total, 2);
    assertEquals(status.jobs.byStatus.queued, 1);
    assertEquals(status.jobs.byStatus.blocked_by_config, 1);
    assertEquals(status.jobs.latestUpdatedAt, "2026-01-01T00:02:00.000Z");
    assertEquals(status.jobs.lastErrors[0].spaceId, "space-2");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("resolveDefaultAppDistributionForBootstrap keeps an empty DB distribution empty", async () => {
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
    const entries = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
      }),
    );

    assertEquals(selectCalls, 2);
    assertEquals(entries, []);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("resolveDefaultAppDistributionForBootstrap falls back when DB read fails", async () => {
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
    const entries = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
      }),
    );

    assertEquals(
      entries.map((entry) => entry.name),
      [
        "takos-docs",
        "takos-excel",
        "takos-slide",
        "takos-computer",
        "yurucommu",
        "road-to-me",
      ],
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("resolveDefaultAppDistributionForBootstrap rejects invalid DB configuration instead of falling back", async () => {
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    await assertRejects(
      () =>
        resolveDefaultAppDistributionForBootstrap(
          makeEnv({
            TAKOS_DEFAULT_APPS_PREINSTALL: "true",
          }),
        ),
      Error,
      "entry.refType is invalid",
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("resolveDefaultAppDistributionForBootstrap reads persisted distribution once per cache window", async () => {
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
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "true" });
    const first = await resolveDefaultAppDistributionForBootstrap(env);
    const second = await resolveDefaultAppDistributionForBootstrap(env);

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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("resolveDefaultAppDistributionForBootstrap keeps cache entries scoped per DB binding", async () => {
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
  defaultAppDistributionDeps.getDb = ((db: Env["DB"]) => db) as any;

  try {
    const first = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        DB: db1 as unknown as Env["DB"],
      }),
    );
    const second = await resolveDefaultAppDistributionForBootstrap(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("saveDefaultAppDistributionEntries rejects duplicate names before mutating the DB", async () => {
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
    await assertRejects(() =>
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

test("saveDefaultAppDistributionEntries replaces persisted repositories and warms cache", async () => {
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
    const env = makeEnv({
      TAKOS_DEFAULT_APPS_PREINSTALL: "true",
      TAKOS_DEFAULT_APP_REF: "stable",
    });
    const saved = await saveDefaultAppDistributionEntries(
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
    const resolved = await resolveDefaultAppDistributionForBootstrap(env);

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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("clearDefaultAppDistributionEntries disables DB distribution and requeues blocked jobs", async () => {
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
      makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "true" }),
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

test("enqueueDefaultAppPreinstallJob persists a queued job and honors the kill switch", async () => {
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
      makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "true" }),
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
    assertEquals(inserted[0].distributionJson, null);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("enqueueDefaultAppPreinstallJob defers source resolution until processing", async () => {
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
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
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

    assertEquals(inserted[0].status, "queued");
    assertEquals(inserted[0].distributionJson, null);
    assertEquals(inserted[0].expectedGroupIdsJson, null);
    assertEquals(inserted[0].deploymentQueuedAt, null);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("processDefaultAppPreinstallJobs pauses queued jobs when preinstall is disabled", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
      id: "default-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      distributionJson: JSON.stringify([
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
      deploymentQueuedAt: null,
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
      makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "false" }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.paused, 1);
    assertEquals(
      jobUpdates.map((update) => update.status),
      ["in_progress", "paused_by_operator"],
    );
    assertEquals(jobUpdates.at(-1)?.nextAttemptAt, "2026-01-01T00:01:00.000Z");
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("processDefaultAppPreinstallJobs applies default apps through Installation install when configured", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  const originalFetch = defaultAppDistributionDeps.fetch;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
      id: "default-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "acct-owner",
      status: "queued",
      attempts: 0,
      nextAttemptAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      lastError: null,
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
                  name === "default_app_preinstall_jobs" ? jobRows : [],
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
            if (tableName(table) === "default_app_preinstall_jobs") {
              jobStatuses.push(value.status);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;
  defaultAppDistributionDeps.fetch = async (input, init) => {
    sentRequests.push(new Request(input, init));
    if (String(input).endsWith("/plan-runs")) {
      return Response.json({
        expected: {
          planRunId: `plan_${sentRequests.length}`,
          runnerProfileId: "runner_default",
          sourceDigest: "sha256:source",
          variablesDigest: "sha256:variables",
          policyDecisionDigest: "sha256:policy",
          planDigest: "sha256:plan",
          planArtifactDigest: "sha256:artifact",
        },
      });
    }
    return Response.json({ ok: true }, { status: 202 });
  };

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        TAKOS_DEFAULT_APP_INSTALL_URL:
          "https://installer.internal/v1/installation-projections",
        TAKOS_DEFAULT_APP_INSTALL_TOKEN: "install-token",
        TAKOS_DEFAULT_APP_INSTALL_SUBJECT: "tsub_operator",
        TAKOS_DEFAULT_APP_INSTALL_MODE: "shared-cell",
        TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL: "https://apps.example.test",
      }),
      { timestamp: "2026-01-01T00:00:00.000Z" },
    );

    assertEquals(summary.completed, 1);
    assertEquals(jobStatuses, ["in_progress", "completed"]);
    assertEquals(sentRequests.length, 10);
    assertEquals(
      sentRequests[0].url,
      "https://installer.internal/v1/installation-projections/plan-runs",
    );
    assertEquals(
      sentRequests[0].headers.get("authorization"),
      "Bearer install-token",
    );
    const body = await sentRequests[0].json();
    assertEquals(body, {
      spaceId: "space-1",
      source: {
        kind: "git",
        url: "https://github.com/tako0614/takos-docs.git",
        ref: "v0.1.2",
      },
    });
    assertEquals(
      sentRequests[1].url,
      "https://installer.internal/v1/installation-projections",
    );
    const applyBody = await sentRequests[1].json();
    assertEquals(applyBody, {
      accountId: "space-1",
      spaceId: "space-1",
      createdBySubject: "tsub_operator",
      source: {
        kind: "git",
        url: "https://github.com/tako0614/takos-docs.git",
        ref: "v0.1.2",
      },
      expected: {
        planRunId: "plan_1",
        runnerProfileId: "runner_default",
        sourceDigest: "sha256:source",
        variablesDigest: "sha256:variables",
        policyDecisionDigest: "sha256:policy",
        planDigest: "sha256:plan",
        planArtifactDigest: "sha256:artifact",
      },
      mode: "shared-cell",
      runtimeBaseUrl: "https://apps.example.test/",
    });
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
    defaultAppDistributionDeps.fetch = originalFetch;
  }
});

test("processDefaultAppPreinstallJobs blocks incomplete Installation install config", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  const originalFetch = defaultAppDistributionDeps.fetch;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
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
  defaultAppDistributionDeps.fetch = async () => {
    fetchCalled = true;
    return Response.json({ ok: true });
  };

  try {
    const summary = await processDefaultAppPreinstallJobs(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
          {
            name: "operator-docs",
            title: "Docs",
            repositoryUrl: "https://example.com/operator-docs.git",
          },
        ]),
        TAKOS_DEFAULT_APP_INSTALL_URL:
          "https://installer.internal/v1/installation-projections",
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
        "TAKOS_DEFAULT_APP_INSTALL_URL/TOKEN/SUBJECT",
      ),
      true,
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
    defaultAppDistributionDeps.fetch = originalFetch;
  }
});

test("processDefaultAppPreinstallJobs skips rows another processor already claimed", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
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
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: JSON.stringify([
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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("processDefaultAppPreinstallJobs blocks invalid config without permanent failure", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const jobRows = [
    {
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
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
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

test("preinstallDefaultAppsForSpace requires Installation config", async () => {
  await assertRejects(
    () =>
      preinstallDefaultAppsForSpace(
        makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "true" }),
        {
          spaceId: "space-1",
          createdByAccountId: "user-1",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ),
    Error,
    "Default app preinstall requires Installation API config",
  );
});

test("preinstallDefaultAppsForSpace applies every bundled app through Installation when configured", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  const originalFetch = defaultAppDistributionDeps.fetch;
  clearDefaultAppDistributionCache();
  const fetchCalls: Array<{
    url: string;
    authorization: string | null;
    body: Record<string, unknown>;
  }> = [];
  defaultAppDistributionDeps.getDb = (() => ({
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
  defaultAppDistributionDeps.fetch = async (input, init) => {
    const url = String(input);
    fetchCalls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (url.endsWith("/plan-runs")) {
      return Response.json({
        expected: {
          planRunId: `plan_${fetchCalls.length}`,
          runnerProfileId: "runner_default",
          sourceDigest: "sha256:source",
          variablesDigest: "sha256:variables",
          policyDecisionDigest: "sha256:policy",
          planDigest: "sha256:plan",
          planArtifactDigest: "sha256:artifact",
        },
      });
    }
    return Response.json(
      {
        accounts: {
          installationId: `inst_${fetchCalls.length}`,
          status: "ready",
        },
      },
      { status: 202 },
    );
  };

  try {
    const installed = await preinstallDefaultAppsForSpace(
      makeEnv({
        TAKOS_DEFAULT_APPS_PREINSTALL: "true",
        TAKOS_DEFAULT_APP_INSTALL_URL:
          "https://installer.internal/v1/installation-projections",
        TAKOS_DEFAULT_APP_INSTALL_TOKEN: "install-token",
        TAKOS_DEFAULT_APP_INSTALL_SUBJECT: "tsub_operator",
        TAKOS_DEFAULT_APP_INSTALL_MODE: "shared-cell",
        TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL: "https://takos.example.com",
      }),
      {
        spaceId: "space-1",
        createdByAccountId: "acct-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(
      installed.map((entry) => entry.name),
      [
        "takos-docs",
        "takos-excel",
        "takos-slide",
        "takos-computer",
        "yurucommu",
      ],
    );
    assertEquals(fetchCalls.length, 10);
    assertEquals(
      fetchCalls[0].url,
      "https://installer.internal/v1/installation-projections/plan-runs",
    );
    assertEquals(
      fetchCalls[1].url,
      "https://installer.internal/v1/installation-projections",
    );
    assertEquals(
      fetchCalls.every((call) => call.authorization === "Bearer install-token"),
      true,
    );
    assertEquals(
      fetchCalls
        .filter((_, index) => index % 2 === 0)
        .map(
          (call) =>
            objectRecord(call.body.source, "install request source").url,
        ),
      [
        "https://github.com/tako0614/takos-docs.git",
        "https://github.com/tako0614/takos-excel.git",
        "https://github.com/tako0614/takos-slide.git",
        "https://github.com/tako0614/takos-computer.git",
        "https://github.com/tako0614/yurucommu.git",
      ],
    );
    assertEquals(
      fetchCalls
        .filter((_, index) => index % 2 === 0)
        .map(
          (call) =>
            objectRecord(call.body.source, "install request source").ref,
        ),
      ["v0.1.2", "v0.1.2", "v0.1.2", "v2.1.2", "v1.2.6"],
    );
    assertEquals(
      fetchCalls
        .filter((_, index) => index % 2 === 1)
        .every(
          (call) =>
            call.body.accountId === "space-1" &&
            call.body.createdBySubject === "tsub_operator" &&
            call.body.spaceId === "space-1" &&
            objectRecord(call.body.source, "install request source").kind ===
              "git" &&
            objectRecord(call.body.expected, "install expected guard")
              .planRunId === `plan_${fetchCalls.indexOf(call)}` &&
            call.body.mode === "shared-cell" &&
            call.body.runtimeBaseUrl === "https://takos.example.com/",
        ),
      true,
    );
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
    defaultAppDistributionDeps.fetch = originalFetch;
  }
});

test("preinstallDefaultAppsForSpace skips database work when preinstall is disabled", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let getDbCalled = false;
  defaultAppDistributionDeps.getDb = ((db: Env["DB"]) => {
    getDbCalled = true;
    return db;
  }) as any;

  try {
    const installed = await preinstallDefaultAppsForSpace(
      makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "false" }),
      {
        spaceId: "space-1",
        createdByAccountId: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    );

    assertEquals(installed, []);
    assertEquals(getDbCalled, false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("preinstallDefaultAppsForSpace honors the kill switch even when env entries request preinstall", async () => {
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  let getDbCalled = false;
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
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("invalidateDistributionCache drops the in-memory cache entry for a DB binding", async () => {
  const {
    getDistributionCacheEntry,
    invalidateDistributionCache,
    setDistributionCacheEntry,
  } = await import("../default-app-distribution-internal.ts");

  const dbBinding = {} as Env["DB"];
  setDistributionCacheEntry(dbBinding, {
    key: "test-key",
    distribution: { configured: true, entries: [] },
    expiresAt: Date.now() + 30_000,
  });
  assert(getDistributionCacheEntry(dbBinding) !== null);

  invalidateDistributionCache(dbBinding);
  assertEquals(getDistributionCacheEntry(dbBinding), null);
});

test("saveDefaultAppDistributionEntries invalidates the cache before reseeding fresh data", async () => {
  const { getDistributionCacheEntry, setDistributionCacheEntry } =
    await import("../default-app-distribution-internal.ts");
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const db = {
    delete: (table: unknown) =>
      isDefaultAppDistributionConfigTable(table)
        ? { where: () => ({ run: async () => undefined }) }
        : { run: async () => undefined },
    insert: () => ({
      values: () => ({ run: async () => undefined }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ run: async () => undefined }) }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "true" });
    // Seed a stale entry that should not survive the writer.
    setDistributionCacheEntry(env.DB, {
      key: "STALE",
      distribution: {
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
    assertEquals(getDistributionCacheEntry(env.DB)?.key, "STALE");

    await saveDefaultAppDistributionEntries(
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

    const cached = getDistributionCacheEntry(env.DB);
    assert(cached !== null);
    assertEquals(
      cached.distribution.entries.map((e) => e.name),
      ["fresh-app"],
    );
    // The pre-existing stale key must have been dropped before reseeding.
    assertEquals(cached.key === "STALE", false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});

test("clearDefaultAppDistributionEntries invalidates the cache before reseeding empty state", async () => {
  const { getDistributionCacheEntry, setDistributionCacheEntry } =
    await import("../default-app-distribution-internal.ts");
  const originalGetDb = defaultAppDistributionDeps.getDb;
  clearDefaultAppDistributionCache();
  const db = {
    delete: (table: unknown) =>
      isDefaultAppDistributionConfigTable(table)
        ? { where: () => ({ run: async () => undefined }) }
        : { run: async () => undefined },
    insert: () => ({
      values: () => ({ run: async () => undefined }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ run: async () => undefined }) }),
    }),
  };
  defaultAppDistributionDeps.getDb = (() => db) as any;

  try {
    const env = makeEnv({ TAKOS_DEFAULT_APPS_PREINSTALL: "true" });
    setDistributionCacheEntry(env.DB, {
      key: "STALE-CLEAR",
      distribution: {
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

    await clearDefaultAppDistributionEntries(env, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const cached = getDistributionCacheEntry(env.DB);
    assert(cached !== null);
    assertEquals(cached.distribution.configured, false);
    assertEquals(cached.distribution.entries, []);
    assertEquals(cached.key === "STALE-CLEAR", false);
  } finally {
    clearDefaultAppDistributionCache();
    defaultAppDistributionDeps.getDb = originalGetDb;
  }
});
