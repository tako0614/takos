#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { parseTakosumiOutputsJson } from "./render-wrangler-from-tofu.mjs";

const ENVIRONMENTS = new Set(["production", "staging"]);
const DEFAULT_CONFIG = "deploy/cloudflare/wrangler.toml";
const TEXT_ENCODER = new TextEncoder();

const SIMPLE_SECRET_GENERATORS = {
  OIDC_CLIENT_SECRET: () => randomBase64(32),
  ENCRYPTION_KEY: () => randomBase64(32),
  EXECUTOR_PROXY_SECRET: () => randomHex(32),
  TAKOS_INTERNAL_API_SECRET: () => randomHex(32),
};

const SECRET_ORDER = [
  "OIDC_CLIENT_SECRET",
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
  "ENCRYPTION_KEY",
  "EXECUTOR_PROXY_SECRET",
  "TAKOS_INTERNAL_API_SECRET",
];

function usage() {
  console.error(`
Usage: bun scripts/control/ensure-release-secrets.mjs <environment> [--config <path>] [--secret-dir <path>] [--secrets-file <path>]

Creates or reuses per-worker Takos runtime secrets outside the repo, then pushes
them to Cloudflare with wrangler secret put, or writes a temporary
wrangler-compatible secrets file for a single deploy upload. The worker name is
read from TAKOSUMI_OUTPUTS_JSON.
`);
  process.exit(1);
}

function parseArgs(argv = process.argv.slice(2)) {
  const [environment, ...rest] = argv;
  if (!environment || !ENVIRONMENTS.has(environment)) usage();
  let config = DEFAULT_CONFIG;
  let secretDir;
  let secretsFile;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--config") {
      config = rest[++i];
    } else if (arg === "--secret-dir") {
      secretDir = rest[++i];
    } else if (arg === "--secrets-file") {
      secretsFile = rest[++i];
    } else {
      usage();
    }
    if (!rest[i]) usage();
  }
  return { environment, config, secretDir, secretsFile };
}

function outputValue(entry) {
  if (entry == null) return undefined;
  if (
    typeof entry === "object" &&
    Object.hasOwn(entry, "value") &&
    Object.hasOwn(entry, "sensitive")
  ) {
    return entry.value;
  }
  return entry;
}

function readOutputs() {
  const raw = process.env.TAKOSUMI_OUTPUTS_JSON;
  if (!raw?.trim()) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON is required to ensure secrets");
  }
  return parseTakosumiOutputsJson(raw);
}

function requireWorkerName(outputs) {
  const value = outputValue(outputs.worker_name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('TAKOSUMI_OUTPUTS_JSON must include "worker_name"');
  }
  return value;
}

function safePathSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomBase64(length) {
  return Buffer.from(randomBytes(length)).toString("base64");
}

function randomHex(length) {
  return Buffer.from(randomBytes(length)).toString("hex");
}

function toPem(label, data) {
  const base64 = Buffer.from(data).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ""]
    .join("\n");
}

async function generateRsaPemPair() {
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
    PLATFORM_PRIVATE_KEY: toPem("PRIVATE KEY", privateDer),
    PLATFORM_PUBLIC_KEY: toPem("PUBLIC KEY", publicDer),
  };
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function secretPath(secretDir, name) {
  return join(secretDir, name);
}

function readSecret(secretDir, name) {
  const path = secretPath(secretDir, name);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

function writeSecret(secretDir, name, value) {
  const path = secretPath(secretDir, name);
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

async function ensureSecrets(secretDir) {
  ensureDir(secretDir);
  const existing = new Map();
  for (const name of SECRET_ORDER) {
    const value = readSecret(secretDir, name);
    if (value !== undefined) existing.set(name, value);
  }

  if (
    !existing.has("PLATFORM_PRIVATE_KEY") ||
    !existing.has("PLATFORM_PUBLIC_KEY")
  ) {
    const pair = await generateRsaPemPair();
    for (const [name, value] of Object.entries(pair)) {
      if (!existing.has(name)) {
        writeSecret(secretDir, name, value);
        existing.set(name, value);
      }
    }
  }

  for (const [name, generate] of Object.entries(SIMPLE_SECRET_GENERATORS)) {
    if (!existing.has(name)) {
      const value = generate();
      writeSecret(secretDir, name, value);
      existing.set(name, value);
    }
  }

  return Object.fromEntries(
    SECRET_ORDER.map((name) => {
      const value = existing.get(name);
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`failed to materialize release secret ${name}`);
      }
      return [name, value];
    }),
  );
}

function wranglerEnvArgs(environment) {
  return environment === "staging" ? ["--env", "staging"] : [];
}

function putSecret({ environment, config, workerName, name, value }) {
  const result = spawnSync(
    "bunx",
    [
      "wrangler",
      "secret",
      "put",
      name,
      "--config",
      config,
      "--name",
      workerName,
      ...wranglerEnvArgs(environment),
    ],
    {
      input: TEXT_ENCODER.encode(value),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `wrangler secret put ${name} failed (${result.status ?? "unknown"}): ${
        result.stderr.trim()
      }`,
    );
  }
}

async function main() {
  const { environment, config, secretDir, secretsFile } = parseArgs();
  const outputs = readOutputs();
  const workerName = requireWorkerName(outputs);
  const resolvedSecretDir = resolve(
    secretDir ??
      join(
        homedir(),
        ".takos",
        "release-secrets",
        environment,
        safePathSegment(workerName),
      ),
  );
  const secrets = await ensureSecrets(resolvedSecretDir);
  if (secretsFile) {
    const path = resolve(secretsFile);
    writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log(`Wrote Cloudflare release secrets file ${path}`);
    return;
  }
  for (const name of SECRET_ORDER) {
    putSecret({ environment, config, workerName, name, value: secrets[name] });
    console.log(`Ensured Cloudflare secret ${name}`);
  }
  console.log(`Takos release secrets ensured for ${workerName}`);
}

if (import.meta.main) {
  main();
}
