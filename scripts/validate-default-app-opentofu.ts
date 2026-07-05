#!/usr/bin/env -S bun
import { basename, join, resolve } from "node:path";
import * as runtime from "./runtime.ts";
import { parseOpenTofuAppManifestOutputs } from "../src/worker/application/services/source/opentofu-app-manifest.ts";

type DefaultAppSource = {
  name: string;
  path: string;
  requiresPostApply?: boolean;
};

const repoRoot = resolve(runtime.cwd(), "..");
const tofuBin = runtime.env.get("TAKOS_OPENTOFU_BIN") ?? "tofu";

const defaultApps: readonly DefaultAppSource[] = [
  { name: "takos-office", path: "takos-apps/takos-office" },
  { name: "takos-computer", path: "takos-apps/takos-computer" },
  { name: "yurucommu", path: "yurucommu", requiresPostApply: true },
];

const LEGACY_PUBLICATION_TYPES = new Set([
  "UiSurface",
  "McpServer",
  "FileHandler",
]);

const results: Array<{
  name: string;
  manifestName?: string;
  publications: number;
  serviceExports: number;
  serviceBindings: number;
  postApplyCommands: number;
}> = [];

for (const app of defaultApps) {
  results.push(await validateDefaultApp(app));
}

console.log(JSON.stringify({ ok: true, apps: results }, null, 2));

async function validateDefaultApp(app: DefaultAppSource): Promise<{
  name: string;
  manifestName?: string;
  publications: number;
  serviceExports: number;
  serviceBindings: number;
  postApplyCommands: number;
}> {
  const sourceDir = join(repoRoot, app.path);
  const outputText = await runtime.readTextFile(join(sourceDir, "outputs.tf"));
  const hasLegacyTakosAppOutput = outputText.includes('output "takos_app"');
  const hasAppDeploymentOutput = outputText.includes('output "app_deployment"');
  if (hasLegacyTakosAppOutput) {
    throw new Error(
      `${app.name}: outputs.tf must not declare legacy output "takos_app"; use "app_deployment"`,
    );
  }
  if (!outputText.includes('output "service_exports"')) {
    throw new Error(
      `${app.name}: outputs.tf must declare generic output "service_exports"`,
    );
  }

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
    const source = `${app.path}/outputs.tf`;
    const serviceGraph = parseServiceGraphOutputs(outputJson, source);
    const launcherExport = serviceGraph.exports.find((serviceExport) =>
      serviceExport.capabilities.includes("interface.ui.surface"),
    );
    if (!launcherExport) {
      throw new Error(
        `${app.name}: service_exports must include an interface.ui.surface launcher`,
      );
    }

    let manifestName: string | undefined;
    let publications = 0;
    if (hasAppDeploymentOutput) {
      const manifest = parseOpenTofuAppManifestOutputs(outputJson, source);
      if (manifest.name !== app.name) {
        throw new Error(
          `${app.name}: expected manifest name ${app.name}, got ${manifest.name}`,
        );
      }
      const launcher = manifest.publish.find(
        (publication) =>
          publication.type === "interface.ui.surface" &&
          publication.spec?.launcher === true,
      );
      if (!launcher) {
        throw new Error(
          `${app.name}: app projection must publish a launcher interface.ui.surface`,
        );
      }
      for (const [index, publication] of manifest.publish.entries()) {
        if (LEGACY_PUBLICATION_TYPES.has(publication.type)) {
          throw new Error(
            `${app.name}: publish[${index}].type must use canonical Service Graph capability, got ${publication.type}`,
          );
        }
      }
      manifestName = manifest.name;
      publications = manifest.publish.length;
    }

    const release = parseTakosumiReleaseOutput(outputJson, source);
    if (app.requiresPostApply && release.postApplyCommands.length === 0) {
      throw new Error(
        `${app.name}: takosumi_release.post_apply must include at least one command`,
      );
    }
    return {
      name: app.name,
      ...(manifestName ? { manifestName } : {}),
      publications,
      serviceExports: serviceGraph.exports.length,
      serviceBindings: serviceGraph.bindings.length,
      postApplyCommands: release.postApplyCommands.length,
    };
  } finally {
    await runtime.remove(workdir, { recursive: true });
  }
}

type ServiceExport = {
  name: string;
  capabilities: string[];
};

function parseServiceGraphOutputs(
  raw: string,
  source: string,
): { exports: ServiceExport[]; bindings: unknown[] } {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be an OpenTofu output object`);
  }
  const outputs = parsed as Record<string, unknown>;
  const serviceExports = parseServiceExportsOutput(
    outputs.service_exports,
    source,
  );
  const serviceBindings =
    outputs.service_bindings === undefined
      ? []
      : parseArrayOutput(
          outputs.service_bindings,
          `${source}.service_bindings`,
        );
  return { exports: serviceExports, bindings: serviceBindings };
}

function parseServiceExportsOutput(
  output: unknown,
  source: string,
): ServiceExport[] {
  const value = parseArrayOutput(output, `${source}.service_exports`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${source}.service_exports[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.trim().length === 0) {
      throw new Error(`${source}.service_exports[${index}].name is required`);
    }
    if (
      !Array.isArray(record.capabilities) ||
      record.capabilities.length === 0 ||
      !record.capabilities.every((capability) => typeof capability === "string")
    ) {
      throw new Error(
        `${source}.service_exports[${index}].capabilities must be a non-empty string array`,
      );
    }
    for (const capability of record.capabilities) {
      if (LEGACY_PUBLICATION_TYPES.has(capability)) {
        throw new Error(
          `${source}.service_exports[${index}].capabilities must use canonical Service Graph capability, got ${capability}`,
        );
      }
    }
    return {
      name: record.name,
      capabilities: record.capabilities,
    };
  });
}

function parseArrayOutput(output: unknown, source: string): unknown[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${source} must be an OpenTofu output object`);
  }
  const outputRecord = output as Record<string, unknown>;
  if (outputRecord.sensitive === true) {
    throw new Error(`${source} must not be sensitive`);
  }
  const value = outputRecord.value;
  if (!Array.isArray(value)) {
    throw new Error(`${source}.value must be an array`);
  }
  return value;
}

function parseTakosumiReleaseOutput(
  raw: string,
  source: string,
): { postApplyCommands: string[] } {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be an OpenTofu output object`);
  }
  const output = (parsed as Record<string, unknown>).takosumi_release;
  if (output === undefined) {
    return { postApplyCommands: [] };
  }
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${source}.takosumi_release must be an output object`);
  }
  const outputRecord = output as Record<string, unknown>;
  if (outputRecord.sensitive === true) {
    throw new Error(`${source}.takosumi_release must not be sensitive`);
  }
  const value = outputRecord.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}.takosumi_release.value must be an object`);
  }
  const release = value as Record<string, unknown>;
  const postApply = release.post_apply ?? release.postApply;
  if (postApply === undefined) {
    return { postApplyCommands: [] };
  }
  if (!Array.isArray(postApply)) {
    throw new Error(`${source}.takosumi_release.post_apply must be an array`);
  }
  return {
    postApplyCommands: postApply.map((entry, index) =>
      parsePostApplyCommand(
        entry,
        `${source}.takosumi_release.post_apply[${index}]`,
      ),
    ),
  };
}

function parsePostApplyCommand(entry: unknown, source: string): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${source} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new Error(`${source}.id is required`);
  }
  if (record.executor !== "operator" && record.executor !== "runner") {
    throw new Error(`${source}.executor must be operator or runner`);
  }
  if (
    !Array.isArray(record.command) ||
    record.command.length === 0 ||
    !record.command.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`${source}.command must be a non-empty string array`);
  }
  if (
    record.working_directory !== undefined &&
    (typeof record.working_directory !== "string" ||
      record.working_directory.trim().length === 0)
  ) {
    throw new Error(`${source}.working_directory must be a non-empty string`);
  }
  const env = record.env;
  if (env !== undefined) {
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      throw new Error(`${source}.env must be an object`);
    }
    for (const [name, value] of Object.entries(env)) {
      if (looksSecretLikeEnvName(name)) {
        throw new Error(`${source}.env must not include secret-like ${name}`);
      }
      if (typeof value !== "string") {
        throw new Error(`${source}.env.${name} must be a string`);
      }
    }
  }
  return record.id;
}

function looksSecretLikeEnvName(name: string): boolean {
  return /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|BEARER|SESSION|COOKIE|KEY)(?:_|$)|(?:^|_)(?:DATABASE|DB|POSTGRES|POSTGRESQL|MYSQL|MARIADB|REDIS|MONGO|MONGODB|LIBSQL|SQLITE)_?(?:URL|URI|DSN)(?:_|$)|(?:^|_)(?:DSN|CONNECTION_STRING)(?:_|$)/i.test(
    name,
  );
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
