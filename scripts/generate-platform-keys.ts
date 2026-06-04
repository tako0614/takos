#!/usr/bin/env -S bun

/**
 * Generate the Takos product worker's deployment secrets for an environment.
 *
 * Takos is a self-hostable unified worker: you deploy it onto your own infra
 * and it runs its own embedded accounts plane (its origin is its own OIDC
 * issuer). These are that worker's signing / encryption / internal-RPC secrets.
 *
 * Produces five secret files under `.secrets/<env>/` relative to the current
 * working directory (override with `--output=<dir>`):
 *
 * - PLATFORM_PRIVATE_KEY   — RSA 2048 PKCS#8 PEM
 * - PLATFORM_PUBLIC_KEY    — RSA 2048 SPKI PEM
 * - ENCRYPTION_KEY         — 32 byte base64 (data encryption key)
 * - EXECUTOR_PROXY_SECRET  — 32 byte hex (executor-host -> control RPC)
 * - TAKOS_INTERNAL_API_SECRET — 32 byte hex (internal tenant API)
 *
 * When `--per-cloud` is supplied, ALSO emits an independent per-cloud
 * encryption key for each cloud partition (cloudflare / aws / gcp / k8s /
 * selfhosted) under the names `ENCRYPTION_KEY_<CLOUD>`. These map to the
 * per-cloud env keys consumed by `MultiCloudSecretBoundaryCrypto`, so a
 * compromise of one cloud's key does NOT decrypt other clouds' secrets.
 *
 * Keep the generated files OUT of any repo and upload them as your worker's
 * Cloudflare secrets (e.g. `wrangler secret put <NAME>`).
 *
 * Usage:
 *   bun run generate:keys -- --env=local
 *   bun \
 *     scripts/generate-platform-keys.ts --env=local [--force] [--output=<dir>] \
 *     [--per-cloud]
 */

import { resolve } from "node:path";
import { chmod, lstat, mkdir, writeFile } from "node:fs/promises";

type Env = "staging" | "production" | "local";

const SUPPORTED_ENVS = new Set<Env>(["staging", "production", "local"]);

const DEFAULT_SECRETS_BASE = resolve(process.cwd(), ".secrets");

const SECRET_FILES = [
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
  "ENCRYPTION_KEY",
  "EXECUTOR_PROXY_SECRET",
  "TAKOS_INTERNAL_API_SECRET",
] as const;

/**
 * Cloud partitions for which `--per-cloud` emits independent per-cloud
 * encryption keys. The names match the suffixes recognised by
 * `MultiCloudSecretBoundaryCrypto.fromEnv`.
 */
const CLOUD_PARTITION_SUFFIXES = [
  "CLOUDFLARE",
  "AWS",
  "GCP",
  "K8S",
  "SELFHOSTED",
] as const;

function perCloudSecretFiles(): readonly string[] {
  return CLOUD_PARTITION_SUFFIXES.map((cloud) => `ENCRYPTION_KEY_${cloud}`);
}

interface CliOptions {
  env: Env;
  force: boolean;
  output: string;
  perCloud: boolean;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  bun \\",
      "    scripts/generate-platform-keys.ts --env=staging|production|local \\",
      "    [--force] [--output=<dir>] [--per-cloud]",
      "",
      "Generates 5 secret files used by the takos product worker.",
      "With --per-cloud, also emits ENCRYPTION_KEY_<CLOUD> for each of",
      "cloudflare / aws / gcp / k8s / selfhosted.",
      "Defaults --output to ./.secrets/<env>/ (relative to the current dir).",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(args: readonly string[]): CliOptions {
  let env: Env | null = null;
  let force = false;
  let output: string | null = null;
  let perCloud = false;

  for (const raw of args) {
    if (raw === "--force") {
      force = true;
      continue;
    }
    if (raw === "--per-cloud") {
      perCloud = true;
      continue;
    }
    if (raw === "--help" || raw === "-h") {
      usage();
    }
    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      fail(`Unexpected argument: ${raw}`);
    }
    const key = raw.slice(0, eqIndex);
    const value = raw.slice(eqIndex + 1);
    if (!value) {
      fail(`Missing value for ${key}`);
    }
    switch (key) {
      case "--env": {
        if (!SUPPORTED_ENVS.has(value as Env)) {
          fail(
            `Unsupported environment: ${value}. ` +
              `Expected one of: ${[...SUPPORTED_ENVS].join(", ")}`,
          );
        }
        env = value as Env;
        break;
      }
      case "--output": {
        output = value;
        break;
      }
      default: {
        fail(`Unknown option: ${key}`);
      }
    }
  }

  if (!env) {
    fail("--env=<staging|production|local> is required");
  }

  return {
    env,
    force,
    output: output ?? resolve(DEFAULT_SECRETS_BASE, env),
    perCloud,
  };
}

function toPem(label: string, data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [
    `-----BEGIN ${label}-----`,
    ...lines,
    `-----END ${label}-----`,
    "",
  ].join("\n");
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function generateRsaKeyPair(): Promise<{
  privatePem: string;
  publicPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );

  const privateDer = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  );
  const publicDer = new Uint8Array(
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );

  return {
    privatePem: toPem("PRIVATE KEY", privateDer),
    publicPem: toPem("PUBLIC KEY", publicDer),
  };
}

function generateBase64Secret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

function generateHexSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function checkConflicts(
  outputDir: string,
  force: boolean,
  extraNames: readonly string[] = [],
): Promise<void> {
  if (force) return;
  const conflicts: string[] = [];
  const names: readonly string[] = [...SECRET_FILES, ...extraNames];
  for (const name of names) {
    const target = resolve(outputDir, name);
    if (await pathExists(target)) {
      conflicts.push(target);
    }
  }
  if (conflicts.length > 0) {
    console.error(
      [
        "Refusing to overwrite existing secret files:",
        ...conflicts.map((path) => `  - ${path}`),
        "",
        "Re-run with --force to overwrite.",
      ].join("\n"),
    );
    process.exit(1);
  }
}

async function writeSecret(
  outputDir: string,
  name: string,
  contents: string,
): Promise<string> {
  const target = resolve(outputDir, name);
  const data = contents.endsWith("\n") ? contents : `${contents}\n`;
  await writeFile(target, data, "utf8");
  try {
    await chmod(target, 0o600);
  } catch (error) {
    // chmod is best-effort (Windows / restricted FS) — don't abort.
    if (
      !isNodeErrorCode(error, "ENOTSUP") &&
      !isNodeErrorCode(error, "EOPNOTSUPP")
    ) {
      throw error;
    }
  }
  return target;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const extraNames = options.perCloud ? perCloudSecretFiles() : [];

  await ensureDir(options.output);
  await checkConflicts(options.output, options.force, extraNames);

  const { privatePem, publicPem } = await generateRsaKeyPair();
  const encryptionKey = generateBase64Secret(32);
  const executorProxySecret = generateHexSecret(32);
  const internalApiSecret = generateHexSecret(32);

  const written: string[] = [];
  written.push(
    await writeSecret(options.output, "PLATFORM_PRIVATE_KEY", privatePem),
  );
  written.push(
    await writeSecret(options.output, "PLATFORM_PUBLIC_KEY", publicPem),
  );
  written.push(
    await writeSecret(options.output, "ENCRYPTION_KEY", encryptionKey),
  );
  written.push(
    await writeSecret(
      options.output,
      "EXECUTOR_PROXY_SECRET",
      executorProxySecret,
    ),
  );
  written.push(
    await writeSecret(
      options.output,
      "TAKOS_INTERNAL_API_SECRET",
      internalApiSecret,
    ),
  );

  if (options.perCloud) {
    // Independent per-cloud encryption keys ensure that a compromise of one
    // cloud's master key does not propagate to others. Each key is fresh 32
    // bytes of CSPRNG output, NOT derived from the global encryption key.
    for (const cloud of CLOUD_PARTITION_SUFFIXES) {
      const perCloudKey = generateBase64Secret(32);
      written.push(
        await writeSecret(
          options.output,
          `ENCRYPTION_KEY_${cloud}`,
          perCloudKey,
        ),
      );
    }
  }

  console.log(`Generated platform secrets for env=${options.env}:`);
  for (const path of written) {
    console.log(`  ${path}`);
  }
  if (options.perCloud) {
    console.log("");
    console.log(
      "Per-cloud encryption keys generated for partitions: " +
        CLOUD_PARTITION_SUFFIXES.join(", ").toLowerCase(),
    );
    console.log(
      "These map to TAKOS_SECRET_STORE_PASSPHRASE_<CLOUD> via " +
        "MultiCloudSecretBoundaryCrypto.fromEnv.",
    );
  }
  console.log("");
  console.log(
    "Next: upload these as your worker's Cloudflare secrets " +
      "(e.g. `wrangler secret put <NAME>`). Keep the files out of any repo.",
  );
}

if (import.meta.main) {
  await main();
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as { code?: unknown }).code === code;
}
