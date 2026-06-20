#!/usr/bin/env -S bun
import { basename, join, resolve } from "node:path";
import * as runtime from "./runtime.ts";
import { parseOpenTofuAppManifestOutputs } from "../src/worker/application/services/source/opentofu-app-manifest.ts";

type DefaultAppSource = {
  name: string;
  path: string;
};

const repoRoot = resolve(runtime.cwd(), "..");
const tofuBin = runtime.env.get("TAKOS_OPENTOFU_BIN") ?? "tofu";

const defaultApps: readonly DefaultAppSource[] = [
  { name: "takos-docs", path: "takos-apps/takos-docs" },
  { name: "takos-slide", path: "takos-apps/takos-slide" },
  { name: "takos-excel", path: "takos-apps/takos-excel" },
  { name: "takos-computer", path: "takos-apps/takos-computer" },
  { name: "yurucommu", path: "yurucommu" },
  { name: "road-to-me", path: "road-to-me" },
];

const LEGACY_PUBLICATION_TYPES = new Set([
  "UiSurface",
  "McpServer",
  "FileHandler",
]);

const results: Array<{
  name: string;
  manifestName?: string;
  serviceExports: number;
}> = [];

for (const app of defaultApps) {
  results.push(await validateDefaultApp(app));
}

console.log(JSON.stringify({ ok: true, apps: results }, null, 2));

async function validateDefaultApp(
  app: DefaultAppSource,
): Promise<{ name: string; manifestName?: string; serviceExports: number }> {
  const sourceDir = join(repoRoot, app.path);
  const outputText = await runtime.readTextFile(join(sourceDir, "outputs.tf"));
  if (!outputText.includes('output "service_exports"')) {
    throw new Error(
      `${app.name}: outputs.tf must declare output "service_exports"`,
    );
  }
  const hasAppDeploymentOutput = outputText.includes('output "app_deployment"');

  const workdir = await runtime.makeTempDir({
    prefix: `takos-default-${app.name}-`,
  });
  try {
    for await (const entry of runtime.readDir(sourceDir)) {
      if (!entry.isFile || !entry.name.endsWith(".tf")) continue;
      const sourcePath = join(sourceDir, entry.name);
      await runtime.writeTextFile(
        join(workdir, basename(entry.name)),
        await runtime.readTextFile(sourcePath),
      );
    }

    await runTofu(
      ["init", "-backend=false", "-input=false"],
      workdir,
      app.name,
    );
    await runTofu(["validate", "-no-color"], workdir, app.name);
    await runTofu(
      [
        "apply",
        "-auto-approve",
        "-input=false",
        "-refresh=false",
        "-lock=false",
      ],
      workdir,
      app.name,
    );
    const outputJson = await runTofu(["output", "-json"], workdir, app.name);
    const serviceExports = parseOpenTofuServiceExportsOutput(
      outputJson,
      `${app.path}/outputs.tf`,
    );
    if (serviceExports.length === 0) {
      throw new Error(`${app.name}: service_exports must not be empty`);
    }
    const launcher = serviceExports.find((serviceExport) =>
      serviceExport.capabilities.includes("interface.ui.surface"),
    );
    if (!launcher) {
      throw new Error(
        `${app.name}: service_exports must include interface.ui.surface`,
      );
    }
    if (!hasAppDeploymentOutput) {
      return { name: app.name, serviceExports: serviceExports.length };
    }
    const manifest = parseOpenTofuAppManifestOutputs(
      outputJson,
      `${app.path}/outputs.tf`,
    );
    if (manifest.name !== app.name) {
      throw new Error(
        `${app.name}: expected manifest name ${app.name}, got ${manifest.name}`,
      );
    }
    for (const [index, publication] of manifest.publish.entries()) {
      if (LEGACY_PUBLICATION_TYPES.has(publication.type)) {
        throw new Error(
          `${app.name}: app_deployment.publish[${index}].type must use canonical Service Graph capability, got ${publication.type}`,
        );
      }
    }
    return {
      name: app.name,
      manifestName: manifest.name,
      serviceExports: serviceExports.length,
    };
  } finally {
    await runtime.remove(workdir, { recursive: true });
  }
}

function parseOpenTofuServiceExportsOutput(
  raw: string,
  source: string,
): Array<{ name: string; capabilities: string[] }> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be an OpenTofu output object`);
  }
  const output = (parsed as Record<string, unknown>).service_exports;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${source} must include service_exports output`);
  }
  if ((output as { sensitive?: unknown }).sensitive === true) {
    throw new Error(`${source}.service_exports must not be sensitive`);
  }
  const value = (output as { value?: unknown }).value;
  if (!Array.isArray(value)) {
    throw new Error(`${source}.service_exports.value must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${source}.service_exports[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.length === 0) {
      throw new Error(`${source}.service_exports[${index}].name is required`);
    }
    if (
      !Array.isArray(record.capabilities) ||
      !record.capabilities.every((item) => typeof item === "string")
    ) {
      throw new Error(
        `${source}.service_exports[${index}].capabilities must be string[]`,
      );
    }
    return {
      name: record.name,
      capabilities: record.capabilities,
    };
  });
}

async function runTofu(
  args: readonly string[],
  cwd: string,
  appName: string,
): Promise<string> {
  const result = await runtime.runCommand(tofuBin, {
    args: [...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.code !== 0) {
    throw new Error(
      `${appName}: ${tofuBin} ${args.join(" ")} failed with exit ${result.code}\nstdout:\n${decode(result.stdout)}\nstderr:\n${decode(result.stderr)}`,
    );
  }
  return decode(result.stdout);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
