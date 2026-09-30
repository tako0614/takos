#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_TAR_ENTRIES = 20_000;
const STARTUP_TIMEOUT_MS = 30_000;

export type WorkerReleaseSmokeResult = Readonly<{
  kind: "takos.worker-release-smoke@v1";
  runtime: "wrangler-local-workerd";
  archiveDigest: string;
  health: { path: "/health"; status: 200; bodyDigest: string };
  api: { path: "/api/auth/me"; status: 401; bodyDigest: string };
  productDiscovery: {
    path: "/.well-known/takosumi";
    status: 200;
    bodyDigest: string;
    apiPath: "/api/v1";
  };
}>;

export async function smokeWorkerReleaseArchive(
  root: string,
  archivePath: string,
): Promise<WorkerReleaseSmokeResult> {
  const archive = await physicalArchive(archivePath);
  const archiveInfo = await stat(archive);
  if (archiveInfo.size <= 0 || archiveInfo.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Worker release archive size is invalid");
  }
  const archiveDigest = digest(await readFile(archive));
  const temporary = await mkdtemp(join(tmpdir(), "takos-worker-release-smoke-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await inspectArchive(root, archive);
    await run(root, "tar", [
      "--extract",
      "--gzip",
      "--file",
      archive,
      "--directory",
      temporary,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    await assertExtractedClosure(temporary);

    const port = await availableLoopbackPort();
    const config = join(temporary, "wrangler.toml");
    await writeFile(config, smokeWranglerConfig(temporary), {
      flag: "wx",
      mode: 0o600,
    });
    const env = localWranglerEnvironment(process.env);
    child = Bun.spawn(
      [
        "bunx",
        "wrangler",
        "dev",
        "--config",
        config,
        "--local",
        "--no-bundle",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: root,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = readBoundedText(asByteStream(child.stdout));
    const stderr = readBoundedText(asByteStream(child.stderr));
    let exitCode: number | undefined;
    void child.exited.then((code) => {
      exitCode = code;
    });

    const origin = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(origin, () => exitCode);
    const healthBody = await health.text();
    if (
      health.status !== 200 ||
      health.headers.get("content-type")?.includes("application/json") !== true ||
      !isExactHealthBody(healthBody)
    ) {
      throw new Error("exact Worker archive health response is invalid");
    }

    const discovery = await fetch(`${origin}/.well-known/takosumi`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const discoveryBody = await discovery.text();
    if (
      discovery.status !== 200 ||
      discovery.headers.get("content-type")?.includes("application/json") !== true ||
      !isTakosProductDiscovery(discoveryBody, origin)
    ) {
      throw new Error("exact Worker archive product discovery is invalid");
    }

    const api = await fetch(`${origin}/api/auth/me`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const apiBody = await api.text();
    if (
      api.status !== 401 ||
      api.headers.get("content-type")?.includes("application/json") !== true ||
      !isJsonObject(apiBody)
    ) {
      throw new Error("exact Worker archive API auth boundary is invalid");
    }

    child.kill();
    await child.exited;
    await Promise.all([stdout, stderr]);
    child = undefined;
    return {
      kind: "takos.worker-release-smoke@v1",
      runtime: "wrangler-local-workerd",
      archiveDigest,
      health: {
        path: "/health",
        status: 200,
        bodyDigest: digest(new TextEncoder().encode(healthBody)),
      },
      api: {
        path: "/api/auth/me",
        status: 401,
        bodyDigest: digest(new TextEncoder().encode(apiBody)),
      },
      productDiscovery: {
        path: "/.well-known/takosumi",
        status: 200,
        bodyDigest: digest(new TextEncoder().encode(discoveryBody)),
        apiPath: "/api/v1",
      },
    };
  } catch (error) {
    if (child) {
      child.kill();
      await child.exited.catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function physicalArchive(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Worker release archive path must be absolute");
  const [entry, canonical] = await Promise.all([lstat(path), realpath(path)]);
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.nlink !== 1 ||
    canonical !== resolve(path)
  ) {
    throw new Error("Worker release archive must be one physical canonical file");
  }
  return canonical;
}

async function inspectArchive(root: string, archive: string): Promise<void> {
  const listing = await run(root, "tar", ["--list", "--gzip", "--file", archive]);
  const entries = listing.stdout.split("\n").filter(Boolean);
  if (
    entries.length === 0 ||
    entries.length > MAX_TAR_ENTRIES ||
    new Set(entries).size !== entries.length ||
    !entries.includes("./worker/index.js") ||
    !entries.includes("./asset-manifest.json") ||
    !entries.includes("./assets/")
  ) {
    throw new Error("Worker release archive closure is invalid");
  }
  for (const entry of entries) {
    const normalized = entry.startsWith("./") ? entry.slice(2) : entry;
    const segments = normalized.split("/");
    if (
      entry.includes("\\") ||
      entry.startsWith("/") ||
      segments.includes("..") ||
      (normalized !== "" &&
        normalized !== "worker/" &&
        normalized !== "worker/index.js" &&
        normalized !== "asset-manifest.json" &&
        normalized !== "assets/" &&
        !normalized.startsWith("assets/"))
    ) {
      throw new Error(`Worker release archive contains an unsafe entry: ${entry}`);
    }
  }
  const verbose = await run(root, "tar", [
    "--list",
    "--verbose",
    "--gzip",
    "--file",
    archive,
  ]);
  const types = verbose.stdout.split("\n").filter(Boolean).map((line) => line[0]);
  if (types.length !== entries.length || types.some((type) => type !== "-" && type !== "d")) {
    throw new Error("Worker release archive may contain only files and directories");
  }
}

async function assertExtractedClosure(directory: string): Promise<void> {
  const worker = await lstat(join(directory, "worker/index.js"));
  const manifest = await lstat(join(directory, "asset-manifest.json"));
  const assets = await lstat(join(directory, "assets"));
  if (!worker.isFile() || !manifest.isFile() || !assets.isDirectory()) {
    throw new Error("Worker release archive did not extract its required closure");
  }
}

function smokeWranglerConfig(directory: string): string {
  const quoted = (value: string) => JSON.stringify(value);
  return `name = "takos-release-smoke"
main = ${quoted(join(directory, "worker/index.js"))}
no_bundle = true
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat", "no_handle_cross_request_promise_resolution", "global_fetch_strictly_public"]

[assets]
directory = ${quoted(join(directory, "assets"))}
binding = "ASSETS"
run_worker_first = true

[vars]
ENVIRONMENT = "development"
ADMIN_DOMAIN = "127.0.0.1"
TENANT_BASE_DOMAIN = "127.0.0.1"
OIDC_ISSUER_URL = "https://issuer.invalid"
OIDC_CLIENT_ID = "release-smoke"
PLATFORM_PRIVATE_KEY = "local-smoke-fixture"
PLATFORM_PUBLIC_KEY = "local-smoke-fixture"
TAKOS_AGENT_START_TOKEN = "local-smoke-fixture"
ENCRYPTION_KEY = "local-smoke-fixture"

[[d1_databases]]
binding = "DB"
database_name = "takos-release-smoke"
database_id = "00000000-0000-0000-0000-000000000000"

[[kv_namespaces]]
binding = "HOSTNAME_ROUTING"
id = "00000000000000000000000000000000"

[[durable_objects.bindings]]
name = "SESSION_DO"
class_name = "SessionDO"

[[durable_objects.bindings]]
name = "RUN_NOTIFIER"
class_name = "RunNotifierDO"

[[migrations]]
tag = "v1"
new_classes = ["SessionDO"]

[[migrations]]
tag = "v2"
new_classes = ["RunNotifierDO"]

[[queues.producers]]
queue = "takos-release-smoke"
binding = "RUN_QUEUE"
`;
}

function localWranglerEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  for (const name of Object.keys(env)) {
    if (
      name === "CF_API_EMAIL" ||
      name === "CF_API_KEY" ||
      name === "CLOUDFLARE_API_TOKEN" ||
      name === "CLOUDFLARE_ACCOUNT_ID" ||
      name === "CLOUDFLARE_API_KEY" ||
      name === "CLOUDFLARE_EMAIL"
    ) {
      delete env[name];
    }
  }
  return env;
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("could not allocate a loopback port for Worker smoke");
  }
  return port;
}

async function waitForHealth(
  origin: string,
  exitCode: () => number | undefined,
): Promise<Response> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError = "runtime did not answer";
  while (Date.now() < deadline) {
    if (exitCode() !== undefined) {
      throw new Error(`Worker smoke runtime exited before health readback: ${exitCode()}`);
    }
    try {
      const response = await fetch(`${origin}/health`, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 200) return response;
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(100);
  }
  throw new Error(`Worker smoke runtime did not become ready: ${lastError}`);
}

function isExactHealthBody(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.keys(parsed).length === 1 && parsed.status === "ok";
  } catch {
    return false;
  }
}

function isTakosProductDiscovery(value: string, origin: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return (
      parsed.product === "takosumi" &&
      parsed.apiBaseUrl === `${origin}/api/v1` &&
      typeof parsed.features === "object" &&
      parsed.features !== null
    );
  } catch {
    return false;
  }
}

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

type CommandResult = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

async function run(
  cwd: string,
  executable: string,
  args: readonly string[],
): Promise<CommandResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readBoundedText(child.stdout),
    readBoundedText(child.stderr),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${basename(executable)} ${args[0] ?? ""} failed with exit ${exitCode}`);
  }
  return { exitCode, stdout, stderr };
}

/**
 * `Bun.spawn` types `stdout`/`stderr` as the union of every configurable shape.
 * This process is spawned with `stdout: "pipe"`, so the value is always the
 * stream; the refusal below keeps that assumption from failing silently.
 */
function asByteStream(value: unknown): ReadableStream<Uint8Array> {
  if (!(value instanceof ReadableStream)) {
    throw new Error("expected a piped byte stream from the spawned process");
  }
  return value as ReadableStream<Uint8Array>;
}

async function readBoundedText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const limit = 4 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let retained = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (retained >= limit) continue;
    const chunk = value.slice(0, limit - retained);
    chunks.push(chunk);
    retained += chunk.byteLength;
  }
  const bytes = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

if (import.meta.main) {
  const archive = Bun.argv[2];
  if (!archive) {
    process.stderr.write("usage: bun scripts/smoke-worker-release-artifact.ts <absolute-archive>\n");
    process.exit(2);
  }
  try {
    const result = await smokeWorkerReleaseArchive(resolve(import.meta.dir, ".."), archive);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
