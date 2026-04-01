import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  buildWorkflowArtifactPrefix,
  deleteWorkflowArtifactById,
  getWorkflowArtifactById,
  listWorkflowArtifactsForRun,
  resolveWorkflowArtifactFileForJob,
  workflowArtifactDeps,
} from "@/services/platform/workflow-artifacts";

const originalWorkflowArtifactDeps = { ...workflowArtifactDeps };

function setWorkflowArtifactDb(drizzle: ReturnType<typeof createDrizzleMock>) {
  workflowArtifactDeps.getDb =
    (() => drizzle) as unknown as typeof workflowArtifactDeps.getDb;
}

function restoreWorkflowArtifactDeps() {
  Object.assign(workflowArtifactDeps, originalWorkflowArtifactDeps);
}

function createDrizzleMock() {
  const api = {
    get: ((..._args: any[]) => {
      api.get.calls.push(_args);
      return undefined;
    }) as any,
    all: ((..._args: any[]) => {
      api.all.calls.push(_args);
      return undefined;
    }) as any,
    run: ((..._args: any[]) => {
      api.run.calls.push(_args);
      return undefined;
    }) as any,
  };
  api.get.calls = [] as unknown[][];
  api.all.calls = [] as unknown[][];
  api.run.calls = [] as unknown[][];
  const deleteFn = ((..._args: any[]) => {
    deleteFn.calls.push(_args);
    return chain;
  }) as any;
  deleteFn.calls = [] as unknown[][];
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    values: function (this: any) {
      return this;
    },
    innerJoin: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    get: ((...args: any[]) => api.get(...args)) as any,
    all: ((...args: any[]) => api.all(...args)) as any,
    run: ((...args: any[]) => api.run(...args)) as any,
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
  drizzle._.get = (async () => undefined) as any;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await listWorkflowArtifactsForRun(
      { DB: {} } as any,
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
  drizzle._.get = (async () => ({ id: "run-1" })) as any; // run found
  drizzle._.all = (async () => [
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
  ]) as any;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await listWorkflowArtifactsForRun(
      { DB: {} } as any,
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
  drizzle._.get = (async () => undefined) as any;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await getWorkflowArtifactById(
      { DB: {} } as any,
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
  drizzle._.get = (async () => ({
    id: "a1",
    runId: "run-1",
    name: "dist",
    r2Key: "artifacts/a1",
    sizeBytes: 500,
    mimeType: "application/zip",
    expiresAt: null,
    createdAt: "2026-01-01",
    repoId: "repo-1",
  })) as any;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await getWorkflowArtifactById(
      { DB: {} } as any,
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
  drizzle._.get = (async () => undefined) as any;
  setWorkflowArtifactDb(drizzle);

  try {
    const result = await deleteWorkflowArtifactById(
      { DB: {} } as any,
      null,
      "repo-1",
      "a-nonexistent",
    );
    assertEquals(result, null);
  } finally {
    restoreWorkflowArtifactDeps();
  }
});
Deno.test("deleteWorkflowArtifactById - deletes from R2 and DB", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
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
  })) as any;
  setWorkflowArtifactDb(drizzle);

  const bucketDelete = ((...args: unknown[]) => {
    bucketDelete.calls.push(args);
    return Promise.resolve(undefined);
  }) as any;
  bucketDelete.calls = [] as unknown[][];
  const bucket = { delete: bucketDelete } as any;

  try {
    const result = await deleteWorkflowArtifactById(
      { DB: {} } as any,
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
        { DB: {}, GIT_OBJECTS: null, TENANT_SOURCE: null } as any,
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
  drizzle._.get = (async () => ({
    runId: "run-1",
    name: "dist",
    r2Key: "actions/artifacts/job-1/dist",
    expiresAt: null,
  })) as any;
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async () => ({ body: "content" });
  const env = {
    DB: {},
    GIT_OBJECTS: { get: bucketGet },
    TENANT_SOURCE: null,
  } as any;

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
  drizzle._.get = (async () => null) as any; // no inventory artifact
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async (key: string) => {
    if (key === "actions/artifacts/job-1/dist/worker.mjs") {
      return { body: "content" };
    }
    return null;
  };
  const env = {
    DB: {},
    GIT_OBJECTS: { get: bucketGet },
    TENANT_SOURCE: null,
  } as any;

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
Deno.test("resolveWorkflowArtifactFileForJob - throws when artifact file not found anywhere", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => null) as any;
  setWorkflowArtifactDb(drizzle);

  const bucketGet = async () => null;
  const env = {
    DB: {},
    GIT_OBJECTS: { get: bucketGet },
    TENANT_SOURCE: { get: async () => null },
  } as any;

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
