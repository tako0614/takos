import { test } from "bun:test";
import { assertEquals, assertThrows } from "@takos/test/assert";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { selectInstallableSourcePathFromRepo } from "../app-manifest-bundle.ts";
import { parseOpenTofuAppManifestOutputs } from "../opentofu-app-manifest.ts";

const fixtureRoot = new URL("../__fixtures__/opentofu-only-app/", import.meta.url);

function runTofu(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["tofu", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `tofu ${args.join(" ")} failed with exit ${result.exitCode}\nstdout:\n${
        result.stdout.toString()
      }\nstderr:\n${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

const manifestValue = {
  name: "opentofu-app",
  version: "1.2.3",
  compute: {
    web: {
      kind: "worker",
      image:
        "ghcr.io/takos/example@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  },
  routes: [{
    id: "root",
    target: "web",
    path: "/",
  }],
  publish: [{
    name: "ui",
    publisher: "web",
    type: "takos.ui-surface.v1",
    outputs: {
      url: {
        kind: "url",
        routeRef: "root",
      },
    },
  }],
  env: {
    FEATURE_FLAG: "on",
  },
};

test("parseOpenTofuAppManifestOutputs reads takos_app_manifest output", () => {
  const manifest = parseOpenTofuAppManifestOutputs({
    takos_app_manifest: {
      sensitive: false,
      type: "object",
      value: manifestValue,
    },
  });

  assertEquals(manifest.name, "opentofu-app");
  assertEquals(manifest.compute.web?.kind, "worker");
  assertEquals(manifest.routes[0]?.id, "root");
  assertEquals(manifest.publish[0]?.name, "ui");
  assertEquals(manifest.env.FEATURE_FLAG, "on");
});

test("parseOpenTofuAppManifestOutputs reads tofu output JSON text", () => {
  const manifest = parseOpenTofuAppManifestOutputs(JSON.stringify({
    takos_app: {
      sensitive: false,
      value: manifestValue,
    },
  }));

  assertEquals(manifest.name, "opentofu-app");
});

test("parseOpenTofuAppManifestOutputs rejects sensitive app manifest output", () => {
  assertThrows(
    () =>
      parseOpenTofuAppManifestOutputs({
        takos_app_manifest: {
          sensitive: true,
          value: manifestValue,
        },
      }),
    Error,
    "must not be a sensitive OpenTofu output",
  );
});

test("selectInstallableSourcePathFromRepo prefers OpenTofu module files", () => {
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json", "main.tf"]),
    "main.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json", "opentofu/main.tf"]),
    "opentofu/main.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json", "infra/outputs.tf"]),
    "infra/outputs.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json"]),
    "package.json",
  );
});

test("OpenTofu-only fixture emits takos_app_manifest through tofu output", async () => {
  const fixtureFiles = await readdir(fixtureRoot);
  assertEquals(fixtureFiles.toSorted(), ["outputs.tf", "package.json"]);
  assertEquals(
    selectInstallableSourcePathFromRepo(fixtureFiles),
    "outputs.tf",
  );

  const workdir = await mkdtemp(join(tmpdir(), "takos-opentofu-app-"));
  try {
    await cp(fixtureRoot, workdir, { recursive: true });
    runTofu(["init", "-backend=false", "-input=false"], workdir);
    runTofu([
      "apply",
      "-auto-approve",
      "-input=false",
      "-refresh=false",
      "-lock=false",
    ], workdir);

    const outputs = runTofu(["output", "-json"], workdir);
    const manifest = parseOpenTofuAppManifestOutputs(outputs);

    assertEquals(manifest.name, "opentofu-only-app");
    assertEquals(manifest.compute.web?.kind, "worker");
    assertEquals(manifest.routes[0]?.id, "root");
    assertEquals(manifest.publish[0]?.type, "takos.ui-surface.v1");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
