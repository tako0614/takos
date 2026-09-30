import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { buildOpentofuWorkerArtifact } from "./build-opentofu-worker-artifact.ts";

const root = new URL("../", import.meta.url);

test("the Worker artifact contract is module-local and builds the resolved repository source", async () => {
  const manifest = JSON.parse(
    await readFile(new URL(".well-known/takosumi.json", root), "utf8"),
  ) as {
    install: {
      modules: Record<string, { sourceBuild?: { commands: unknown[]; outputs: string[] } }>;
    };
  };
  const sourceBuild = manifest.install.modules["deploy/opentofu/cloudflare"]?.sourceBuild;
  expect(sourceBuild?.commands).toEqual([
    { argv: ["bun", "install", "--frozen-lockfile"] },
    { argv: ["bun", "run", "build:opentofu-worker-artifact"] },
  ]);
  expect(sourceBuild?.outputs).toEqual([
    "deploy/opentofu/cloudflare/.takos-build/worker/index.js",
    "deploy/opentofu/cloudflare/.takos-build/assets",
    "deploy/opentofu/cloudflare/.takos-build/bridge/takos-cloudflare-opentofu-bridge.ts",
    "deploy/opentofu/cloudflare/.takos-build/container-desired.json",
    "deploy/opentofu/cloudflare/.takos-build/manifest.json",
  ]);
  const builder = await readFile(
    new URL("scripts/build-opentofu-worker-artifact.ts", root),
    "utf8",
  );
  expect(builder).not.toContain("PINNED_WORKER_ARCHIVE_URL");
  expect(builder).not.toContain("PINNED_WORKER_ARCHIVE_SHA256");
  expect(builder).toContain("src/worker/cloudflare-entrypoint.ts");
});

test("the Cloudflare module declares every operator-reviewed provider-gap value as a user input", async () => {
  const manifest = JSON.parse(
    await readFile(new URL(".well-known/takosumi.json", root), "utf8"),
  ) as {
    install: {
      modules: Record<
        string,
        { inputs?: Array<{ name: string; source: { kind: string } }> }
      >;
    };
  };
  const inputs = manifest.install.modules["deploy/opentofu/cloudflare"]?.inputs;
  const sourceKind = (name: string) =>
    inputs?.find((input) => input.name === name)?.source.kind;

  expect(sourceKind("environment")).toBe("user");
  expect(sourceKind("cloudflare_provider_gap_bridge_mode")).toBe("user");
  expect(sourceKind("cloudflare_provider_gap_bridge_acknowledgement")).toBe("user");
});

test("the nested Cloudflare module keeps artifact paths module-local", async () => {
  const moduleSource = await readFile(
    new URL("deploy/opentofu/cloudflare/modules/platform/main.tf", root),
    "utf8",
  );

  expect(moduleSource).toContain('${path.module}/../..');
  expect(moduleSource).not.toContain("abspath(");
  expect(moduleSource).not.toContain("path.root");
});

test("the source-build payload carries no SQL for the module to apply", async () => {
  const builder = await readFile(
    new URL("scripts/build-opentofu-worker-artifact.ts", root),
    "utf8",
  );
  expect(builder).not.toContain("db/migrations-control/migrations");
  expect(builder).not.toContain(".takos-build/migrations");
});

test("source materialization copies the exact current Worker and assets", async () => {
  const temporaryRoot = await mkdtemp("takos-opentofu-artifact-test-");
  try {
    const fixture = join(temporaryRoot, "fixture");
    await Bun.write(join(fixture, "worker", "index.js"), "export default { fetch() {} };\n");
    await Bun.write(join(fixture, "assets", "index.html"), "current source\n");
    await Bun.write(
      join(temporaryRoot, "scripts", "takos-cloudflare-opentofu-bridge.ts"),
      "export {};\n",
    );
    const result = await buildOpentofuWorkerArtifact({
      rootDirectory: temporaryRoot,
      sourceBuilder: async () => ({
        worker: join(fixture, "worker", "index.js"),
        assets: join(fixture, "assets"),
      }),
    });

    expect(await readFile(result.workerPath, "utf8")).toBe(
      "export default { fetch() {} };\n",
    );
    expect(await readFile(join(result.assetsPath, "index.html"), "utf8")).toBe(
      "current source\n",
    );
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(manifest.format).toBe("takos-opentofu-worker-artifact/v2");
    expect(manifest.source).toBe("repository-source");
    expect(manifest).not.toHaveProperty("archive");
    expect(manifest).not.toHaveProperty("migrations");
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
