#!/usr/bin/env -S bun
import * as runtime from "./runtime.ts";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const checks: CheckResult[] = [];

const RUNTIME_SECRET_BINDING_NAMES = [
  'ENCRYPTION_KEY',
  'PLATFORM_PRIVATE_KEY',
  'PLATFORM_PUBLIC_KEY',
  'TAKOS_AGENT_START_TOKEN',
  'TAKOS_INTERNAL_API_SECRET',
];

const PLATFORM_MODULE_PATH =
  'deploy/opentofu/cloudflare/modules/platform/main.tf';
const REPOSITORY_MANIFEST_PATH = '.well-known/takosumi.json';

/**
 * Every declaration that would put secret material into OpenTofu state.
 *
 * A Takosumi Run persists the state as a StateVersion, so an OpenTofu-minted
 * secret is a published secret. The module may name a secret; it may never
 * hold, generate, or transmit one.
 */
const FORBIDDEN_MODULE_MARKERS = [
  'resource "random_password"',
  'resource "random_string"',
  'resource "random_bytes"',
  'resource "tls_private_key"',
  'resource "tls_self_signed_cert"',
  'resource "tls_locally_signed_cert"',
  'provider "random"',
  'provider "tls"',
  '"hashicorp/random"',
  '"hashicorp/tls"',
  '"secret_text"',
  '"secret_key"',
  'key_base64',
  'key_jwk',
];

let openTofuSourceFiles: string[] | undefined;

await checkRequiredDocs();
await checkGitignorePolicy();
await checkTrackedOpenTofuSecretFiles();
await checkPlanFixtures();
await checkModuleMintsNoSecretMaterial();
await checkOutputsExposeNoSecret();
await checkRuntimeSecretBindingContract();

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  for (const check of failed) {
    console.error(`opentofu-secret-policy: failed ${check.name}: ${check.detail}`);
  }
  runtime.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: checks.length }, null, 2));

async function checkRequiredDocs(): Promise<void> {
  const runbookPath = 'deploy/TAKOSUMI_DEPLOY.md';
  const envExamplePath = 'deploy/opentofu/cloudflare/opentofu.tfvars.example';
  const runbook = await readText(runbookPath);
  const envExample = await readText(envExamplePath);
  const requiredRunbookTerms = [
    'wrangler secret put',
    'TAKOSUMI_ACCOUNTS_TOKEN',
    'deploy/opentofu/cloudflare',
    'deploy/cloudflare/wrangler.toml',
    // The invariant this gate exists to protect. Deleting the sentence would
    // otherwise quietly delete the rule.
    'never through OpenTofu state or outputs',
    'runtime_secrets_provisioned',
  ];
  const requiredExampleTerms = [
    'account_id = "replace-with-cloudflare-account-id"',
    'CLOUDFLARE_API_TOKEN is supplied by the Takosumi ProviderConnection',
    'runtime_secrets_provisioned',
  ];
  const missingRunbook = requiredRunbookTerms
    .filter((text) => !runbook.includes(text))
    .map((text) => `${runbookPath}:${text}`);
  const missingExample = requiredExampleTerms
    .filter((text) => !envExample.includes(text))
    .map((text) => `${envExamplePath}:${text}`);
  const forbiddenExample = envExample.includes('api_token =')
    ? [`${envExamplePath}:must not contain api_token assignment`]
    : [];
  const missing = [...missingRunbook, ...missingExample, ...forbiddenExample];
  checks.push({
    name: 'opentofu-secret-policy-source-of-truth',
    ok: missing.length === 0,
    detail: missing.length === 0
      ? 'deploy runbook and OpenTofu env example contain required policy terms'
      : `missing ${missing.join(', ')}`,
  });
}

async function checkGitignorePolicy(): Promise<void> {
  const gitignore = await readText('.gitignore');
  const required = [
    'deploy/opentofu/environments/**/opentofu.tfvars',
    'deploy/opentofu/environments/**/opentofu.tfvars.json',
    'deploy/opentofu/environments/**/*.auto.tfvars',
    'deploy/opentofu/environments/**/*.auto.tfvars.json',
  ];
  const missing = required.filter((pattern) => !gitignore.includes(pattern));
  checks.push({
    name: 'opentofu-tfvars-gitignore',
    ok: missing.length === 0,
    detail: missing.length === 0 ? 'environment tfvars are ignored' : `missing ${missing.join(', ')}`,
  });
}

async function checkTrackedOpenTofuSecretFiles(): Promise<void> {
  const tracked = await gitLsFiles('deploy/opentofu');
  const allowedTfvars = new Set([
    'deploy/opentofu/cloudflare/plan/cloudflare-staging.tfvars',
  ]);
  const forbidden = tracked.filter((path) => {
    if (allowedTfvars.has(path)) return false;
    if (path.endsWith('.tfvars.example')) return false;
    if (path.endsWith('.tfvars') || path.endsWith('.tfvars.json')) return true;
    if (path.endsWith('.auto.tfvars') || path.endsWith('.auto.tfvars.json')) return true;
    return false;
  });
  checks.push({
    name: 'tracked-opentofu-secret-files',
    ok: forbidden.length === 0,
    detail: forbidden.length === 0
      ? 'no tracked live tfvars files'
      : `tracked secret-like files: ${forbidden.join(', ')}`,
  });
}

async function checkPlanFixtures(): Promise<void> {
  const failures: string[] = [];
  // Cloudflare has no DB password; its only identity-like value is account_id,
  // which must stay the all-zero placeholder rather than a real account id.
  {
    const path = 'deploy/opentofu/cloudflare/plan/cloudflare-staging.tfvars';
    const text = await readText(path);
    if (!text.includes('opentofu_plan_mode = true')) {
      failures.push(`${path} missing opentofu_plan_mode = true`);
    }
    if (!text.includes('account_id = "00000000000000000000000000000000"')) {
      failures.push(`${path} cloudflare account_id must be the all-zero CI placeholder`);
    }
  }
  checks.push({
    name: 'ci-plan-fixtures',
    ok: failures.length === 0,
    detail: failures.length === 0 ? 'plan fixtures are CI-only placeholders' : failures.join('; '),
  });
}


async function checkModuleMintsNoSecretMaterial(): Promise<void> {
  const failures: string[] = [];
  for (const path of await currentOpenTofuSourceFiles()) {
    const text = await readText(path);
    for (const marker of FORBIDDEN_MODULE_MARKERS) {
      if (!text.includes(marker)) continue;
      failures.push(`${path} declares ${marker}`);
    }
  }
  checks.push({
    name: 'opentofu-module-mints-no-secret-material',
    ok: failures.length === 0,
    detail: failures.length === 0
      ? 'no OpenTofu source mints or transmits secret material'
      : failures.join('; '),
  });
}

async function checkOutputsExposeNoSecret(): Promise<void> {
  const failures: string[] = [];
  for (const path of await currentOpenTofuSourceFiles()) {
    if (!path.endsWith('/outputs.tf')) continue;
    const text = await readText(path);
    if (/\bsensitive\s*=/.test(text)) {
      failures.push(`${path} declares a sensitive Output`);
    }
    if (/\bephemeral\s*=/.test(text)) {
      failures.push(`${path} declares an ephemeral Output`);
    }
    for (const name of RUNTIME_SECRET_BINDING_NAMES) {
      // The name set is published by referencing the module local, so a literal
      // runtime secret name in an Output file is always a new value channel.
      if (!text.includes(name)) continue;
      failures.push(`${path} names ${name} in an Output`);
    }
  }
  checks.push({
    name: 'opentofu-outputs-expose-no-secret',
    ok: failures.length === 0,
    detail: failures.length === 0
      ? 'no OpenTofu Output is sensitive or secret-bearing'
      : failures.join('; '),
  });
}

/**
 * The module names the runtime secrets and the manifest requests the host-mint
 * for the ones a generated secret can express. Both sides must stay in step, or
 * an install silently loses a binding the Worker fails closed on.
 */
async function checkRuntimeSecretBindingContract(): Promise<void> {
  const failures: string[] = [];
  const platform = await readText(PLATFORM_MODULE_PATH);
  const declared = platform.match(
    /runtime_secret_binding_names\s*=\s*\[([^\]]*)\]/,
  );
  const moduleBindings = declared
    ? [...declared[1].matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1])
    : [];
  const missing = RUNTIME_SECRET_BINDING_NAMES.filter(
    (name) => !moduleBindings.includes(name),
  );
  if (!declared) {
    failures.push(`${PLATFORM_MODULE_PATH} declares no runtime_secret_binding_names`);
  } else if (missing.length > 0) {
    failures.push(
      `${PLATFORM_MODULE_PATH} does not name ${missing.join(', ')}`,
    );
  }
  if (!/type\s*=\s*"inherit"/.test(platform)) {
    failures.push(
      `${PLATFORM_MODULE_PATH} must bind runtime secrets with the value-free inherit type`,
    );
  }
  const rootOutputs = await readText('deploy/opentofu/cloudflare/outputs.tf');
  if (!rootOutputs.includes('output "runtime_secret_binding_names"')) {
    failures.push(
      'deploy/opentofu/cloudflare/outputs.tf must publish the names an operator provisions from',
    );
  }
  if (!platform.includes('local.runtime_secret_bindings,')) {
    failures.push(
      `${PLATFORM_MODULE_PATH} must bind local.runtime_secret_bindings into the Worker Version`,
    );
  }

  const manifest = JSON.parse(await readText(REPOSITORY_MANIFEST_PATH)) as {
    apiVersion?: string;
    install?: {
      modules?: Record<
        string,
        { requires?: { kind?: string; deliver?: { bindings?: { value?: string } } }[] }
      >;
    };
  };
  if (manifest.apiVersion !== 'takosumi.com/v2.4') {
    failures.push(
      `${REPOSITORY_MANIFEST_PATH} must declare takosumi.com/v2.4 to request generated runtime secrets`,
    );
  }
  const requirements = Object.values(manifest.install?.modules ?? {}).flatMap(
    (module) => module.requires ?? [],
  );
  const requested = requirements
    .filter((requirement) => requirement.kind === 'secret.generated')
    .map((requirement) => requirement.deliver?.bindings?.value);
  if (requested.length === 0) {
    failures.push(
      `${REPOSITORY_MANIFEST_PATH} must request its symmetric runtime secrets as secret.generated bindings`,
    );
  }
  for (const binding of requested) {
    if (binding && moduleBindings.includes(binding)) continue;
    failures.push(
      `${REPOSITORY_MANIFEST_PATH} requests ${String(binding)}, which the module does not bind`,
    );
  }

  checks.push({
    name: 'runtime-secret-binding-contract',
    ok: failures.length === 0,
    detail: failures.length === 0
      ? 'the module names every runtime secret it binds and the manifest requests the generated ones'
      : failures.join('; '),
  });
}


/**
 * Tracked, currently selectable OpenTofu source. `*.history` files preserve a
 * retired projection for release history and are deliberately excluded: they
 * are not selectable by OpenTofu or by Takosumi source discovery.
 */
async function currentOpenTofuSourceFiles(): Promise<string[]> {
  if (!openTofuSourceFiles) {
    const tracked = await gitLsFiles('deploy/opentofu');
    openTofuSourceFiles = tracked.filter(
      (path) =>
        path.endsWith('.tf') ||
        path.endsWith('.tf.tmpl') ||
        path.endsWith('.tftest.hcl'),
    );
  }
  return openTofuSourceFiles;
}

async function gitLsFiles(path: string): Promise<string[]> {
  const output = await runtime.runCommand('git', {
    args: ['ls-files', path],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (output.code !== 0) {
    throw new Error(`git ls-files ${path} failed: ${decode(output.stderr)}`);
  }
  return decode(output.stdout).trim().split(/\r?\n/).filter((line) => line.length > 0);
}

async function readText(path: string): Promise<string> {
  return await runtime.readTextFile(path);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
