import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  buildWorkflowArtifactPrefix,
  deleteWorkflowArtifactById,
  getWorkflowArtifactById,
  listWorkflowArtifactsForRun,
  resolveWorkflowArtifactFileForJob,
  workflowArtifactDeps,
} from "@/services/platform/workflow-artifacts";
import { asTestDatabase } from "@test/db-stubs";
import {
  noopObjectStoreBinding,
  noopSqlDatabaseBinding,
} from "@test/binding-stubs";
import type { Env } from "@/shared/types/env.ts";

const originalWorkflowArtifactDeps = { ...workflowArtifactDeps };

function setWorkflowArtifactDb(drizzle: ReturnType<typeof createDrizzleMock>) {
  const wrappedDb = asTestDatabase(drizzle);
  workflowArtifactDeps.getDb =
    ((..._args: Parameters<typeof workflowArtifactDeps.getDb>) =>
      wrappedDb) as typeof workflowArtifactDeps.getDb;
}

function restoreWorkflowArtifactDeps() {
  Object.assign(workflowArtifactDeps, originalWorkflowArtifactDeps);
}

type MockFn = (...args: unknown[]) => unknown;

interface DrizzleMockApi {
  get: MockFn;
  all: MockFn;
  run: MockFn;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  innerJoin(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  limit(): DrizzleMockChain;
  get: MockFn;
  all: MockFn;
  run: MockFn;
}

type RecordingDeleteFn = (...args: unknown[]) => DrizzleMockChain;
type RecordedDeleteFn = RecordingDeleteFn & { calls: unknown[][] };

function createDrizzleMock() {
  const api: DrizzleMockApi = {
    get: () => undefined,
    all: () => undefined,
    run: () => undefined,
  };
  const deleteFn = ((...args: unknown[]) => {
    deleteFn.calls.push(args);
    return chain;
  }) as RecordedDeleteFn;
  deleteFn.calls = [];
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    get: (...args: unknown[]) => api.get(...args),
    all: (...args: unknown[]) => api.all(...args),
    run: (...args: unknown[]) => api.run(...args),
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: deleteFn,
    _: api,
  };
}

Deno.test("buildWorkflowArtifactPrefix - builds correct prefix from job and artifact name", () => {
  const prefix = buildWorkflowArtifactPrefix("job-1", "dist");
  assertEquals(prefix, "actions/artifacts/job-1/dist/");
});

Deno.test("listWorkflowArtifactsForRun - returns null when run not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await listWorkflowArtifactsForRun(
      { DB: noopSqlDatabaseBinding() } as Pick<Env, "DB">,
      "repo-1",
      "run-nonexistent",
    );
    assertEquals(result, null);
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("listWorkflowArtifactsForRun - returns artifacts for valid run", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({ id: "run-1" }); // run found
  drizzle._.all = async () => [
    {
      id: "a1",
      runId: "run-1",
      name: "dist",
      r2Key: "artifacts/a1",
      sizeBytes: 500,
      mimeType: null,
      expiresAt: null,
      createdAt: "2026-01-01",
    },
  ];
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await listWorkflowArtifactsForRun(
      { DB: noopSqlDatabaseBinding() } as Pick<Env, "DB">,
      "repo-1",
      "run-1",
    );
    assert(result !== null);
    assertEquals(result.length, 1);
    assertEquals(result![0].name, "dist");
  } finally {
    restoreWorkflowArtifactDeps();
  }
});

Deno.test("getWorkflowArtifactById - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await getWorkflowArtifactById(
      { DB: noopSqlDatabaseBinding() } as Pick<Env, "DB">,
      "repo-1",
      "a-nonexistent",
    );
    assertEquals(result, null);
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("getWorkflowArtifactById - returns artifact with run info when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({
    id: "a1",
    runId: "run-1",
    name: "dist",
    r2Key: "artifacts/a1",
    sizeBytes: 500,
    mimeType: "application/zip",
    expiresAt: null,
    createdAt: "2026-01-01",
    repoId: "repo-1",
  });
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await getWorkflowArtifactById(
      { DB: noopSqlDatabaseBinding() } as Pick<Env, "DB">,
      "repo-1",
      "a1",
    );
    assertNotEquals(result, null);
    assertEquals(result!.id, "a1");
    assertEquals(result!.workflowRun.repoId, "repo-1");
  } finally {
    restoreWorkflowArtifactDeps();
  }
});

Deno.test("deleteWorkflowArtifactById - returns null when artifact not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => undefined;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await deleteWorkflowArtifactById(
      { DB: noopSqlDatabaseBinding() } as Pick<Env, "DB">,
      null,
      "repo-1",
      "a-nonexistent",
    );
    assertEquals(result, null);
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("deleteWorkflowArtifactById - deletes from object store and DB", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({
    id: "a1",
    runId: "run-1",
    name: "dist",
    r2Key: "artifacts/a1",
    sizeBytes: 500,
    mimeType: null,
    expiresAt: null,
    createdAt: "2026-01-01",
    repoId: "repo-1",
    workflowRun: { repoId: "repo-1" },
  });
  setWorkflowArtifactDb(drizzle);

  const bucketDelete = (...args: unknown[]) => {
    bucketDelete.calls.push(args);
    return Promise.resolve(undefined);
  };
  bucketDelete.calls = [] as unknown[][];
  const bucket = Object.assign(noopObjectStoreBinding(), {
    delete: bucketDelete,
  });

  try {
    const result = await deleteWorkflowArtifactById(
      { DB: noopSqlDatabaseBinding() } as Pick<Env, "DB">,
      bucket,
      "repo-1",
      "a1",
    );
    assertNotEquals(result, null);
    assertEquals(bucketDelete.calls[0], ["artifacts/a1"]);
    assertEquals(drizzle.delete.calls.length > 0, true);
  } finally {
    restoreWorkflowArtifactDeps();
  }
});

Deno.test("resolveWorkflowArtifactFileForJob - throws when artifact path is empty", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  setWorkflowArtifactDb(drizzle);

  try {
    await assertRejects(async () => {
      await resolveWorkflowArtifactFileForJob(
        {
          DB: noopSqlDatabaseBinding(),
          GIT_OBJECTS: undefined,
          TENANT_SOURCE: undefined,
        } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">,
        {
          repoId: "r1",
          runId: "run-1",
          jobId: "job-1",
          artifactName: "dist",
          artifactPath: "",
        },
      );
    }, "artifact path is required");
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - resolves from inventory when available", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => ({
    runId: "run-1",
    name: "dist",
    r2Key: "actions/artifacts/job-1/dist",
    expiresAt: null,
  });
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async () => ({ body: "content" });
  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), { get: bucketGet }),
    TENANT_SOURCE: undefined,
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    const result = await resolveWorkflowArtifactFileForJob(env, {
      repoId: "r1",
      runId: "run-1",
      jobId: "job-1",
      artifactName: "dist",
      artifactPath: "worker.mjs",
    });

    assertEquals(result.source, "inventory");
    assertEquals(result.artifactPath, "worker.mjs");
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - falls back to prefix when inventory has no object", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => null; // no inventory artifact
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async (key: string) => {
    if (key === "actions/artifacts/job-1/dist/worker.mjs") {
      return { body: "content" };
    }
    return null;
  };
  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), { get: bucketGet }),
    TENANT_SOURCE: undefined,
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    const result = await resolveWorkflowArtifactFileForJob(env, {
      repoId: "r1",
      runId: "run-1",
      jobId: "job-1",
      artifactName: "dist",
      artifactPath: "worker.mjs",
    });

    assertEquals(result.source, "prefix-fallback");
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - resolves directory artifact with one script", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => null;
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async (_key: string) => null;
  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), {
      get: bucketGet,
      list: async () => ({
        objects: [
          { key: "actions/artifacts/job-1/gateway-dist/dist/worker.mjs" },
          { key: "actions/artifacts/job-1/gateway-dist/dist/worker.mjs.map" },
        ],
      }),
    }),
    TENANT_SOURCE: undefined,
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    const result = await resolveWorkflowArtifactFileForJob(env, {
      repoId: "r1",
      runId: "run-1",
      jobId: "job-1",
      artifactName: "gateway-dist",
      artifactPath: "dist",
    });

    assertEquals(result.source, "directory-fallback");
    assertEquals(result.artifactPath, "dist/worker.mjs");
    assertEquals(
      result.r2Key,
      "actions/artifacts/job-1/gateway-dist/dist/worker.mjs",
    );
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - resolves omitted artifact path from artifact root", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => null;
  setWorkflowArtifactDb(drizzle);

  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), {
      get: async () => null,
      list: async () => ({
        objects: [
          { key: "actions/artifacts/job-1/gateway-dist/worker.mjs" },
          { key: "actions/artifacts/job-1/gateway-dist/worker.mjs.map" },
        ],
      }),
    }),
    TENANT_SOURCE: undefined,
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    const result = await resolveWorkflowArtifactFileForJob(env, {
      repoId: "r1",
      runId: "run-1",
      jobId: "job-1",
      artifactName: "gateway-dist",
    });

    assertEquals(result.source, "directory-fallback");
    assertEquals(result.artifactPath, "worker.mjs");
    assertEquals(
      result.r2Key,
      "actions/artifacts/job-1/gateway-dist/worker.mjs",
    );
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - rejects ambiguous directory artifact scripts", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => null;
  setWorkflowArtifactDb(drizzle);

  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), {
      get: async () => null,
      list: async () => ({
        objects: [
          { key: "actions/artifacts/job-1/gateway-dist/dist/index.js" },
          { key: "actions/artifacts/job-1/gateway-dist/dist/chunk.js" },
        ],
      }),
    }),
    TENANT_SOURCE: undefined,
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    await assertRejects(
      () =>
        resolveWorkflowArtifactFileForJob(env, {
          repoId: "r1",
          runId: "run-1",
          jobId: "job-1",
          artifactName: "gateway-dist",
          artifactPath: "dist",
        }),
      Error,
      "multiple JavaScript bundle candidates",
    );
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - rejects artifact path traversal", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  setWorkflowArtifactDb(drizzle);

  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), {
      get: async () => null,
      list: async () => ({ objects: [] }),
    }),
    TENANT_SOURCE: undefined,
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    await assertRejects(
      () =>
        resolveWorkflowArtifactFileForJob(env, {
          repoId: "r1",
          runId: "run-1",
          jobId: "job-1",
          artifactName: "gateway-dist",
          artifactPath: "../dist/worker.mjs",
        }),
      Error,
      "artifact path must not contain path traversal",
    );
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("resolveWorkflowArtifactFileForJob - throws when artifact file not found anywhere", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = async () => null;
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async () => null;
  const env = {
    DB: noopSqlDatabaseBinding(),
    GIT_OBJECTS: Object.assign(noopObjectStoreBinding(), { get: bucketGet }),
    TENANT_SOURCE: Object.assign(noopObjectStoreBinding(), {
      get: async () => null,
    }),
  } as Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">;

  try {
    await assertRejects(async () => {
      await resolveWorkflowArtifactFileForJob(env, {
        repoId: "r1",
        runId: "run-1",
        jobId: "job-1",
        artifactName: "dist",
        artifactPath: "missing.mjs",
      });
    }, "Workflow artifact file not found");
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
