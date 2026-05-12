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

type BuildReleaseManifestOptions = {
  output: string | null;
  imageDigestDir: string;
  requireImageDigests: boolean;
};

type GitInfo = {
  available: boolean;
  branch?: string | null;
  commit?: string | null;
  shortCommit?: string | null;
  describe?: string | null;
  dirty?: boolean | null;
};

type OfficialImage = {
  name: string;
  context: string;
  dockerfile: string;
};

type ImageDigestRecord = {
  name?: string;
  image?: string;
  digest?: string;
  digestRef?: string;
  tags?: string[];
  commit?: string;
  workflowRun?: string;
  sbom?: boolean;
  provenance?: boolean;
};

const OFFICIAL_TAKOS_IMAGES: readonly OfficialImage[] = [
  {
    name: 'takos-app',
    context: '.',
    dockerfile: 'deploy/docker/takos-app.Dockerfile',
  },
  {
    name: 'takos-git',
    context: 'git',
    dockerfile: 'git/Dockerfile',
  },
  {
    name: 'takos-agent',
    context: 'agent',
    dockerfile: 'agent/Dockerfile',
  },
];

const root = Deno.cwd();
const options = parseArgs(Deno.args);
const commands = validationCommands();
assertRequiredValidationCommands(commands);
const gitInfo = await collectGitInfo();

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  package: await collectPackageManifest(),
  git: gitInfo,
  validationCommands: commands,
  officialImages: await collectOfficialImages(gitInfo, options),
  distributionContract: await collectDistributionContract(),
  distributions: await collectDistributionManifests(),
  serviceSet: await collectServiceSet(),
  domainDirs: await collectDomainDirs(),
  smokeScripts: await collectSmokeScripts(),
};

const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (options.output) {
  await Deno.writeTextFile(options.output, json);
} else {
  console.log(json.trimEnd());
}

function parseArgs(args: string[]): BuildReleaseManifestOptions {
  const options: BuildReleaseManifestOptions = {
    output: null,
    imageDigestDir: 'dist/image-digests',
    requireImageDigests: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--output') {
      const value = args[++index];
      if (!value) usage();
      options.output = value;
      continue;
    }
    if (flag === '--image-digest-dir') {
      const value = args[++index];
      if (!value) usage();
      options.imageDigestDir = value;
      continue;
    }
    if (flag === '--require-image-digests') {
      options.requireImageDigests = true;
      continue;
    }
    usage();
  }

  return options;
}

function usage(): never {
  console.error(
    'Usage: deno run --config deno.json --allow-read --allow-run=git --allow-write=<path> scripts/build-release-manifest.ts [--output <path>] [--image-digest-dir <path>] [--require-image-digests]',
  );
  Deno.exit(2);
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

async function collectGitInfo(): Promise<GitInfo> {
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

async function collectOfficialImages(
  gitInfo: GitInfo,
  options: BuildReleaseManifestOptions,
): Promise<JsonValue> {
  const owner = await collectGitHubOwner();
  const digestRecords = await collectImageDigestRecords(options.imageDigestDir);
  const errors: string[] = [];
  const images = OFFICIAL_TAKOS_IMAGES.map((image) => {
    const repository = `ghcr.io/${owner}/${image.name}`;
    const record = digestRecords.get(image.name);
    const digest = record?.record.digest ?? null;
    const digestRef = digest ? `${repository}@${digest}` : null;

    if (!record) {
      errors.push(`${image.name}: missing image digest metadata`);
    } else {
      validateImageDigestRecord(
        image.name,
        repository,
        record.record,
        gitInfo,
        errors,
      );
    }

    return {
      ...image,
      repository,
      commitPin: gitInfo.commit ?? null,
      tagPolicy: ['semver', `sha-${gitInfo.shortCommit ?? '<commit>'}`],
      digest,
      digestRef,
      tags: record?.record.tags ?? [],
      sbom: {
        required: true,
        attached: record?.record.sbom ?? null,
      },
      provenance: {
        required: true,
        attached: record?.record.provenance ?? null,
      },
      evidence: record
        ? {
          path: record.path,
          expectedPath: null,
          workflowRun: record.record.workflowRun ?? null,
        }
        : {
          path: null,
          expectedPath: `${options.imageDigestDir}/${image.name}.json`,
          workflowRun: null,
        },
    };
  });

  if (options.requireImageDigests && errors.length > 0) {
    console.error('Release manifest image digest validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    Deno.exit(1);
  }

  return {
    required: OFFICIAL_TAKOS_IMAGES.map((image) => image.name),
    imageDigestDir: options.imageDigestDir,
    requireImageDigests: options.requireImageDigests,
    complete: errors.length === 0,
    errors,
    images,
  };
}

async function collectImageDigestRecords(
  dir: string,
): Promise<Map<string, { path: string; record: ImageDigestRecord }>> {
  const records = new Map<string, { path: string; record: ImageDigestRecord }>();

  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const path = `${dir}/${entry.name}`;
      const parsed = await readJson<ImageDigestRecord>(path);
      const name = parsed.name ?? entry.name.replace(/\.json$/, '');
      records.set(name, { path, record: parsed });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return records;
    throw error;
  }

  return records;
}

function validateImageDigestRecord(
  name: string,
  repository: string,
  record: ImageDigestRecord,
  gitInfo: GitInfo,
  errors: string[],
): void {
  if (record.image !== repository) {
    errors.push(`${name}: image must be ${repository}`);
  }
  if (!record.digest || !/^sha256:[a-f0-9]{64}$/.test(record.digest)) {
    errors.push(`${name}: digest must be a sha256 image digest`);
  }
  if (record.digestRef !== `${repository}@${record.digest}`) {
    errors.push(`${name}: digestRef must pin ${repository}@${record.digest}`);
  }
  if (!Array.isArray(record.tags) || record.tags.length === 0) {
    errors.push(`${name}: tags must include semver and sha-* references`);
  }
  if (gitInfo.commit && record.commit !== gitInfo.commit) {
    errors.push(`${name}: commit must match ${gitInfo.commit}`);
  }
  if (record.sbom !== true) {
    errors.push(`${name}: SBOM attestation must be recorded`);
  }
  if (record.provenance !== true) {
    errors.push(`${name}: provenance attestation must be recorded`);
  }
}

async function collectGitHubOwner(): Promise<string> {
  const remote = await git(['config', '--get', 'remote.origin.url']);
  return parseGitHubOwner(remote) ?? '<owner>';
}

function parseGitHubOwner(remote: string | null): string | null {
  if (!remote) return null;
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\//.exec(remote);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = /^git@github\.com:([^/]+)\//.exec(remote);
  if (sshMatch) return sshMatch[1];
  return null;
}

function validationCommands(): CommandManifest[] {
  return [
    { name: 'check', command: ['deno', 'task', 'check'] },
    {
      name: 'lint:agent-docs',
      command: ['deno', 'task', 'lint:agent-docs'],
    },
    {
      name: 'validate-architecture',
      command: ['deno', 'task', 'validate:architecture'],
    },
    {
      name: 'lint:docs',
      command: ['deno', 'task', 'lint:docs'],
    },
    {
      name: 'service-set-validator',
      command: [
        'deno',
        'task',
        'validate:service-set',
      ],
    },
    {
      name: 'validate-distributions',
      command: ['deno', 'task', 'validate:distributions'],
    },
    {
      name: 'validate-helm',
      command: ['deno', 'task', 'validate:helm'],
    },
    {
      name: 'helm-overlay-generator',
      command: ['deno', 'task', 'helm:check-overlays'],
    },
    {
      name: 'terraform-helm-values',
      command: ['deno', 'task', 'terraform:helm-values:check'],
    },
    {
      name: 'terraform-plan-gate',
      command: ['deno', 'task', 'terraform:plan-gate'],
    },
    {
      name: 'terraform-secret-policy',
      command: ['deno', 'task', 'validate:terraform-secrets'],
    },
    {
      name: 'validate-release-promotion',
      command: ['deno', 'task', 'validate:release-promotion'],
    },
    {
      name: 'helm-template-smoke',
      command: ['deno', 'task', 'helm:template-smoke'],
      env: {
        TAKOS_HELM_REQUIRE_INSTALL_DRY_RUN: '1',
        TAKOS_HELM_INSTALL_TEST_CRDS: '1',
      },
    },
    {
      name: 'helm-install-smoke',
      command: ['deno', 'task', 'helm:install-smoke'],
      env: {
        TAKOS_HELM_INSTALL_TEST_CRDS: '1',
      },
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
    'lint:agent-docs': ['deno', 'task', 'lint:agent-docs'],
    'validate-architecture': ['deno', 'task', 'validate:architecture'],
    'validate-distributions': ['deno', 'task', 'validate:distributions'],
    'service-set-validator': ['deno', 'task', 'validate:service-set'],
    'validate-helm': ['deno', 'task', 'validate:helm'],
    'helm-overlay-generator': ['deno', 'task', 'helm:check-overlays'],
    'terraform-helm-values': ['deno', 'task', 'terraform:helm-values:check'],
    'terraform-plan-gate': ['deno', 'task', 'terraform:plan-gate'],
    'terraform-secret-policy': ['deno', 'task', 'validate:terraform-secrets'],
    'validate-release-promotion': [
      'deno',
      'task',
      'validate:release-promotion',
    ],
    'helm-template-smoke': ['deno', 'task', 'helm:template-smoke'],
    'helm-install-smoke': ['deno', 'task', 'helm:install-smoke'],
    'lint:docs': ['deno', 'task', 'lint:docs'],
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

async function collectDistributionContract(): Promise<JsonValue> {
  const path = 'deploy/distribution-contract/takos-distribution-profile-v1.schema.json';
  try {
    const text = await Deno.readTextFile(path);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const properties = asRecord(parsed.properties);
    const apiVersion = asRecord(properties?.apiVersion);
    const kind = asRecord(properties?.kind);
    return {
      available: true,
      path,
      digest: await sha256(text),
      schema: jsonString(parsed.$schema),
      id: jsonString(parsed.$id),
      title: jsonString(parsed.title),
      apiVersion: jsonString(apiVersion?.const),
      kind: jsonString(kind?.const),
    };
  } catch {
    return { available: false, path };
  }
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((item, index) => item === right[index]);
}

async function collectServiceSet(): Promise<JsonValue> {
  const expected = [
    'takos-app',
    'takosumi',
    'takos-git',
    'takos-agent',
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
    serviceId: string;
    kind: 'label';
    file: string;
    line: number;
  }> = [];

  for (const file of targets.sort()) {
    const text = await readTextIfExists(file);
    if (text === null) continue;
    observations.push(...collectServiceObservations(file, text));
  }

  const observed = [...new Set(observations.map((entry) => entry.serviceId))]
    .sort();
  return { expected, observed, observations };
}

function collectServiceObservations(
  file: string,
  text: string,
): Array<{ serviceId: string; kind: 'label'; file: string; line: number }> {
  const observations: Array<{
    serviceId: string;
    kind: 'label';
    file: string;
    line: number;
  }> = [];
  const pattern = /takos\.io\/service-id:\s*([^\n]+)/g;

  for (const match of text.matchAll(pattern)) {
    observations.push({
      serviceId: unquote(stripInlineComment(match[1])),
      kind: 'label',
      file,
      line: lineOf(text, match.index ?? 0),
    });
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
