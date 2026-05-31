#!/usr/bin/env -S bun --preload ./shims/deno-compat.ts

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const checks: CheckResult[] = [];

await checkRequiredDocs();
await checkGitignorePolicy();
await checkTrackedTerraformSecretFiles();
await checkPlanFixtures();
await checkTerraformSensitiveOutputs();
await checkHelmBridgeGuard();

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  for (const check of failed) {
    console.error(`terraform-secret-policy: failed ${check.name}: ${check.detail}`);
  }
  Deno.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: checks.length }, null, 2));

async function checkRequiredDocs(): Promise<void> {
  const docs = await readText('docs/hosting/secrets.md');
  const required = [
    'takos-private',
    'terraform_plan_mode = true',
    'runtimeConfig.managedResources',
    'secrets.create: false',
    'database_endpoint',
    'database_url',
    'terraform.tfvars',
    'validate:terraform-secrets',
  ];
  const missing = required.filter((text) => !docs.includes(text));
  checks.push({
    name: 'hosting-secret-policy-doc',
    ok: missing.length === 0,
    detail: missing.length === 0
      ? 'docs/hosting/secrets.md contains required policy terms'
      : `missing ${missing.join(', ')}`,
  });
}

async function checkGitignorePolicy(): Promise<void> {
  const gitignore = await readText('.gitignore');
  const required = [
    'deploy/terraform/environments/**/terraform.tfvars',
    'deploy/terraform/environments/**/terraform.tfvars.json',
    'deploy/terraform/environments/**/*.auto.tfvars',
    'deploy/terraform/environments/**/*.auto.tfvars.json',
  ];
  const missing = required.filter((pattern) => !gitignore.includes(pattern));
  checks.push({
    name: 'terraform-tfvars-gitignore',
    ok: missing.length === 0,
    detail: missing.length === 0 ? 'environment tfvars are ignored' : `missing ${missing.join(', ')}`,
  });
}

async function checkTrackedTerraformSecretFiles(): Promise<void> {
  const tracked = await gitLsFiles('deploy/terraform');
  const allowedTfvars = new Set([
    'deploy/terraform/plan/aws-staging.tfvars',
    'deploy/terraform/plan/gcp-staging.tfvars',
  ]);
  const forbidden = tracked.filter((path) => {
    if (allowedTfvars.has(path)) return false;
    if (path.endsWith('.tfvars.example')) return false;
    if (path.endsWith('.tfvars') || path.endsWith('.tfvars.json')) return true;
    if (path.endsWith('.auto.tfvars') || path.endsWith('.auto.tfvars.json')) return true;
    return false;
  });
  checks.push({
    name: 'tracked-terraform-secret-files',
    ok: forbidden.length === 0,
    detail: forbidden.length === 0
      ? 'no tracked live tfvars files'
      : `tracked secret-like files: ${forbidden.join(', ')}`,
  });
}

async function checkPlanFixtures(): Promise<void> {
  const fixturePaths = [
    'deploy/terraform/plan/aws-staging.tfvars',
    'deploy/terraform/plan/gcp-staging.tfvars',
  ];
  const failures: string[] = [];
  for (const path of fixturePaths) {
    const text = await readText(path);
    if (!text.includes('terraform_plan_mode = true')) {
      failures.push(`${path} missing terraform_plan_mode = true`);
    }
    if (!text.includes('ci-plan-placeholder-not-a-secret')) {
      failures.push(`${path} missing CI placeholder password`);
    }
  }
  checks.push({
    name: 'ci-plan-fixtures',
    ok: failures.length === 0,
    detail: failures.length === 0 ? 'plan fixtures are CI-only placeholders' : failures.join('; '),
  });
}

async function checkTerraformSensitiveOutputs(): Promise<void> {
  const rootOutputs = await readText('deploy/terraform/outputs.tf');
  const awsOutputs = await readText('deploy/terraform/modules/aws/outputs.tf');
  const gcpOutputs = await readText('deploy/terraform/modules/gcp/outputs.tf');
  const failures: string[] = [];
  for (
    const [label, text] of [
      ['root', rootOutputs],
      ['aws', awsOutputs],
      ['gcp', gcpOutputs],
    ] as const
  ) {
    if (!/output\s+"database_url"\s*\{[\s\S]*?sensitive\s*=\s*true[\s\S]*?\}/.test(text)) {
      failures.push(`${label} database_url output must remain sensitive`);
    }
  }
  checks.push({
    name: 'terraform-sensitive-database-url',
    ok: failures.length === 0,
    detail: failures.length === 0 ? 'database_url outputs are sensitive' : failures.join('; '),
  });
}

async function checkHelmBridgeGuard(): Promise<void> {
  const bridge = await readText('scripts/terraform-output-to-helm-values.ts');
  const required = [
    'Terraform output ${key} is sensitive and cannot be written to Helm values',
    'Refusing to bridge sensitive database_url into Helm values',
  ];
  const missing = required.filter((text) => !bridge.includes(text));
  checks.push({
    name: 'helm-values-sensitive-output-guard',
    ok: missing.length === 0,
    detail: missing.length === 0 ? 'Helm bridge rejects sensitive Terraform outputs' : `missing ${missing.join(', ')}`,
  });
}

async function gitLsFiles(path: string): Promise<string[]> {
  const output = await new Deno.Command('git', {
    args: ['ls-files', path],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (output.code !== 0) {
    throw new Error(`git ls-files ${path} failed: ${decode(output.stderr)}`);
  }
  return decode(output.stdout).trim().split(/\r?\n/).filter((line) => line.length > 0);
}

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
