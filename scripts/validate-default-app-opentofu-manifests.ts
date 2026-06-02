#!/usr/bin/env -S bun
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseOpenTofuAppManifestOutputs } from "../src/worker/application/services/source/opentofu-app-manifest.ts";

type AppCheck = {
  name: string;
  root: string;
};

const ecosystemRoot = new URL("../../", import.meta.url);

const apps: AppCheck[] = [
  { name: "takos-docs", root: "takos-apps/takos-docs" },
  { name: "takos-slide", root: "takos-apps/takos-slide" },
  { name: "takos-excel", root: "takos-apps/takos-excel" },
  { name: "takos-computer", root: "takos-apps/takos-computer" },
  { name: "yurucommu", root: "yurucommu" },
  { name: "road-to-me", root: "road-to-me" },
];

function repoPath(path: string): string {
  return new URL(path, ecosystemRoot).pathname;
}

function runTofu(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["tofu", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `tofu ${args.join(" ")} failed in ${cwd} with exit ${result.exitCode}\nstdout:\n${
        result.stdout.toString()
      }\nstderr:\n${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const version = Bun.spawnSync(["tofu", "version"], {
  stdout: "pipe",
  stderr: "pipe",
});
if (version.exitCode !== 0) {
  throw new Error(
    `OpenTofu CLI is required for default app manifest validation\nstderr:\n${version.stderr.toString()}`,
  );
}

const tempRoot = await mkdtemp(join(tmpdir(), "takos-default-app-opentofu-"));
const checked: string[] = [];
const tofuVersion = version.stdout.toString().split(/\r?\n/)[0] ?? "tofu";

try {
  for (const app of apps) {
    const outputsPath = repoPath(`${app.root}/outputs.tf`);
    assert(
      existsSync(outputsPath),
      `${app.root}/outputs.tf is required for OpenTofu-native app source`,
    );

    const workdir = join(tempRoot, app.name);
    await mkdir(workdir, { recursive: true });
    await cp(outputsPath, join(workdir, "outputs.tf"));
    runTofu(["init", "-backend=false", "-input=false"], workdir);
    runTofu(["validate", "-no-color"], workdir);
    runTofu([
      "apply",
      "-auto-approve",
      "-input=false",
      "-refresh=false",
      "-lock=false",
    ], workdir);
    const outputJson = runTofu(["output", "-json"], workdir);
    const manifest = parseOpenTofuAppManifestOutputs(
      outputJson,
      `${app.root}/outputs.tf`,
    );

    assert(
      manifest.name === app.name,
      `${app.root}/outputs.tf manifest name must be ${app.name}`,
    );
    assert(
      manifest.compute.web?.kind === "worker",
      `${app.root}/outputs.tf must declare compute.web as worker`,
    );
    assert(
      manifest.publish.some((entry) =>
        entry.type === "takos.ui-surface.v1" && entry.publisher === "web"
      ),
      `${app.root}/outputs.tf must publish a web-owned UiSurface`,
    );
    assert(
      !manifest.publish.some((entry) => entry.publisher === "takos"),
      `${app.root}/outputs.tf must not publish as takos`,
    );
    checked.push(app.name);
  }

  console.log(JSON.stringify({
    ok: true,
    checked,
    tofu: tofuVersion,
  }));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
