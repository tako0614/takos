import { assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import {
  applyArtifactChangesToDiff,
  buildGroupSnapshotUpdate,
  buildPublicationPrerequisiteManifest,
  manifestNeedsEarlyPublicationSync,
  resolveTargetWorkloadNames,
} from "../apply-engine.ts";
import { computeSHA256 } from "../../../../shared/utils/hash.ts";

Deno.test(
  "buildGroupSnapshotUpdate keeps the previous group snapshot on degraded apply",
  () => {
    const desiredState = compileGroupDesiredState({
      name: "demo",
      version: "2.0.0",
      compute: {},
      routes: [],
      publish: [],
      env: {},
    });
    const currentGroup = {
      appVersion: "1.0.0",
      backend: "aws",
      env: "production",
      desiredSpecJson: JSON.stringify({
        name: "demo",
        version: "1.0.0",
      }),
      backendStateJson: JSON.stringify({ ok: true }),
    } as never;

    assertEquals(
      buildGroupSnapshotUpdate(desiredState, currentGroup, "degraded"),
      {
        appVersion: "1.0.0",
        backend: "aws",
        env: "production",
        desiredSpecJson: JSON.stringify({
          name: "demo",
          version: "1.0.0",
        }),
        backendStateJson: JSON.stringify({ ok: true }),
        reconcileStatus: "degraded",
      },
    );
  },
);

Deno.test("manifestNeedsEarlyPublicationSync only triggers for same-manifest consumes", () => {
  assertEquals(
    manifestNeedsEarlyPublicationSync({
      publish: [{ name: "ui", publisher: "web", type: "UiSurface", path: "/" }],
      compute: { web: { kind: "worker" } },
    }),
    false,
  );
  assertEquals(
    manifestNeedsEarlyPublicationSync({
      publish: [{ name: "ui", publisher: "web", type: "UiSurface", path: "/" }],
      compute: {
        web: {
          kind: "worker",
          consume: [{ publication: "external-ui" }],
        },
      },
    }),
    false,
  );
  assertEquals(
    manifestNeedsEarlyPublicationSync({
      publish: [{ name: "ui", publisher: "web", type: "UiSurface", path: "/" }],
      compute: {
        web: {
          kind: "worker",
          consume: [{ publication: "ui" }],
        },
      },
    }),
    true,
  );
});

Deno.test("applyArtifactChangesToDiff marks unchanged worker when bundle code changes", async () => {
  const currentHash = await computeSHA256("old bundle");
  const result = await applyArtifactChangesToDiff(
    {
      entries: [{
        name: "web",
        category: "worker",
        action: "unchanged",
        type: "worker",
      }],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 1 },
    },
    {
      workloads: {
        web: {
          codeHash: currentHash,
        },
      },
    } as never,
    {
      web: {
        kind: "worker_bundle",
        bundleContent: "new bundle",
      },
    },
  );

  assertEquals(result.entries[0]?.action, "update");
  assertEquals(result.entries[0]?.reason, "code changed");
  assertEquals(result.summary, { create: 0, update: 1, delete: 0, unchanged: 0 });
  assertEquals(result.hasChanges, true);
});

Deno.test("buildGroupSnapshotUpdate advances the group snapshot on success", () => {
  const desiredState = compileGroupDesiredState({
    name: "demo",
    version: "2.0.0",
    compute: {},
    routes: [],
    publish: [],
    env: {},
  });
  const currentGroup = {
    appVersion: "1.0.0",
    backend: "aws",
    env: "production",
    desiredSpecJson: JSON.stringify({
      name: "demo",
      version: "1.0.0",
    }),
    backendStateJson: JSON.stringify({ ok: true }),
  } as never;

  assertEquals(buildGroupSnapshotUpdate(desiredState, currentGroup, "ready"), {
    appVersion: "2.0.0",
    backend: "cloudflare",
    env: "default",
    desiredSpecJson: JSON.stringify(desiredState.manifest),
    backendStateJson: JSON.stringify({ ok: true }),
    reconcileStatus: "ready",
  });
});

Deno.test(
  "resolveTargetWorkloadNames and buildPublicationPrerequisiteManifest scope targeted applies",
  () => {
    const desiredState = compileGroupDesiredState({
      name: "demo",
      version: "1.0.0",
      compute: {
        web: { kind: "worker" },
        api: {
          kind: "service",
          image:
            "ghcr.io/example/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
      routes: [{ target: "web", path: "/" }],
      publish: [
        {
          name: "web-tools",
          publisher: "web",
          type: "McpServer",
          path: "/",
        },
        {
          name: "api-tools",
          publisher: "api",
          type: "McpServer",
          path: "/api",
        },
      ],
      env: {},
    });

    const targetWorkloadNames = resolveTargetWorkloadNames(
      desiredState,
      ["web", "route.web"],
    );

    assertEquals(targetWorkloadNames, ["web"]);

    const scopedManifest = buildPublicationPrerequisiteManifest(
      desiredState,
      targetWorkloadNames,
    );

    assertEquals(Object.keys(scopedManifest.compute ?? {}), ["web"]);
    assertEquals(scopedManifest.publish?.map((entry) => entry.name), [
      "web-tools",
    ]);
  },
);
