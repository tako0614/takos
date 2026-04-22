import { assertEquals, assertThrows } from "jsr:@std/assert";
import { BadRequestError } from "takos-common/errors";

import type { Env } from "../../../../shared/types/index.ts";
import type { AppManifest } from "../../source/app-manifest.ts";
import type { ResolvedGitTarget } from "../group-deployment-snapshots-model.ts";
import {
  resolveBuildArtifacts,
  resolveContainerImageArtifact,
} from "../group-deployment-snapshot-artifacts.ts";

Deno.test(
  "resolveContainerImageArtifact rejects dockerfile-only attached containers for group deployment snapshots",
  () => {
    assertThrows(
      () =>
        resolveContainerImageArtifact(
          "sandbox",
          "container",
          {
            kind: "attached-container",
            dockerfile: "./containers/sandbox.Dockerfile",
          } as any,
        ),
      BadRequestError,
      "requires compute.image",
    );
  },
);

Deno.test("resolveBuildArtifacts uses committed worker bundles for public repositories without reading workflow artifacts", async () => {
  const target: ResolvedGitTarget = {
    repositoryUrl: "https://github.com/example/app.git",
    normalizedRepositoryUrl: "https://github.com/example/app.git",
    ref: "master",
    refType: "branch",
    commitSha: "0".repeat(40),
    treeSha: null,
    resolvedRepoId: null,
    remoteCapabilities: [],
    archiveFiles: new Map([
      ["dist/worker.js", new TextEncoder().encode("export default {};")],
    ]),
  };
  const manifest: AppManifest = {
    name: "demo",
    version: "0.1.0",
    routes: [],
    publish: [],
    env: {},
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "build-web",
            artifact: "web",
            artifactPath: "dist/worker.js",
          },
        },
      },
    },
  };

  const result = await resolveBuildArtifacts(
    {
      DB: {} as Env["DB"],
      GIT_OBJECTS: {} as Env["GIT_OBJECTS"],
    } as Env,
    target,
    manifest,
  );

  assertEquals(result.artifacts.web?.kind, "worker_bundle");
  const artifact = result.artifacts.web;
  if (artifact?.kind !== "worker_bundle") {
    throw new Error("expected worker bundle artifact");
  }
  assertEquals(artifact.bundleContent, "export default {};");
  assertEquals(result.buildSources[0]?.artifact_path, "dist/worker.js");
});
