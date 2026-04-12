import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import {
  AppDeploymentService,
  normalizeManifestArtifacts,
} from "@/services/platform/app-deployments";
import { buildSourceFromRow } from "../../../../../packages/control/src/application/services/platform/app-deployments-targets.ts";
import {
  shouldTryContentReducingFallback,
  supportsRemoteBloblessFallback,
} from "../../../../../packages/control/src/application/services/platform/remote-fetch-policy.ts";

const service = new AppDeploymentService({} as never);
const appDeploymentsSource = new URL(
  "../../../../../packages/control/src/application/services/platform/app-deployments.ts",
  import.meta.url,
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
      provider: "aws",
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
    r2Key: "app-deployments/appdep-prev/snapshot.takopack",
    sha256: "snapshot-sha",
    sizeBytes: 0,
    format: "takopack-v1",
  };
}

Deno.test("app deployment service - rejects non-https repository URLs", async () => {
  await assertRejects(
    async () => {
      await service.deploy("space-1", "user-1", {
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

Deno.test("app deployment service - rejects repository URLs with credentials", async () => {
  await assertRejects(
    async () => {
      await service.deploy("space-1", "user-1", {
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

Deno.test("app deployment service - rejects repository URLs with query strings", async () => {
  await assertRejects(
    async () => {
      await service.deploy("space-1", "user-1", {
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

Deno.test("app deployment service - fallback policy only retries content-reduction class failures", () => {
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

Deno.test("app deployment service - blobless fallback requires both filter and allow-reachable-sha1-in-want", () => {
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

Deno.test("app deployment service - remote fetch fallback call sites are guarded by classified reasons", async () => {
  const source = await Deno.readTextFile(appDeploymentsSource);

  assertMatch(
    source,
    /catch \(error\) \{\s+if \(!shouldTryContentReducingFallback\(error\)\) \{\s+throw error;\s+\}/s,
  );
  assertMatch(
    source,
    /catch \(bloblessError\) \{\s+if \(!shouldTryContentReducingFallback\(bloblessError\)\) \{\s+throw bloblessError;\s+\}/s,
  );
});

Deno.test("app deployment service - manifest records expose manifest source provenance", async () => {
  const source = await buildSourceFromRow({} as never, {
    sourceKind: "manifest",
    buildSourcesJson: JSON.stringify([{ compute: "web" }]),
  } as never);
  assertEquals(source, {
    kind: "manifest",
    artifact_count: 1,
  });
});

Deno.test("app deployment service - local manifest artifact directories resolve to one script bundle", () => {
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

Deno.test("app deployment service - local manifest artifact directories reject multiple scripts", () => {
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

Deno.test("app deployment service - planFromManifest runs deploy validation", async () => {
  const planService = new AppDeploymentService({ DB: {} } as never);
  globalThis.__takosDbMock = createSelectOnlyDb([null]) as never;

  try {
    await assertRejects(
      () =>
        planService.planFromManifest("space-1", "user-1", {
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
  } finally {
    globalThis.__takosDbMock = undefined;
  }
});

Deno.test("app deployment service - rollback fails when the target group row no longer exists", async () => {
  const rollbackService = new AppDeploymentService({ DB: {} } as never);
  const ensureSnapshotForRowStub = stub(
    rollbackService as any,
    "ensureSnapshotForRow",
    async (row: unknown) => ({
      ...(row as Record<string, unknown>),
      snapshotR2Key: "app-deployments/appdep-prev/snapshot.takopack",
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

  globalThis.__takosDbMock = createSelectOnlyDb([
    {
      id: "appdep-current",
      spaceId: "space-1",
      groupId: "group-1",
      status: "applied",
      createdAt: "2026-04-02T00:00:00.000Z",
    },
    {
      id: "appdep-prev",
      spaceId: "space-1",
      groupId: "group-1",
      status: "applied",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    null,
  ]) as never;

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
    globalThis.__takosDbMock = undefined;
    ensureSnapshotForRowStub.restore();
    loadSnapshotStub.restore();
    ensureTargetGroupStub.restore();
  }
});

Deno.test("app deployment service - rollback restores snapshot provider/env on the existing group", async () => {
  const rollbackService = new AppDeploymentService({ DB: {} } as never);
  const snapshot = createSnapshot();
  const ensureSnapshotForRowStub = stub(
    rollbackService as any,
    "ensureSnapshotForRow",
    async (row: unknown) => ({
      ...(row as Record<string, unknown>),
      snapshotR2Key: "app-deployments/appdep-prev/snapshot.takopack",
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

  globalThis.__takosDbMock = createSelectOnlyDb([
    {
      id: "appdep-current",
      spaceId: "space-1",
      groupId: "group-1",
      status: "applied",
      createdAt: "2026-04-02T00:00:00.000Z",
    },
    {
      id: "appdep-prev",
      spaceId: "space-1",
      groupId: "group-1",
      status: "applied",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    {
      id: "group-1",
      spaceId: "space-1",
      name: "live-group",
      provider: "cloudflare",
      env: "staging",
    },
  ]) as never;

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
        providerName: "aws",
        envName: "production",
      },
    ]);
  } finally {
    globalThis.__takosDbMock = undefined;
    ensureSnapshotForRowStub.restore();
    loadSnapshotStub.restore();
    ensureTargetGroupStub.restore();
  }
});
