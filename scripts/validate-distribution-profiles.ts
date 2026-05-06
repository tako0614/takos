import { basename, join, normalize, relative, resolve } from 'node:path';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, unknown>;

const takosRoot = Deno.cwd();
const ecosystemRoot = resolve(takosRoot, '..');
const distributionDir = 'deploy/distributions';
const distributionProfileSchemaPath = 'deploy/distribution-contract/takos-distribution-profile-v1.schema.json';
const expectedTargets = [
  'aws',
  'cloudflare',
  'gcp',
  'kubernetes',
  'selfhosted',
] as const;
const expectedServices = [
  'takos-agent',
  'takos-app',
  'takos-git',
  'takosumi',
] as const;
type ExpectedTargetId = typeof expectedTargets[number];
type ExpectedServiceId = typeof expectedServices[number];
type ExpectedArtifact = { kind: string; ref: string };
type ExpectedBinding = { kind: string; name: string };
type ExpectedServiceSpec = {
  runtime: string;
  artifactField: 'image' | 'artifactRef';
  artifact: string;
  internalUrl: string;
  publicUrl?: string;
};
const expectedArtifacts: Record<ExpectedTargetId, readonly ExpectedArtifact[]> = {
  aws: [
    { kind: 'terraform', ref: 'deploy/terraform/environments/aws-prod' },
    { kind: 'helm', ref: 'deploy/helm/takos/values-aws.yaml' },
  ],
  cloudflare: [
    { kind: 'wrangler', ref: '../takosumi/deploy/cloudflare/wrangler.toml' },
    { kind: 'operator', ref: '../takosumi/deploy/cloudflare' },
  ],
  gcp: [
    { kind: 'terraform', ref: 'deploy/terraform/environments/gcp-prod' },
    { kind: 'helm', ref: 'deploy/helm/takos/values-gcp.yaml' },
  ],
  kubernetes: [
    { kind: 'helm', ref: 'deploy/helm/takos' },
  ],
  selfhosted: [
    { kind: 'compose', ref: '../takos-private/compose.server.yml' },
  ],
};
const expectedRequiredBindings: Record<ExpectedTargetId, readonly ExpectedBinding[]> = {
  aws: [
    { kind: 'aws-iam-role', name: 'takos-provider' },
    { kind: 'aws-vpc', name: 'takos-vpc' },
  ],
  cloudflare: [
    { kind: 'cloudflare-d1', name: 'TAKOS_DB' },
    { kind: 'cloudflare-r2', name: 'TAKOS_OBJECTS' },
    { kind: 'cloudflare-queue', name: 'TAKOS_QUEUE' },
    { kind: 'cloudflare-durable-object', name: 'TAKOS_COORDINATION' },
  ],
  gcp: [
    { kind: 'gcp-service-account', name: 'takos-provider' },
    { kind: 'gcp-vpc', name: 'takos-vpc' },
  ],
  kubernetes: [
    { kind: 'kubernetes-namespace', name: 'takos-system' },
    { kind: 'kubernetes-ingress-class', name: 'nginx' },
  ],
  selfhosted: [
    { kind: 'container-engine', name: 'docker-or-podman' },
    { kind: 'reverse-proxy', name: 'caddy' },
  ],
};
const expectedServiceSpecs: Record<ExpectedTargetId, Record<ExpectedServiceId, ExpectedServiceSpec>> = {
  aws: kubernetesLikeServiceSpecs('container'),
  cloudflare: {
    'takos-app': {
      runtime: 'worker',
      artifactField: 'artifactRef',
      artifact: 'worker:takos-app',
      internalUrl: 'https://takos-app.internal.takos.example',
      publicUrl: 'https://admin.takos.example.com',
    },
    takosumi: {
      runtime: 'worker',
      artifactField: 'artifactRef',
      artifact: 'worker:takosumi',
      internalUrl: 'https://takosumi.internal.takos.example',
    },
    'takos-git': {
      runtime: 'container',
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-git:latest',
      internalUrl: 'https://takos-git.internal.takos.example',
    },
    'takos-agent': {
      runtime: 'container',
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-agent:latest',
      internalUrl: 'https://takos-agent.internal.takos.example',
    },
  },
  gcp: kubernetesLikeServiceSpecs('container'),
  kubernetes: kubernetesLikeServiceSpecs('kubernetes-deployment'),
  selfhosted: processServiceSpecs(),
};
const providerTaskName = 'live-provisioning-smoke';

const takosDenoConfig = await readJson(join(takosRoot, 'deno.json'));
const takosumiDenoConfig = await readJson(resolve(takosRoot, '../takosumi/deno.json'));
const distributionProfileSchema = await readJson(resolve(takosRoot, distributionProfileSchemaPath));
const manifestFilter = parseManifestFilter(Deno.args);
const distributionFiles = await distributionManifestFiles(manifestFilter);
const errors: string[] = [];
let checkedArtifacts = 0;
let checkedRequiredBindings = 0;
let checkedServiceSpecs = 0;
let checkedProviderCommands = 0;
let checkedServiceSmokes = 0;

if (distributionFiles.length === 0) {
  errors.push('no distribution manifests matched the requested filter');
}

for (const file of distributionFiles) {
  await validateDistribution(file);
}

if (errors.length > 0) {
  console.error('Distribution profile validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  Deno.exit(1);
}

console.log(JSON.stringify(
  {
    ok: true,
    checkedProfiles: distributionFiles.length,
    checkedArtifacts,
    checkedRequiredBindings,
    checkedServiceSpecs,
    checkedProviderCommands,
    checkedServiceSmokes,
  },
  null,
  2,
));

async function validateDistribution(path: string): Promise<void> {
  const label = path;
  const profile = await readJson(resolve(takosRoot, path));
  validateJsonSchema(profile, distributionProfileSchema, label);
  const targetId = stringAt(recordAt(profile, 'target', label), 'id', `${label}.target`);
  const expectedTarget = requireExpectedTargetId(basename(path, '.json'), `${label} filename target`);
  if (!expectedTarget) return;
  const providerProof = recordAt(profile, 'providerProof', label);
  const metadata = maybeRecord(profile.metadata);

  expectString(profile.apiVersion, 'takosumi.com/hosting/v1', `${label}.apiVersion`);
  expectString(profile.kind, 'TakosDistribution', `${label}.kind`);
  expectString(profile.environment, 'production', `${label}.environment`);
  expectString(targetId, expectedTarget, `${label}.target.id`);

  validateArtifacts(arrayAt(profile, 'artifacts', label), label, expectedTarget);
  validateProviderProof(providerProof, label, expectedTarget);
  validateServices(arrayAt(profile, 'services', label), label, targetId);
  validateRequiredBindings(arrayAt(profile, 'requiredBindings', label), label, expectedTarget);
  validateMetadataCommands(metadata, label);
}

function kubernetesLikeServiceSpecs(
  runtime: string,
): Record<ExpectedServiceId, ExpectedServiceSpec> {
  return {
    'takos-app': {
      runtime,
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-app:latest',
      internalUrl: 'http://takos-app.takos-system.svc.cluster.local:8080',
      publicUrl: 'https://admin.takos.example.com',
    },
    takosumi: {
      runtime,
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takosumi:latest',
      internalUrl: 'http://takosumi.takos-system.svc.cluster.local:8080',
    },
    'takos-git': {
      runtime,
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-git:latest',
      internalUrl: 'http://takos-git.takos-system.svc.cluster.local:8790',
    },
    'takos-agent': {
      runtime,
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-agent:latest',
      internalUrl: 'http://takos-agent.takos-system.svc.cluster.local:8080',
    },
  };
}

function processServiceSpecs(): Record<ExpectedServiceId, ExpectedServiceSpec> {
  return {
    'takos-app': {
      runtime: 'process',
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-app:latest',
      internalUrl: 'http://takos-app:8080',
      publicUrl: 'https://admin.takos.example.internal',
    },
    takosumi: {
      runtime: 'process',
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takosumi:latest',
      internalUrl: 'http://takosumi:8080',
    },
    'takos-git': {
      runtime: 'process',
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-git:latest',
      internalUrl: 'http://takos-git:8790',
    },
    'takos-agent': {
      runtime: 'process',
      artifactField: 'image',
      artifact: 'ghcr.io/takos/takos-agent:latest',
      internalUrl: 'http://takos-agent:8080',
    },
  };
}

function validateArtifacts(
  artifacts: readonly unknown[],
  label: string,
  targetId: ExpectedTargetId,
): void {
  if (artifacts.length === 0) {
    errors.push(`${label}.artifacts must not be empty`);
    return;
  }
  const actual: ExpectedArtifact[] = [];

  artifacts.forEach((artifact, index) => {
    const record = requireRecord(artifact, `${label}.artifacts[${index}]`);
    const kind = stringAt(record, 'kind', `${label}.artifacts[${index}]`);
    const ref = stringAt(record, 'ref', `${label}.artifacts[${index}]`);
    if (!/^[a-z][a-z0-9-]*$/.test(kind)) {
      errors.push(`${label}.artifacts[${index}].kind must be kebab-case`);
    }
    checkedArtifacts += 1;
    assertPathExists(ref, `${label}.artifacts[${index}].ref`);
    if (kind && ref) actual.push({ kind, ref });
  });
  compareArtifacts(actual, expectedArtifacts[targetId], `${label}.artifacts`);
}

function compareArtifacts(
  actual: readonly ExpectedArtifact[],
  expected: readonly ExpectedArtifact[],
  label: string,
): void {
  const actualKeys = actual.map(artifactKey).sort();
  const expectedKeys = expected.map(artifactKey).sort();
  if (actualKeys.join(',') !== expectedKeys.join(',')) {
    errors.push(`${label} must include exactly ${expectedKeys.join(', ')}, got ${actualKeys.join(', ')}`);
  }
}

function artifactKey(artifact: ExpectedArtifact): string {
  return `${artifact.kind}:${artifact.ref}`;
}

function validateProviderProof(
  providerProof: JsonRecord,
  label: string,
  targetId: string,
): void {
  const fixturePath = stringAt(providerProof, 'fixturePath', `${label}.providerProof`);
  const liveEnvPrefix = stringAt(providerProof, 'liveEnvPrefix', `${label}.providerProof`);
  const expectedPrefix = `TAKOSUMI_PLUGIN_${targetId.toUpperCase()}`;
  expectString(liveEnvPrefix, expectedPrefix, `${label}.providerProof.liveEnvPrefix`);
  assertPathExists(fixturePath, `${label}.providerProof.fixturePath`);

  const takosumiFixturePath = pathRelativeToTakosumi(fixturePath);
  validateProviderCommand({
    command: stringAt(providerProof, 'readOnlySmokeTask', `${label}.providerProof`),
    field: `${label}.providerProof.readOnlySmokeTask`,
    targetId,
    fixturePath: takosumiFixturePath,
    mode: 'fixture',
  });
  validateProviderCommand({
    command: stringAt(providerProof, 'provisioningSmokeTask', `${label}.providerProof`),
    field: `${label}.providerProof.provisioningSmokeTask`,
    targetId,
    fixturePath: takosumiFixturePath,
    mode: 'live',
  });
  validateProviderCommand({
    command: stringAt(providerProof, 'cleanupTask', `${label}.providerProof`),
    field: `${label}.providerProof.cleanupTask`,
    targetId,
    fixturePath: takosumiFixturePath,
    mode: 'cleanup',
  });
}

function validateProviderCommand(input: {
  command: string;
  field: string;
  targetId: string;
  fixturePath: string;
  mode: 'fixture' | 'live' | 'cleanup';
}): void {
  const parsed = parseSimpleShellCommand(input.command, input.field);
  if (!parsed) return;

  const cdPath = parsed.cdPath;
  expectString(cdPath, '../takosumi', `${input.field} cd target`);
  assertPathExists(cdPath, `${input.field} cd target`);
  if (parsed.taskName !== providerTaskName) {
    errors.push(`${input.field} must run deno task ${providerTaskName}`);
  }
  assertDenoTask(takosumiDenoConfig, parsed.taskName, input.field);
  expectString(
    parsed.env.TAKOSUMI_PLUGIN_LIVE_PROVIDER,
    input.targetId,
    `${input.field} TAKOSUMI_PLUGIN_LIVE_PROVIDER`,
  );
  expectString(
    parsed.env.TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE,
    input.fixturePath,
    `${input.field} TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE`,
  );
  checkedProviderCommands += 1;

  if (input.mode === 'fixture') {
    if (parsed.env.TAKOSUMI_PLUGIN_LIVE_PROOF_MODE) {
      errors.push(`${input.field} must not force live mode for read-only fixture proof`);
    }
    return;
  }

  expectString(
    parsed.env.TAKOSUMI_PLUGIN_LIVE_PROOF_MODE,
    'live',
    `${input.field} TAKOSUMI_PLUGIN_LIVE_PROOF_MODE`,
  );
  if (input.mode === 'cleanup') {
    expectString(
      parsed.env.TAKOSUMI_PLUGIN_LIVE_CLEANUP_ONLY,
      '1',
      `${input.field} TAKOSUMI_PLUGIN_LIVE_CLEANUP_ONLY`,
    );
  }
}

function validateServices(services: readonly unknown[], label: string, targetId: string): void {
  const expectedTargetId = requireExpectedTargetId(targetId, `${label}.target.id`);
  const expectedSpecs = expectedTargetId ? expectedServiceSpecs[expectedTargetId] : null;
  const serviceIds = services.map((service, index) =>
    stringAt(requireRecord(service, `${label}.services[${index}]`), 'serviceId', `${label}.services[${index}]`)
  ).sort();
  const expected = [...expectedServices].sort();
  if (serviceIds.join(',') !== expected.join(',')) {
    errors.push(`${label}.services must include exactly ${expected.join(', ')}`);
  }

  services.forEach((service, index) => {
    const record = requireRecord(service, `${label}.services[${index}]`);
    const serviceId = stringAt(record, 'serviceId', `${label}.services[${index}]`);
    const expectedServiceId = requireExpectedServiceId(serviceId, `${label}.services[${index}].serviceId`);
    expectString(
      stringAt(record, 'hostingTargetId', `${label}.services[${index}]`),
      targetId,
      `${label}.services[${index}].hostingTargetId`,
    );
    const runtime = stringAt(record, 'runtime', `${label}.services[${index}]`);
    if (!runtime) errors.push(`${label}.services[${index}].runtime must not be empty`);
    if (!isString(record.image) && !isString(record.artifactRef)) {
      errors.push(`${label}.services[${index}] must declare image or artifactRef`);
    }
    if (isString(record.image) && isString(record.artifactRef)) {
      errors.push(`${label}.services[${index}] must declare exactly one of image or artifactRef`);
    }

    if (expectedSpecs && expectedServiceId) {
      validateServiceSpec(record, `${label}.services[${index}]`, expectedSpecs[expectedServiceId]);
    }

    const smoke = recordAt(record, 'smoke', `${label}.services[${index}]`);
    expectString(
      stringAt(smoke, 'healthPath', `${label}.services[${index}].smoke`),
      '/health',
      `${label}.services[${index}].smoke.healthPath`,
    );
    const status = smoke.expectedStatus;
    if (status !== 200) {
      errors.push(`${label}.services[${index}].smoke.expectedStatus must be 200`);
    }
    const expectedJson = recordAt(smoke, 'expectedJson', `${label}.services[${index}].smoke`);
    expectString(
      stringAt(expectedJson, 'service', `${label}.services[${index}].smoke.expectedJson`),
      serviceId,
      `${label}.services[${index}].smoke.expectedJson.service`,
    );
    checkedServiceSmokes += 1;
  });
}

function validateServiceSpec(
  service: JsonRecord,
  label: string,
  expected: ExpectedServiceSpec,
): void {
  expectString(
    stringAt(service, 'runtime', label),
    expected.runtime,
    `${label}.runtime`,
  );
  expectString(
    stringAt(service, expected.artifactField, label),
    expected.artifact,
    `${label}.${expected.artifactField}`,
  );
  const forbiddenArtifactField = expected.artifactField === 'image' ? 'artifactRef' : 'image';
  if (isString(service[forbiddenArtifactField])) {
    errors.push(`${label}.${forbiddenArtifactField} must be absent for ${expected.artifactField}-backed service`);
  }
  expectString(
    stringAt(service, 'internalUrl', label),
    expected.internalUrl,
    `${label}.internalUrl`,
  );
  if (expected.publicUrl) {
    expectString(
      stringAt(service, 'publicUrl', label),
      expected.publicUrl,
      `${label}.publicUrl`,
    );
  } else if (isString(service.publicUrl)) {
    errors.push(`${label}.publicUrl must be absent for internal-only service`);
  }
  checkedServiceSpecs += 1;
}

function validateRequiredBindings(
  bindings: readonly unknown[],
  label: string,
  targetId: ExpectedTargetId,
): void {
  if (bindings.length === 0) {
    errors.push(`${label}.requiredBindings must not be empty`);
    return;
  }
  const actual: ExpectedBinding[] = [];
  bindings.forEach((binding, index) => {
    const record = requireRecord(binding, `${label}.requiredBindings[${index}]`);
    const kind = stringAt(record, 'kind', `${label}.requiredBindings[${index}]`);
    const name = stringAt(record, 'name', `${label}.requiredBindings[${index}]`);
    if (!kind) {
      errors.push(`${label}.requiredBindings[${index}].kind must not be empty`);
    }
    if (!name) {
      errors.push(`${label}.requiredBindings[${index}].name must not be empty`);
    }
    if (kind && name) actual.push({ kind, name });
  });
  const expected = expectedRequiredBindings[targetId];
  compareBindings(actual, expected, `${label}.requiredBindings`);
  checkedRequiredBindings += actual.length;
}

function compareBindings(
  actual: readonly ExpectedBinding[],
  expected: readonly ExpectedBinding[],
  label: string,
): void {
  const actualKeys = actual.map(bindingKey).sort();
  const expectedKeys = expected.map(bindingKey).sort();
  if (actualKeys.join(',') !== expectedKeys.join(',')) {
    errors.push(`${label} must include exactly ${expectedKeys.join(', ')}, got ${actualKeys.join(', ')}`);
  }
}

function bindingKey(binding: ExpectedBinding): string {
  return `${binding.kind}:${binding.name}`;
}

function requireExpectedTargetId(value: string, label: string): ExpectedTargetId | null {
  if (isExpectedTargetId(value)) return value;
  errors.push(`${label} must be one of ${expectedTargets.join(', ')}`);
  return null;
}

function requireExpectedServiceId(value: string, label: string): ExpectedServiceId | null {
  if (isExpectedServiceId(value)) return value;
  errors.push(`${label} must be one of ${expectedServices.join(', ')}`);
  return null;
}

function isExpectedTargetId(value: string): value is ExpectedTargetId {
  return (expectedTargets as readonly string[]).includes(value);
}

function isExpectedServiceId(value: string): value is ExpectedServiceId {
  return (expectedServices as readonly string[]).includes(value);
}

function validateMetadataCommands(metadata: JsonRecord | null, label: string): void {
  if (!metadata) return;
  const liveSmokeTask = maybeString(metadata.liveSmokeTask);
  if (liveSmokeTask) {
    const parsed = parseSimpleShellCommand(liveSmokeTask, `${label}.metadata.liveSmokeTask`, { allowNoCd: true });
    if (parsed) {
      expectString(parsed.taskName, 'distribution:smoke', `${label}.metadata.liveSmokeTask deno task`);
      assertDenoTask(takosDenoConfig, parsed.taskName, `${label}.metadata.liveSmokeTask`);
    }
  }
  const providerSmokeTask = maybeString(metadata.providerSmokeTask);
  if (providerSmokeTask) {
    const targetId = basename(label, '.json');
    const fixturePath = `fixtures/live-provisioning/${targetId}.shape-v1.json`;
    validateProviderCommand({
      command: providerSmokeTask,
      field: `${label}.metadata.providerSmokeTask`,
      targetId,
      fixturePath,
      mode: 'fixture',
    });
  }
}

function validateJsonSchema(value: unknown, schema: JsonRecord, label: string): void {
  const schemaErrors = collectJsonSchemaErrors(value, schema, label);
  for (const error of schemaErrors) {
    errors.push(`${error} (${distributionProfileSchemaPath})`);
  }
}

function collectJsonSchemaErrors(value: unknown, schema: JsonRecord, label: string): string[] {
  const localErrors: string[] = [];

  if ('const' in schema && !jsonValuesEqual(value as JsonValue, schema.const as JsonValue)) {
    localErrors.push(`${label} must equal ${JSON.stringify(schema.const)}`);
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;
  if (enumValues && !enumValues.some((entry) => jsonValuesEqual(value as JsonValue, entry as JsonValue))) {
    localErrors.push(`${label} must be one of ${enumValues.map((entry) => JSON.stringify(entry)).join(', ')}`);
  }

  const expectedType = maybeString(schema.type);
  if (expectedType && !matchesJsonSchemaType(value, expectedType)) {
    localErrors.push(`${label} must be a ${expectedType}`);
    return localErrors;
  }

  if (typeof value === 'string') {
    const minLength = typeof schema.minLength === 'number' ? schema.minLength : null;
    if (minLength !== null && value.length < minLength) {
      localErrors.push(`${label} must have length >= ${minLength}`);
    }
    const pattern = maybeString(schema.pattern);
    if (pattern && !new RegExp(pattern).test(value)) {
      localErrors.push(`${label} must match ${pattern}`);
    }
  }

  if (Array.isArray(value)) {
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : null;
    if (minItems !== null && value.length < minItems) {
      localErrors.push(`${label} must contain at least ${minItems} item(s)`);
    }
    const itemSchema = maybeRecord(schema.items);
    if (itemSchema) {
      value.forEach((item, index) => {
        localErrors.push(...collectJsonSchemaErrors(item, itemSchema, `${label}[${index}]`));
      });
    }
  }

  if (isRecord(value)) {
    const required = stringArray(schema.required);
    for (const key of required) {
      if (!(key in value)) {
        localErrors.push(`${label}.${key} is required`);
      }
    }

    const properties = maybeRecord(schema.properties);
    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!(key in value)) continue;
        if (!isRecord(propertySchema)) {
          localErrors.push(`${label}.${key} schema must be an object`);
          continue;
        }
        localErrors.push(...collectJsonSchemaErrors(value[key], propertySchema, `${label}.${key}`));
      }

      if (schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(properties));
        for (const key of Object.keys(value)) {
          if (!allowedKeys.has(key)) {
            localErrors.push(`${label}.${key} is not allowed`);
          }
        }
      }
    }

    const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : [];
    if (anyOf.length > 0) {
      const matched = anyOf.some((candidate) => collectJsonSchemaErrors(value, candidate, label).length === 0);
      if (!matched) {
        localErrors.push(`${label} must match one of the anyOf schema branches`);
      }
    }
  }

  return localErrors;
}

function matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'object') return isRecord(value);
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'string') return typeof value === 'string';
  if (expectedType === 'number') return typeof value === 'number';
  if (expectedType === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'null') return value === null;
  return false;
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseSimpleShellCommand(
  command: string,
  field: string,
  options: { allowNoCd?: boolean } = {},
): {
  cdPath: string;
  env: Record<string, string>;
  taskName: string;
} | null {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    errors.push(`${field} must not be empty`);
    return null;
  }

  let index = 0;
  let cdPath = '.';
  if (parts[index] === 'cd') {
    cdPath = parts[index + 1] ?? '';
    if (!cdPath || parts[index + 2] !== '&&') {
      errors.push(`${field} must use "cd <path> && ..."`);
      return null;
    }
    index += 3;
  } else if (!options.allowNoCd) {
    errors.push(`${field} must start with "cd ../takosumi &&"`);
    return null;
  }

  const env: Record<string, string> = {};
  while (index < parts.length && /^[A-Z_][A-Z0-9_]*=/.test(parts[index])) {
    const [key, ...rest] = parts[index].split('=');
    env[key] = rest.join('=');
    index += 1;
  }

  if (parts[index] !== 'deno' || parts[index + 1] !== 'task' || !parts[index + 2]) {
    errors.push(`${field} must run a deno task`);
    return null;
  }
  return { cdPath, env, taskName: parts[index + 2] };
}

function assertDenoTask(config: JsonRecord, taskName: string, field: string): void {
  const tasks = maybeRecord(config.tasks);
  if (!tasks || !isString(tasks[taskName])) {
    errors.push(`${field} references missing deno task ${taskName}`);
  }
}

function assertPathExists(ref: string, field: string): void {
  if (ref.startsWith('/')) {
    errors.push(`${field} must be relative, got ${ref}`);
    return;
  }
  const path = resolve(takosRoot, ref);
  const relativeToEcosystem = relative(ecosystemRoot, path);
  if (relativeToEcosystem.startsWith('..') || relativeToEcosystem === '') {
    errors.push(`${field} must stay inside the ecosystem checkout, got ${ref}`);
    return;
  }
  try {
    Deno.statSync(path);
  } catch {
    errors.push(`${field} does not exist: ${ref}`);
  }
}

function pathRelativeToTakosumi(ref: string): string {
  const path = resolve(takosRoot, ref);
  return relative(resolve(takosRoot, '../takosumi'), path);
}

async function distributionManifestFiles(filter: string | null): Promise<string[]> {
  if (filter) return [normalize(filter)];
  const files: string[] = [];
  for await (const entry of Deno.readDir(resolve(takosRoot, distributionDir))) {
    if (entry.isFile && entry.name.endsWith('.json')) {
      files.push(join(distributionDir, entry.name));
    }
  }
  const targets = files.map((file) => basename(file, '.json')).sort();
  const expected = [...expectedTargets].sort();
  if (targets.join(',') !== expected.join(',')) {
    errors.push(`${distributionDir} must contain exactly ${expected.join(', ')}`);
  }
  return files.sort();
}

function parseManifestFilter(args: readonly string[]): string | null {
  if (args.length === 0) return null;
  const [flag, value, ...rest] = args;
  if (flag !== '--manifest' || !value || rest.length > 0) {
    console.error('Usage: deno task validate:distributions [--manifest deploy/distributions/<target>.json]');
    Deno.exit(2);
  }
  return value;
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await Deno.readTextFile(path)) as JsonRecord;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return {};
  }
  return value;
}

function recordAt(record: JsonRecord, key: string, label: string): JsonRecord {
  return requireRecord(record[key], `${label}.${key}`);
}

function arrayAt(record: JsonRecord, key: string, label: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${label}.${key} must be an array`);
    return [];
  }
  return value;
}

function stringAt(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (!isString(value)) {
    errors.push(`${label}.${key} must be a string`);
    return '';
  }
  return value;
}

function maybeRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function maybeString(value: unknown): string | null {
  return isString(value) ? value : null;
}

function expectString(actual: unknown, expected: string, label: string): void {
  if (actual !== expected) {
    errors.push(`${label} must be ${expected}, got ${String(actual)}`);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
