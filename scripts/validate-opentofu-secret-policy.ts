#!/usr/bin/env -S bun
import * as runtime from "./runtime.ts";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const checks: CheckResult[] = [];

await checkRequiredDocs();
await checkGitignorePolicy();
await checkTrackedOpenTofuSecretFiles();
await checkPlanFixtures();

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  for (const check of failed) {
    console.error(`opentofu-secret-policy: failed ${check.name}: ${check.detail}`);
  }
  runtime.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: checks.length }, null, 2));

async function checkRequiredDocs(): Promise<void> {
  const docs = await readText('docs/hosting/secrets.md');
  const required = [
    'takos-private',
    'opentofu_plan_mode = true',
    'opentofu.tfvars',
    'validate:opentofu-secrets',
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
    'deploy/opentofu/plan/cloudflare-staging.tfvars',
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
    const path = 'deploy/opentofu/plan/cloudflare-staging.tfvars';
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
