#!/usr/bin/env -S deno run --config deno.json --allow-read --allow-run=git

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type DenoConfig = {
  name?: string;
  version?: string;
  workspace?: string[];
  exports?: Record<string, string> | string;
  tasks?: Record<string, string>;
};

type CommandManifest = {
  name: string;
  command: string[];
  env?: Record<string, string>;
};

const root = Deno.cwd();
const outputArg = parseOutputArg(Deno.args);
const commands = validationCommands();
assertRequiredValidationCommands(commands);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  package: await collectPackageManifest(),
  git: await collectGitInfo(),
  validationCommands: commands,
  distributions: await collectDistributionManifests(),
  processRoles: await collectProcessRoles(),
  domainDirs: await collectDomainDirs(),
  smokeScripts: await collectSmokeScripts(),
};

const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (outputArg) {
  await Deno.writeTextFile(outputArg, json);
} else {
  console.log(json.trimEnd());
}

function parseOutputArg(args: string[]): string | null {
  if (args.length === 0) return null;
  const [flag, value, ...rest] = args;
  if (flag !== '--output' || !value || rest.length > 0) {
    console.error(
      'Usage: deno run --config deno.json --allow-read --allow-run=git --allow-write=<path> scripts/build-release-manifest.ts [--output <path>]',
    );
    Deno.exit(2);
  }
  return value;
}

async function collectPackageManifest(): Promise<JsonValue> {
  const rootConfig = await readJson<DenoConfig>('deno.json');
  const workspace = rootConfig.workspace ?? [];
  const packages = [];

  for (const workspacePath of workspace) {
    const configPath = `${workspacePath.replace(/\/$/, '')}/deno.json`;
    const config = await readJson<DenoConfig>(configPath);
    packages.push({
      path: workspacePath,
      config: configPath,
      name: config.name ?? null,
      version: config.version ?? null,
      exports: config.exports ?? null,
      tasks: Object.keys(config.tasks ?? {}).sort(),
    });
  }

  return {
    root,
    config: 'deno.json',
    name: rootConfig.name ?? null,
    version: rootConfig.version ?? null,
    tasks: Object.keys(rootConfig.tasks ?? {}).sort(),
    workspace,
    packages,
  };
}

async function collectGitInfo(): Promise<JsonValue> {
  const commit = await git(['rev-parse', 'HEAD']);
  const shortCommit = await git(['rev-parse', '--short', 'HEAD']);
  const branch = await git(['branch', '--show-current']);
  const describe = await git(['describe', '--tags', '--always', '--dirty']);
  const status = await git(['status', '--short']);

  if (!commit && !shortCommit && !branch && !describe && status === null) {
    return { available: false };
  }

  return {
    available: true,
    branch: emptyToNull(branch),
    commit: emptyToNull(commit),
    shortCommit: emptyToNull(shortCommit),
    describe: emptyToNull(describe),
    dirty: status === null ? null : status.length > 0,
  };
}

function validationCommands(): CommandManifest[] {
  return [
    { name: 'check', command: ['deno', 'task', 'check'] },
    {
      name: 'validate-agent-docs',
      command: ['deno', 'task', 'validate:agent-docs'],
    },
    {
      name: 'validate-architecture',
      command: ['deno', 'task', 'validate:architecture'],
    },
    {
      name: 'docs:build',
      command: ['deno', 'task', 'docs:build'],
    },
    {
      name: 'process-role-validator',
      command: [
        'deno',
        'run',
        '--config',
        'deno.json',
        '--allow-read',
        'scripts/validate-process-roles.ts',
      ],
    },
    {
      name: 'validate-helm',
      command: ['deno', 'task', 'validate:helm'],
    },
    {
      name: 'release-gate',
      command: [
        'deno',
        'run',
        '--config',
        'deno.json',
        '--allow-run=deno',
        '--allow-env',
        'scripts/release-gate.ts',
        '--keep-going',
      ],
    },
    {
      name: 'release-manifest',
      command: [
        'deno',
        'run',
        '--config',
        'deno.json',
        '--allow-read',
        '--allow-run=git',
        'scripts/build-release-manifest.ts',
      ],
    },
  ];
}

function assertRequiredValidationCommands(
  commands: readonly CommandManifest[],
) {
  const byName = new Map(commands.map((command) => [command.name, command]));
  const required: Record<string, readonly string[]> = {
    'validate-agent-docs': ['deno', 'task', 'validate:agent-docs'],
    'validate-architecture': ['deno', 'task', 'validate:architecture'],
    'validate-helm': ['deno', 'task', 'validate:helm'],
    'docs:build': ['deno', 'task', 'docs:build'],
  };
  const errors: string[] = [];

  for (const [name, expectedCommand] of Object.entries(required)) {
    const actual = byName.get(name);
    if (!actual) {
      errors.push(`release manifest validationCommands missing ${name}`);
      continue;
    }
    if (!stringArraysEqual(actual.command, expectedCommand)) {
      errors.push(
        `release manifest validationCommands.${name} must be ${expectedCommand.join(' ')}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    Deno.exit(1);
  }
}

async function collectDistributionManifests(): Promise<JsonValue> {
  const dir = 'deploy/distributions';
  const manifests: Array<Record<string, JsonValue>> = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const path = `${dir}/${entry.name}`;
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const target = asRecord(parsed.target);
      const routing = asRecord(parsed.routing);
      const providerProfile = asRecord(parsed.providerProfile);
      const providerProof = asRecord(parsed.providerProof);
      manifests.push({
        path,
        digest: await sha256(text),
        targetId: jsonString(target?.id),
        environment: jsonString(parsed.environment),
        profile: jsonString(parsed.profile),
        providerProfile: providerProfile
          ? {
            bundle: jsonString(providerProfile.bundle),
            profileId: jsonString(providerProfile.profileId),
            pluginIds: jsonStringArray(providerProfile.pluginIds),
          }
          : null,
        services: Array.isArray(parsed.services)
          ? parsed.services.map((service) => {
            const record = asRecord(service);
            return record
              ? {
                serviceId: jsonString(record.serviceId),
                runtime: jsonString(record.runtime),
                hostingTargetId: jsonString(record.hostingTargetId),
                hasSmoke: asRecord(record.smoke) !== null,
                artifact: jsonString(record.image) ??
                  jsonString(record.artifactRef),
              }
              : null;
          })
          : [],
        routing: routing
          ? {
            publicBaseUrl: jsonString(routing.publicBaseUrl),
            adminBaseUrl: jsonString(routing.adminBaseUrl),
            dnsProvider: jsonString(routing.dnsProvider),
          }
          : null,
        providerProof: providerProof
          ? {
            readOnlySmokeTask: jsonString(providerProof.readOnlySmokeTask),
            provisioningSmokeTask: jsonString(
              providerProof.provisioningSmokeTask,
            ),
            cleanupTask: jsonString(providerProof.cleanupTask),
            fixturePath: jsonString(providerProof.fixturePath),
          }
          : null,
      });
    }
  } catch {
    return { available: false, manifests: [] };
  }
  return {
    available: true,
    manifests: manifests.sort((a, b) => String(a.targetId).localeCompare(String(b.targetId))),
  };
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((item, index) => item === right[index]);
}

async function collectProcessRoles(): Promise<JsonValue> {
  const expected = [
    'takosumi-api',
    'takosumi-worker',
    'takosumi-router',
    'takosumi-runtime-agent',
    'takosumi-log-worker',
  ];
  const targets: string[] = [];
  const helmDir = 'deploy/helm/takos/templates';

  try {
    for await (const entry of Deno.readDir(helmDir)) {
      if (entry.isFile && /\.(ya?ml|tpl|txt)$/.test(entry.name)) {
        targets.push(`${helmDir}/${entry.name}`);
      }
    }
  } catch {
    // Helm templates are optional for manifest generation.
  }

  const observations: Array<{
    role: string;
    kind: 'label' | 'env';
    file: string;
    line: number;
  }> = [];

  for (const file of targets.sort()) {
    const text = await readTextIfExists(file);
    if (text === null) continue;
    observations.push(...collectRoleObservations(file, text));
  }

  const observed = [...new Set(observations.map((entry) => entry.role))].sort();
  return { expected, observed, observations };
}

function collectRoleObservations(
  file: string,
  text: string,
): Array<{ role: string; kind: 'label' | 'env'; file: string; line: number }> {
  const observations: Array<{
    role: string;
    kind: 'label' | 'env';
    file: string;
    line: number;
  }> = [];
  const patterns: Array<['label' | 'env', RegExp]> = [
    ['label', /takos\.io\/process-role:\s*([^\n]+)/g],
    ['env', /TAKOSUMI_PROCESS_ROLE:\s*([^\n]+)/g],
    ['env', /-\s+name:\s*TAKOSUMI_PROCESS_ROLE\s*\n\s+value:\s*([^\n]+)/g],
  ];

  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      observations.push({
        role: unquote(stripInlineComment(match[1])),
        kind,
        file,
        line: lineOf(text, match.index ?? 0),
      });
    }
  }
  return observations.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line ||
    a.kind.localeCompare(b.kind)
  );
}

async function collectDomainDirs(): Promise<JsonValue> {
  const domainRoot = '../takosumi/packages/kernel/src/domains';
  const dirs: Array<{ name: string; path: string; files: string[] }> = [];

  try {
    for await (const entry of Deno.readDir(domainRoot)) {
      if (!entry.isDirectory) continue;
      const path = `${domainRoot}/${entry.name}`;
      dirs.push({
        name: entry.name,
        path,
        files: await listRelativeFiles(path),
      });
    }
  } catch {
    return { available: false, root: domainRoot, dirs: [] };
  }

  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

async function collectSmokeScripts(): Promise<JsonValue> {
  const kernelSmokeScripts = new Set([
    'local-smoke.mjs',
  ]);
  const knownEnv: Record<string, Record<string, string>> = {};
  const knownCommands: Record<string, string[]> = {
    'local-smoke.mjs': ['node', 'scripts/local-smoke.mjs'],
  };
  const scripts: Array<CommandManifest & { path: string }> = [];

  for await (const entry of Deno.readDir('scripts')) {
    if (!entry.isFile) continue;
    if (!/(smoke|e2e).*\.(ts|mjs)$/.test(entry.name)) continue;
    if (!kernelSmokeScripts.has(entry.name)) continue;
    const path = `scripts/${entry.name}`;
    const command = knownCommands[entry.name] ??
      (entry.name.endsWith('.ts') ? ['deno', 'run', '--config', 'deno.json', '--allow-read', path] : ['node', path]);
    scripts.push({
      name: entry.name.replace(/\.(ts|mjs)$/, ''),
      path,
      command,
      ...(knownEnv[entry.name] ? { env: knownEnv[entry.name] } : {}),
    });
  }

  return scripts.sort((a, b) => a.path.localeCompare(b.path));
}

async function git(args: string[]): Promise<string | null> {
  try {
    const output = await new Deno.Command('git', {
      args,
      stdout: 'piped',
      stderr: 'null',
    }).output();
    if (!output.success) return null;
    return new TextDecoder().decode(output.stdout).trim();
  } catch {
    return null;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

async function listRelativeFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isFile) files.push(path);
  }
  return files.sort();
}

function emptyToNull(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function stripInlineComment(value: string): string {
  const quote = value.trimStart()[0];
  if (quote === '"' || quote === "'") return value.trim();
  return value.replace(/\s+#.*$/, '').trim();
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return `sha256:${
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
