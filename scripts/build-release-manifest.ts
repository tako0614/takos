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
  takosRelease?: {
    name?: string;
    version?: string;
  };
  workspace?: string[];
  exports?: Record<string, string> | string;
  tasks?: Record<string, string>;
};

type CargoPackageConfig = {
  name?: string;
  version?: string;
  publish?: boolean | string[];
  license?: string;
};

type CommandManifest = {
  name: string;
  command: string[];
  env?: Record<string, string>;
};

type ReleaseComponentConfig = {
  id: string;
  path: string;
  kind: 'deno' | 'cargo';
  expectedName: string;
};

type BuildReleaseManifestOptions = {
  output: string | null;
  imageDigestDir: string;
  releaseVersion: string | null;
  releaseTag: string | null;
  requireImageDigests: boolean;
  requireCleanGit: boolean;
};

type ReleaseIdentity = {
  name: string | null;
  version: string | null;
  tag: string | null;
  requestedVersion: string | null;
  requestedTag: string | null;
};

type GitInfo = {
  available: boolean;
  branch?: string | null;
  commit?: string | null;
  shortCommit?: string | null;
  describe?: string | null;
  dirty?: boolean | null;
};

type SubmodulePointer = {
  path: string;
  commit: string;
  state: 'recorded' | 'uninitialized' | 'checkout-differs' | 'conflict' | 'unknown';
  prefix: string;
  description: string | null;
};

type SubmoduleSummary = {
  available: boolean;
  clean?: boolean;
  count?: number;
  states?: Record<string, number>;
  pointers: SubmodulePointer[];
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

const RELEASE_COMPONENT_CONFIGS: readonly ReleaseComponentConfig[] = [
  { id: 'takos-shell', path: 'deno.json', kind: 'deno', expectedName: 'takos' },
  { id: 'takos-app', path: 'app/deno.json', kind: 'deno', expectedName: 'takos-app' },
  { id: 'takos-git', path: 'git/deno.json', kind: 'deno', expectedName: 'takos-git' },
  { id: 'takos-agent', path: 'agent/Cargo.toml', kind: 'cargo', expectedName: 'takos-agent' },
];

const root = Deno.cwd();
const options = parseArgs(Deno.args);
const commands = validationCommands();
assertRequiredValidationCommands(commands);
const gitInfo = await collectGitInfo();
const submodules = await collectSubmodulePointers();
assertCleanGitState(gitInfo, submodules, options);
const release = await collectReleaseIdentity(options);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  release,
  package: await collectPackageManifest(),
  releaseComponents: await collectReleaseComponents(),
  git: gitInfo,
  submodules,
  validationCommands: commands,
  officialImages: await collectOfficialImages(gitInfo, options, release),
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
    releaseVersion: null,
    releaseTag: null,
    requireImageDigests: false,
    requireCleanGit: false,
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
    if (flag === '--release-version') {
      const value = args[++index];
      if (!value) usage();
      options.releaseVersion = value;
      continue;
    }
    if (flag === '--release-tag') {
      const value = args[++index];
      if (!value) usage();
      options.releaseTag = value;
      continue;
    }
    if (flag === '--require-image-digests') {
      options.requireImageDigests = true;
      continue;
    }
    if (flag === '--require-clean-git') {
      options.requireCleanGit = true;
      continue;
    }
    usage();
  }

  return options;
}

function usage(): never {
  console.error(
    'Usage: deno run --config deno.json --allow-read --allow-run=git --allow-write=<path> scripts/build-release-manifest.ts [--output <path>] [--image-digest-dir <path>] [--release-version <semver>] [--release-tag <vsemver>] [--require-image-digests] [--require-clean-git]',
  );
  Deno.exit(2);
}

async function collectReleaseIdentity(
  options: BuildReleaseManifestOptions,
): Promise<ReleaseIdentity> {
  const rootConfig = await readJson<DenoConfig>('deno.json');
  const metadata = denoReleaseMetadata(rootConfig);
  const errors: string[] = [];
  const version = metadata.version ?? null;
  const canonicalTag = version ? `v${version}` : null;

  if (!metadata.name) {
    errors.push('release root package name is required');
  }
  if (!version || !isSemver(version)) {
    errors.push('release root package version must be a semver string');
  }
  if (
    options.releaseVersion !== null &&
    (!isSemver(options.releaseVersion) || options.releaseVersion !== version)
  ) {
    errors.push(
      `--release-version must match deno.json takosRelease.version (${version ?? '<missing>'})`,
    );
  }
  if (options.releaseTag !== null) {
    const tagVersion = releaseVersionFromTag(options.releaseTag);
    if (tagVersion === null) {
      errors.push('--release-tag must use v<semver>');
    } else if (tagVersion !== version) {
      errors.push(
        `--release-tag must match deno.json takosRelease.version (${version ?? '<missing>'})`,
      );
    }
    if (options.releaseVersion !== null && tagVersion !== null && tagVersion !== options.releaseVersion) {
      errors.push('--release-tag must match --release-version');
    }
  }

  if (errors.length > 0) {
    console.error('Release identity validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    Deno.exit(1);
  }

  return {
    name: metadata.name ?? null,
    version,
    tag: canonicalTag,
    requestedVersion: options.releaseVersion,
    requestedTag: options.releaseTag,
  };
}

async function collectPackageManifest(): Promise<JsonValue> {
  const rootConfig = await readJson<DenoConfig>('deno.json');
  const workspace = rootConfig.workspace ?? [];
  const rootReleaseMetadata = denoReleaseMetadata(rootConfig);
  const packages = [];

  for (const workspacePath of workspace) {
    const configPath = `${workspacePath.replace(/\/$/, '')}/deno.json`;
    const config = await readJson<DenoConfig>(configPath);
    const releaseMetadata = denoReleaseMetadata(config);
    packages.push({
      path: workspacePath,
      config: configPath,
      name: releaseMetadata.name ?? null,
      version: releaseMetadata.version ?? null,
      exports: config.exports ?? null,
      tasks: Object.keys(config.tasks ?? {}).sort(),
    });
  }

  return {
    root,
    config: 'deno.json',
    name: rootReleaseMetadata.name ?? null,
    version: rootReleaseMetadata.version ?? null,
    tasks: Object.keys(rootConfig.tasks ?? {}).sort(),
    workspace,
    packages,
  };
}

async function collectReleaseComponents(): Promise<JsonValue> {
  const components = [];
  const errors: string[] = [];
  for (const component of RELEASE_COMPONENT_CONFIGS) {
    if (component.kind === 'deno') {
      const config = await readJson<DenoConfig>(component.path);
      const releaseMetadata = denoReleaseMetadata(config);
      validateReleaseComponentMetadata(component, releaseMetadata.name, releaseMetadata.version, errors);
      components.push({
        id: component.id,
        kind: component.kind,
        config: component.path,
        name: releaseMetadata.name ?? null,
        version: releaseMetadata.version ?? null,
        workspaceCount: config.workspace?.length ?? 0,
        taskCount: Object.keys(config.tasks ?? {}).length,
      });
      continue;
    }

    const cargoPackage = await readCargoPackage(component.path);
    validateReleaseComponentMetadata(component, cargoPackage.name, cargoPackage.version, errors);
    components.push({
      id: component.id,
      kind: component.kind,
      config: component.path,
      name: cargoPackage.name ?? null,
      version: cargoPackage.version ?? null,
      publish: cargoPackage.publish ?? null,
      license: cargoPackage.license ?? null,
    });
  }

  if (errors.length > 0) {
    console.error('Release component metadata validation failed:');
    for (const error of errors) console.error(`- ${error}`);
    Deno.exit(1);
  }

  return {
    configs: RELEASE_COMPONENT_CONFIGS.map((component) => component.path),
    components,
  };
}

function denoReleaseMetadata(config: DenoConfig): { name?: string; version?: string } {
  return {
    name: config.takosRelease?.name ?? config.name,
    version: config.takosRelease?.version ?? config.version,
  };
}

function validateReleaseComponentMetadata(
  component: ReleaseComponentConfig,
  name: string | undefined,
  version: string | undefined,
  errors: string[],
): void {
  if (name !== component.expectedName) {
    errors.push(`${component.id}: ${component.path} name must be ${component.expectedName}`);
  }
  if (!version || !isSemver(version)) {
    errors.push(`${component.id}: ${component.path} version must be a semver string`);
  }
}

function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

function releaseVersionFromTag(tag: string): string | null {
  if (!tag.startsWith('v')) return null;
  const version = tag.slice(1);
  return isSemver(version) ? version : null;
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

async function collectSubmodulePointers(): Promise<SubmoduleSummary> {
  const status = await git(['submodule', 'status', '--recursive']);
  if (status === null) {
    return { available: false, pointers: [] };
  }

  const pointers = status.split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(parseSubmoduleStatusLine);
  const states = pointers.reduce<Record<string, number>>((counts, pointer) => {
    counts[pointer.state] = (counts[pointer.state] ?? 0) + 1;
    return counts;
  }, {});

  return {
    available: true,
    clean: pointers.every((pointer) => pointer.state === 'recorded'),
    count: pointers.length,
    states,
    pointers,
  };
}

function assertCleanGitState(
  gitInfo: GitInfo,
  submodules: SubmoduleSummary,
  options: BuildReleaseManifestOptions,
): void {
  if (!options.requireCleanGit) return;

  const errors: string[] = [];
  if (!gitInfo.available) {
    errors.push('git metadata must be available');
  } else if (gitInfo.dirty !== false) {
    errors.push('git working tree must be clean');
  }

  if (!submodules.available) {
    errors.push('submodule status must be available');
  } else if (submodules.clean !== true) {
    const dirtySubmodules = submodules.pointers
      .filter((pointer) => pointer.state !== 'recorded')
      .map((pointer) => `${pointer.path}:${pointer.state}`);
    errors.push(
      `submodules must match recorded commits${dirtySubmodules.length > 0 ? ` (${dirtySubmodules.join(', ')})` : ''}`,
    );
  }

  if (errors.length === 0) return;

  console.error('Release manifest clean git validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  Deno.exit(1);
}

function parseSubmoduleStatusLine(line: string): SubmodulePointer {
  const match = /^([ +-U]?)([0-9a-f]{40})\s+(\S+)(?:\s+\(([^)]*)\))?$/.exec(line);
  if (!match) {
    return {
      path: line,
      commit: '',
      state: 'unknown',
      prefix: '',
      description: null,
    };
  }

  const prefix = match[1] || ' ';
  return {
    path: match[3],
    commit: match[2],
    state: submoduleState(prefix),
    prefix,
    description: match[4] ?? null,
  };
}

function submoduleState(prefix: string): SubmodulePointer['state'] {
  switch (prefix) {
    case ' ':
      return 'recorded';
    case '-':
      return 'uninitialized';
    case '+':
      return 'checkout-differs';
    case 'U':
      return 'conflict';
    default:
      return 'unknown';
  }
}

async function collectOfficialImages(
  gitInfo: GitInfo,
  options: BuildReleaseManifestOptions,
  release: ReleaseIdentity,
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
        release.version,
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
  releaseVersion: string | null,
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
  const tags = Array.isArray(record.tags) ? record.tags : [];
  if (tags.length === 0) {
    errors.push(`${name}: tags must include semver and sha-* references`);
  } else {
    const expectedVersionTag = releaseVersion ? `${repository}:${releaseVersion}` : null;
    if (expectedVersionTag && !tags.includes(expectedVersionTag)) {
      errors.push(`${name}: tags must include ${expectedVersionTag}`);
    }
    if (!tags.some((tag) => tag.startsWith(`${repository}:sha-`))) {
      errors.push(`${name}: tags must include ${repository}:sha-*`);
    }
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

async function readCargoPackage(path: string): Promise<CargoPackageConfig> {
  const text = await Deno.readTextFile(path);
  const packageSection = cargoSection(text, 'package');
  return {
    name: cargoString(packageSection.name),
    version: cargoString(packageSection.version),
    publish: cargoBoolean(packageSection.publish) ?? cargoStringArray(packageSection.publish),
    license: cargoString(packageSection.license),
  };
}

function cargoSection(text: string, sectionName: string): Record<string, string> {
  const values: Record<string, string> = {};
  let inSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) {
      inSection = heading[1] === sectionName;
      continue;
    }
    if (!inSection) continue;
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!assignment) continue;
    values[assignment[1]] = assignment[2].trim();
  }
  return values;
}

function cargoString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^"([^"]*)"$/.exec(value);
  return match?.[1];
}

function cargoBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function cargoStringArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const match = /^\[(.*)\]$/.exec(value);
  if (!match) return undefined;
  return match[1].split(',')
    .map((item) => cargoString(item.trim()))
    .filter((item): item is string => item !== undefined);
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
