/**
 * Secrets management commands: status, sync, put, prune, generate-jwt.
 */

import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  type DeployEnvironment,
  type GlobalOptions,
  type ResolvedConfig,
  CONTROL_APP_DIR,
  SCRIPTS_DIR,
  fail,
  takeFlag,
  takeOption,
} from './index.ts';

// ---------------------------------------------------------------------------
// Worker secrets configuration
// ---------------------------------------------------------------------------

export type WorkerSecretSpec = {
  alias: string;
  config: string;
  required: string[];
  optional: string[];
  /** Secrets that should use the same value as another worker's secret (source alias) */
  shared?: Record<string, string>;
};

export const WORKER_SECRETS: WorkerSecretSpec[] = [
  {
    alias: 'web',
    config: 'wrangler.toml',
    required: [
      'GOOGLE_CLIENT_SECRET',
      'PLATFORM_PRIVATE_KEY', 'PLATFORM_PUBLIC_KEY',
      'CF_API_TOKEN',
      'ENCRYPTION_KEY',
    ],
    optional: [
      'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'SERPER_API_KEY',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'AUDIT_IP_HASH_KEY',
    ],
  },
  {
    alias: 'worker',
    config: 'wrangler.worker.toml',
    required: ['ENCRYPTION_KEY'],
    optional: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'SERPER_API_KEY', 'CF_API_TOKEN'],
  },
  {
    alias: 'runtime-host',
    config: 'wrangler.runtime-host.toml',
    required: [],
    optional: ['JWT_PUBLIC_KEY'],
  },
  {
    alias: 'executor',
    config: 'wrangler.executor.toml',
    required: [],
    optional: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'SERPER_API_KEY'],
  },
  {
    alias: 'dispatch',
    config: 'wrangler.dispatch.toml',
    required: [],
    optional: [],
  },
];

/** Known legacy secrets that should be removed */
export const LEGACY_SECRETS = new Set([
  'BUILD_SERVICE_TOKEN',
  'JWT_SECRET',
  'SERVICE_API_KEY',
  'SERVICE_SIGNING_ACTIVE_KID',
  'SERVICE_SIGNING_KEYS',
  'YURUCOMMU_HOSTED_API_KEY',
  'HOSTED_SERVICE_SECRET',
]);

const SECRETS_DIR_BASE = path.resolve(SCRIPTS_DIR, '../.secrets');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveSecretsDir(environment: DeployEnvironment): string {
  return path.join(SECRETS_DIR_BASE, environment);
}

function readSecretFile(dir: string, name: string): string | null {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trim();
}

function isPlaceholder(value: string): boolean {
  return (
    !value ||
    value.includes('REPLACE_WITH_') ||
    value.includes('your-') ||
    value === 'placeholder-secret' ||
    value === 'local-dev-jwt-secret'
  );
}

function wranglerEnvArgs(configFile: string, environment: DeployEnvironment): string[] {
  const args = ['--config', configFile];
  // production uses default env (no --env flag) in wrangler
  if (environment !== 'production') {
    args.push('--env', environment);
  }
  return args;
}

function runWranglerSecret(
  action: 'put' | 'delete',
  secretName: string,
  configFile: string,
  environment: DeployEnvironment,
  value?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'exec', 'wrangler', 'secret', action, secretName,
      ...wranglerEnvArgs(configFile, environment),
    ];

    const child = spawn('pnpm', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      cwd: CONTROL_APP_DIR,
    });

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    if (action === 'put' && value != null) {
      child.stdin.write(`${value}\n`);
    }
    child.stdin.end();

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(`wrangler secret ${action} ${secretName} failed (exit ${code ?? '?'}): ${stderr.trim()}`));
    });
  });
}

async function listWranglerSecrets(
  configFile: string,
  environment: DeployEnvironment,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const args = [
      'exec', 'wrangler', 'secret', 'list',
      ...wranglerEnvArgs(configFile, environment),
    ];

    const child = spawn('pnpm', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      cwd: CONTROL_APP_DIR,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        // Worker may not exist yet
        if (stderr.includes('not found')) { resolve([]); return; }
        reject(new Error(`wrangler secret list failed: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { name: string }[];
        resolve(parsed.map((s) => s.name));
      } catch {
        resolve([]);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdSecretsStatus(_config: ResolvedConfig, options: GlobalOptions): Promise<number> {
  const env = options.environment;
  const secretsDir = resolveSecretsDir(env);
  const hasDir = fs.existsSync(secretsDir);

  type WorkerStatus = {
    worker: string;
    config: string;
    deployed: string[];
    required: string[];
    optional: string[];
    missing: string[];
    legacy: string[];
    localFiles: string[];
  };

  const statuses: WorkerStatus[] = [];

  for (const spec of WORKER_SECRETS) {
    if (spec.required.length === 0 && spec.optional.length === 0) continue;

    const deployed = await listWranglerSecrets(spec.config, env);
    const allExpected = new Set([...spec.required, ...spec.optional]);
    const missing = spec.required.filter((s) => !deployed.includes(s));
    const legacy = deployed.filter((s) => LEGACY_SECRETS.has(s));
    const localFiles = hasDir
      ? [...allExpected].filter((s) => fs.existsSync(path.join(secretsDir, s)))
      : [];

    statuses.push({
      worker: spec.alias,
      config: spec.config,
      deployed,
      required: spec.required,
      optional: spec.optional,
      missing,
      legacy,
      localFiles,
    });
  }

  if (options.isJson) {
    console.log(JSON.stringify(statuses, null, 2));
  } else {
    console.log(`\nSecrets status for [${env}]`);
    console.log(`Local secrets dir: ${secretsDir} ${hasDir ? '(exists)' : '(not found)'}\n`);

    for (const s of statuses) {
      const tag = s.missing.length > 0 ? ' ⚠' : ' ✓';
      console.log(`${tag} ${s.worker} (${s.config})`);
      console.log(`    deployed: ${s.deployed.length}  required: ${s.required.length}  optional: ${s.optional.length}`);
      if (s.missing.length > 0) {
        console.log(`    MISSING:  ${s.missing.join(', ')}`);
      }
      if (s.legacy.length > 0) {
        console.log(`    LEGACY:   ${s.legacy.join(', ')}`);
      }
      if (s.localFiles.length > 0) {
        console.log(`    local:    ${s.localFiles.join(', ')}`);
      }
    }
  }

  return statuses.length;
}

export async function cmdSecretsSync(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const dryRun = takeFlag(args, '--dry-run');
  const workerFilter = takeOption(args, '--worker');
  const secretsDir = resolveSecretsDir(env);

  if (!fs.existsSync(secretsDir)) {
    fail(`Secrets directory not found: ${secretsDir}\nCreate it with: mkdir -p ${secretsDir}`);
  }

  const specs = workerFilter
    ? WORKER_SECRETS.filter((s) => s.alias === workerFilter)
    : WORKER_SECRETS;

  if (workerFilter && specs.length === 0) {
    fail(`Unknown worker alias: ${workerFilter}. Available: ${WORKER_SECRETS.map((s) => s.alias).join(', ')}`);
  }

  let totalPut = 0;

  for (const spec of specs) {
    const allSecrets = [...spec.required, ...spec.optional];
    if (allSecrets.length === 0) continue;

    const deployed = await listWranglerSecrets(spec.config, env);

    for (const secretName of allSecrets) {
      const value = readSecretFile(secretsDir, secretName);
      if (!value) continue;
      if (isPlaceholder(value)) {
        console.log(`  SKIP ${spec.alias}/${secretName} (placeholder value)`);
        continue;
      }

      const exists = deployed.includes(secretName);
      const action = exists ? 'UPDATE' : 'CREATE';

      if (dryRun) {
        console.log(`  [dry-run] ${action} ${spec.alias}/${secretName}`);
      } else {
        process.stdout.write(`  ${action} ${spec.alias}/${secretName} ... `);
        await runWranglerSecret('put', secretName, spec.config, env, value);
        console.log('ok');
      }
      totalPut++;
    }
  }

  console.log(`\n${dryRun ? '[dry-run] Would sync' : 'Synced'} ${totalPut} secret(s)`);
  return totalPut;
}

export async function cmdSecretsPut(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const secretName = args.shift();
  if (!secretName) fail('Usage: secrets put <SECRET_NAME> [--value-file <path>] [--worker <alias>]');

  const valueFile = takeOption(args, '--value-file');
  const workerFilter = takeOption(args, '--worker');

  let value: string;
  if (valueFile) {
    value = fs.readFileSync(valueFile, 'utf8').replace(/\r\n/g, '\n').trim();
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    value = Buffer.concat(chunks).toString('utf8').trim();
  } else {
    // Try .secrets/<env>/<name>
    const secretsDir = resolveSecretsDir(env);
    const fileValue = readSecretFile(secretsDir, secretName);
    if (fileValue && !isPlaceholder(fileValue)) {
      value = fileValue;
    } else {
      fail(`No value provided. Use --value-file, pipe stdin, or place in ${secretsDir}/${secretName}`);
    }
  }

  if (isPlaceholder(value)) fail('Refusing to upload placeholder value');

  const specs = workerFilter
    ? WORKER_SECRETS.filter((s) => s.alias === workerFilter)
    : WORKER_SECRETS.filter((s) => [...s.required, ...s.optional].includes(secretName));

  if (specs.length === 0) {
    fail(`No workers expect secret "${secretName}". Use --worker <alias> to force.`);
  }

  let count = 0;
  for (const spec of specs) {
    process.stdout.write(`  PUT ${spec.alias}/${secretName} ... `);
    await runWranglerSecret('put', secretName, spec.config, env, value);
    console.log('ok');
    count++;
  }

  return count;
}

export async function cmdSecretsPrune(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const dryRun = takeFlag(args, '--dry-run');
  const workerFilter = takeOption(args, '--worker');

  const specs = workerFilter
    ? WORKER_SECRETS.filter((s) => s.alias === workerFilter)
    : WORKER_SECRETS;

  let totalDeleted = 0;

  for (const spec of specs) {
    const deployed = await listWranglerSecrets(spec.config, env);
    const legacySecrets = deployed.filter((s) => LEGACY_SECRETS.has(s));

    for (const secretName of legacySecrets) {
      if (dryRun) {
        console.log(`  [dry-run] DELETE ${spec.alias}/${secretName}`);
      } else {
        process.stdout.write(`  DELETE ${spec.alias}/${secretName} ... `);
        await runWranglerSecret('delete', secretName, spec.config, env);
        console.log('ok');
      }
      totalDeleted++;
    }
  }

  if (totalDeleted === 0) {
    console.log('No legacy secrets found.');
  } else {
    console.log(`\n${dryRun ? '[dry-run] Would prune' : 'Pruned'} ${totalDeleted} legacy secret(s)`);
  }

  return totalDeleted;
}

export async function cmdSecretsGenerateJwt(_config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  const env = options.environment;
  const prefix = takeOption(args, '--prefix') || 'service';
  const outputDir = takeOption(args, '--output-dir') || resolveSecretsDir(env);
  const upload = takeFlag(args, '--upload');

  const validPrefixes = ['platform'];
  if (!validPrefixes.includes(prefix)) {
    fail(`Invalid prefix: ${prefix}. Use: ${validPrefixes.join(', ')} (service JWT keys are no longer used)`);
  }

  const { generateKeyPairSync } = await import('crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const privateKeyName = 'PLATFORM_PRIVATE_KEY';
  const publicKeyName = 'PLATFORM_PUBLIC_KEY';

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, privateKeyName), String(privateKey), 'utf8');
  fs.writeFileSync(path.join(outputDir, publicKeyName), String(publicKey), 'utf8');
  console.log(`Generated ${prefix} JWT key pair:`);
  console.log(`  ${outputDir}/${privateKeyName}`);
  console.log(`  ${outputDir}/${publicKeyName}`);

  if (upload) {
    const specs = WORKER_SECRETS.filter(
      (s) => [...s.required, ...s.optional].includes(privateKeyName)
    );
    for (const spec of specs) {
      process.stdout.write(`  PUT ${spec.alias}/${privateKeyName} ... `);
      await runWranglerSecret('put', privateKeyName, spec.config, env, String(privateKey));
      console.log('ok');

      if ([...spec.required, ...spec.optional].includes(publicKeyName)) {
        process.stdout.write(`  PUT ${spec.alias}/${publicKeyName} ... `);
        await runWranglerSecret('put', publicKeyName, spec.config, env, String(publicKey));
        console.log('ok');
      }
    }
  }

  return 1;
}
