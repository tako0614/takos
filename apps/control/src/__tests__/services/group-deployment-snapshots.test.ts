import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import {
  type GroupDeploymentSnapshotMutationResult,
  GroupDeploymentSnapshotService,
  normalizeManifestArtifacts,
} from "@/services/platform/group-deployment-snapshots";
import {
  createGroupDeploymentSnapshotRecord,
  finalizeGroupDeploymentSnapshotRecord,
} from "@/services/platform/group-deployment-snapshots-records";
import { buildSourceFromRow } from "@/services/platform/group-deployment-snapshot-targets";
import {
  shouldTryContentReducingFallback,
  supportsRemoteBloblessFallback,
} from "@/services/platform/remote-fetch-policy";

const service = new GroupDeploymentSnapshotService({} as never);
const groupDeploymentSnapshotsSource = new URL(
  import.meta.resolve("@/services/platform/group-deployment-snapshots"),
);

function createSelectOnlyDb(getResults: unknown[]) {
  let getIndex = 0;
  return {
    select() {
      return {
        from() {
          const query = {
            get: async () => getResults[getIndex++],
            all: async () => [],
            orderBy() {
              return query;
            },
          };
          return {
            where() {
              return query;
            },
          };
        },
      };
    },
    insert() {
      throw new Error("insert should not be called in this test");
    },
    update() {
      throw new Error("update should not be called in this test");
    },
    delete() {
      throw new Error("delete should not be called in this test");
    },
  };
}

function createSnapshot() {
  return {
    payload: {
      schema_version: 1,
      created_at: "2026-04-02T00:00:00.000Z",
      group_name: "snapshot-group",
      backend: "aws",
      env_name: "production",
      source: {
        kind: "git_ref",
        repository_url: "https://github.com/acme/demo.git",
        ref: "main",
        ref_type: "branch",
        commit_sha: "0123456789abcdef0123456789abcdef01234567",
        resolved_repo_id: null,
      },
      manifest: {
        kind: "App",
        metadata: { name: "snapshot-group" },
        spec: { version: "1.0.0" },
      },
      build_sources: [],
      artifacts: {},
    },
    bundleData: new ArrayBuffer(0),
    r2Key: "group-deployment-snapshots/appdep-prev/snapshot.zip",
    sha256: "snapshot-sha",
    sizeBytes: 0,
    format: "deployment-snapshot-v1",
  };
}

function createGroupDeploymentSnapshotWriteDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const inserted: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select() {
      return {
        from() {
          const query = {
            get: async () => rows.values().next().value,
            all: async () => Array.from(rows.values()),
            orderBy() {
              return query;
            },
          };
          return {
            where() {
              return query;
            },
          };
        },
      };
    },
    insert() {
      return {
        values: (row: Record<string, unknown>) => ({
          run: async () => {
            inserted.push(row);
            rows.set(row.id as string, { ...row });
            return { success: true, meta: { changes: 1 } };
          },
        }),
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                run: async () => {
                  updates.push(values);
                  for (const [id, row] of rows) {
                    rows.set(id, { ...row, ...values });
                    break;
                  }
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
          };
        },
      };
    },
    delete() {
      throw new Error("delete should not be called in this test");
    },
  };
  return { db, inserted, updates, rows };
}

Deno.test("group deployment snapshot service - rejects non-https repository URLs", async () => {
  await assertRejects(
    async () => {
      await service.deploy("space-1", "user-1", {
        groupName: "demo-group",
        source: {
          kind: "git_ref",
          repositoryUrl: "ssh://github.com/acme/demo.git",
        },
      });
    },
    Error,
    "repository_url must use https://",
  );
});

Deno.test("group deployment snapshot service - rejects repository URLs with credentials", async () => {
  await assertRejects(
    async () => {
      await service.deploy("space-1", "user-1", {
        groupName: "demo-group",
        source: {
          kind: "git_ref",
          repositoryUrl: "https://user:pass@github.com/acme/demo.git",
        },
      });
    },
    Error,
    "repository_url must not include embedded credentials",
  );
});

Deno.test("group deployment snapshot service - rejects repository URLs with query strings", async () => {
  await assertRejects(
    async () => {
      await service.deploy("space-1", "user-1", {
        groupName: "demo-group",
        source: {
          kind: "git_ref",
          repositoryUrl: "https://github.com/acme/demo.git?ref=main",
        },
      });
    },
    Error,
    "repository_url must not include query parameters or fragments",
  );
});

Deno.test("group deployment snapshot service - fallback policy only retries content-reduction class failures", () => {
  assertEquals(
    shouldTryContentReducingFallback(
      new Error("Packfile size 120000000 exceeds limit 104857600"),
    ),
    true,
  );
  assertEquals(
    shouldTryContentReducingFallback(
      new Error("Inflated total 104857601 exceeds limit 104857600"),
    ),
    true,
  );
  assertEquals(
    shouldTryContentReducingFallback(new Error("network timeout")),
    false,
  );
});

Deno.test("group deployment snapshot service - blobless fallback requires both filter and allow-reachable-sha1-in-want", () => {
  assertEquals(
    supportsRemoteBloblessFallback([
      "side-band-64k",
      "filter",
      "allow-reachable-sha1-in-want",
    ]),
    true,
  );
  assertEquals(
    supportsRemoteBloblessFallback(["side-band-64k", "filter"]),
    false,
  );
  assertEquals(
    supportsRemoteBloblessFallback([
      "side-band-64k",
      "allow-reachable-sha1-in-want",
    ]),
    false,
  );
});

Deno.test("group deployment snapshot service - remote fetch fallback call sites are guarded by classified reasons", async () => {
  const source = await Deno.readTextFile(groupDeploymentSnapshotsSource);

  assertMatch(
    source,
    /catch \(error\) \{\s+if \(!shouldTryContentReducingFallback\(error\)\) \{\s+throw error;\s+\}/s,
  );
  assertMatch(
    source,
    /catch \(bloblessError\) \{\s+if \(!shouldTryContentReducingFallback\(bloblessError\)\) \{\s+throw bloblessError;\s+\}/s,
  );
});

Deno.test("group deployment snapshot service - manifest records expose manifest source provenance", async () => {
  const source = await buildSourceFromRow({} as never, {
    sourceKind: "manifest",
    buildSourcesJson: JSON.stringify([{ compute: "web" }]),
  } as never);
  assertEquals(source, {
    kind: "manifest",
    artifact_count: 1,
  });
});

Deno.test("group deployment snapshot records - finalize in_progress records after apply", async () => {
  const { db, inserted, updates } = createGroupDeploymentSnapshotWriteDb();
  const group = {
    id: "group-1",
    spaceId: "space-1",
    name: "demo-group",
    backend: "cloudflare",
    env: "default",
  };
  const applyResult: GroupDeploymentSnapshotMutationResult["applyResult"] = {
    groupId: "group-1",
    applied: [{
      name: "web",
      category: "worker" as const,
      action: "create" as const,
      status: "success" as const,
    }],
    skipped: [],
    diff: {
      entries: [{
        name: "web",
        category: "worker" as const,
        action: "create" as const,
      }],
      hasChanges: true,
      summary: { create: 1, update: 0, delete: 0, unchanged: 0 },
    },
    translationReport: {
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  };

  await createGroupDeploymentSnapshotRecord({ DB: db } as never, {
    deploymentId: "appdep-1",
    group: group as never,
    target: {
      repositoryUrl: "https://github.com/acme/demo.git",
      normalizedRepositoryUrl: "https://github.com/acme/demo.git",
      ref: "main",
      refType: "branch",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      treeSha: null,
      resolvedRepoId: null,
      archiveFiles: null,
      remoteCapabilities: null,
    },
    manifest: {
      name: "demo-group",
      version: "1.0.0",
      compute: {},
      routes: [],
      publish: [],
    } as never,
    buildSources: [],
    hostnames: [],
    applyResult,
    createdByAccountId: "user-1",
    snapshot: createSnapshot() as never,
    status: "in_progress",
  });

  assertEquals(inserted[0].status, "in_progress");
  assertEquals(inserted[0].hostnamesJson, "[]");
  assertEquals(inserted[0].resultJson, null);

  const finalized = await finalizeGroupDeploymentSnapshotRecord(
    { DB: db } as never,
    {
      deploymentId: "appdep-1",
      group: group as never,
      hostnames: ["demo.example.com"],
      applyResult,
    },
  );

  assertEquals(updates[0].status, "applied");
  assertEquals(
    updates[0].hostnamesJson,
    JSON.stringify([
      "demo.example.com",
    ]),
  );
  assertEquals(finalized.status, "applied");
  assertEquals(finalized.hostnames, ["demo.example.com"]);
});

Deno.test("group deployment snapshot service - local manifest artifact directories resolve to one script bundle", () => {
  const artifacts = normalizeManifestArtifacts([
    {
      compute: "web",
      files: [
        {
          path: "index.js",
          encoding: "base64",
          content: btoa("export default {};"),
        },
        {
          path: "index.js.map",
          encoding: "base64",
          content: btoa("{}"),
        },
      ],
    },
  ]);
  const artifact = artifacts.web;
  assertEquals(artifact?.kind, "worker_bundle");
  if (artifact?.kind !== "worker_bundle") {
    throw new Error("expected worker bundle artifact");
  }
  assertEquals(artifact.bundleContent, "export default {};");
});

Deno.test("group deployment snapshot service - local manifest artifact directories reject multiple scripts", () => {
  assertThrows(
    () =>
      normalizeManifestArtifacts([
        {
          compute: "web",
          files: [
            {
              path: "index.js",
              encoding: "base64",
              content: btoa("export default {};"),
            },
            {
              path: "chunk.js",
              encoding: "base64",
              content: btoa("export const chunk = true;"),
            },
          ],
        },
      ]),
    Error,
    "contains multiple JavaScript bundle candidates",
  );
});

Deno.test("group deployment snapshot service - planFromManifest runs deploy validation", async () => {
  const db = createSelectOnlyDb([null]);
  const planService = new GroupDeploymentSnapshotService({ DB: db } as never);

  await assertRejects(
    () =>
      planService.planFromManifest("space-1", "user-1", {
        groupName: "demo-group",
        manifest: {
          name: "demo-app",
          routes: [
            { target: "api", path: "/" },
            { target: "api", path: "/" },
          ],
        } as never,
      }),
    Error,
    "Deploy validation failed",
  );
});

Deno.test("group deployment snapshot service - rollback fails when the target group row no longer exists", async () => {
  const db = createSelectOnlyDb([
    {
      id: "appdep-current",
      spaceId: "space-1",
      groupId: "group-1",
      status: "applied",
      createdAt: "2026-04-02T00:00:00.000Z",
    },
    null,
  ]);
  const rollbackService = new GroupDeploymentSnapshotService(
    { DB: db } as never,
  );
  const ensureSnapshotForRowStub = stub(
    rollbackService as any,
    "ensureSnapshotForRow",
    async (row: unknown) => ({
      ...(row as Record<string, unknown>),
      snapshotR2Key: "group-deployment-snapshots/appdep-prev/snapshot.zip",
      snapshotSha256: "snapshot-sha",
    }),
  );
  const loadSnapshotStub = stub(
    rollbackService as any,
    "loadSnapshot",
    async () => createSnapshot(),
  );
  const ensureTargetGroupStub = stub(
    rollbackService as any,
    "ensureTargetGroup",
    async () => {
      throw new Error("ensureTargetGroup should not be called");
    },
  );

  try {
    await assertRejects(
      async () => {
        await rollbackService.rollback("space-1", "user-1", "appdep-current");
      },
      Error,
      "Cannot roll back a group that has already been uninstalled or deleted",
    );
    assertSpyCalls(ensureSnapshotForRowStub, 1);
    assertSpyCalls(loadSnapshotStub, 1);
    assertSpyCalls(ensureTargetGroupStub, 0);
  } finally {
    ensureSnapshotForRowStub.restore();
    loadSnapshotStub.restore();
    ensureTargetGroupStub.restore();
  }
});

Deno.test("group deployment snapshot service - rollback restores snapshot backend/env on the existing group", async () => {
  const db = createSelectOnlyDb([
    {
      id: "appdep-current",
      spaceId: "space-1",
      groupId: "group-1",
      status: "applied",
      createdAt: "2026-04-02T00:00:00.000Z",
    },
    {
      id: "group-1",
      spaceId: "space-1",
      name: "live-group",
      backend: "cloudflare",
      env: "staging",
    },
  ]);
  const rollbackService = new GroupDeploymentSnapshotService(
    { DB: db } as never,
  );
  const snapshot = createSnapshot();
  const ensureSnapshotForRowStub = stub(
    rollbackService as any,
    "ensureSnapshotForRow",
    async (row: unknown) => ({
      ...(row as Record<string, unknown>),
      snapshotR2Key: "group-deployment-snapshots/appdep-prev/snapshot.zip",
      snapshotSha256: "snapshot-sha",
    }),
  );
  const loadSnapshotStub = stub(
    rollbackService as any,
    "loadSnapshot",
    async () => snapshot,
  );
  const sentinel = new Error("stop-after-ensure-target-group");
  let capturedArgs: unknown[] | null = null;
  const ensureTargetGroupStub = stub(
    rollbackService as any,
    "ensureTargetGroup",
    async (...args: unknown[]) => {
      capturedArgs = args;
      throw sentinel;
    },
  );

  try {
    await assertRejects(
      async () => {
        await rollbackService.rollback("space-1", "user-1", "appdep-current");
      },
      Error,
      "stop-after-ensure-target-group",
    );
    assertSpyCalls(ensureSnapshotForRowStub, 1);
    assertSpyCalls(loadSnapshotStub, 1);
    assertSpyCalls(ensureTargetGroupStub, 1);
    assertEquals(capturedArgs, [
      "space-1",
      "live-group",
      snapshot.payload.manifest,
      {
        backendName: "aws",
        envName: "production",
      },
    ]);
  } finally {
    ensureSnapshotForRowStub.restore();
    loadSnapshotStub.restore();
    ensureTargetGroupStub.restore();
  }
});
