#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile as nodeExecFile, spawnSync } from "node:child_process";
import { mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Log, LogLevel, Miniflare } from "miniflare";

const execFile = promisify(nodeExecFile);
const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const buildHelperPath = join(root, "scripts/lib/build-native-proof-fixture.ts");
const entrypointPath = join(root, "src/worker/cloudflare-entrypoint.ts");
const migrationSetPath = "src/worker/platform/migrations/migration-set.generated.json";
const migrationDir = "db/migrations-control/migrations";
const REQUIRED_BINDINGS = [
  "DB", "HOSTNAME_ROUTING", "SESSION_DO", "RUN_NOTIFIER", "RUN_QUEUE",
  "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "ADMIN_DOMAIN", "TENANT_BASE_DOMAIN",
  "PLATFORM_PRIVATE_KEY", "PLATFORM_PUBLIC_KEY", "TAKOS_AGENT_START_TOKEN", "ENCRYPTION_KEY",
] as const;
const REQUEST_URL = "https://admin.example.test/.well-known/takos";
const EXPECTED_COUNT = 106;

interface CliOptions { bunPath: string; outputDir: string }
interface Migration { name: string; sha256: string }
interface LedgerRow { name: string; checksum: string; applied_at: string }
interface LockRow { id: number; holder: string | null; lease_expires_at: string | null; status: string; detail: string | null; updated_at: string }
interface BuildResult {
  success: boolean; outputs: Array<{ path: string }>; logs: string[];
  metafile: Record<string, unknown> | null; bunVersion: string;
  compatibilityDate: string; compatibilityFlags: string[]; compatibilityConfigSha256: string;
}
interface AdmissionRecord {
  phase: "fixture-locked" | "post-release" | "cached-ready";
  method: "GET"; url: string; httpStatus: number; body: unknown; retryAfter: string | null;
  ledger: LedgerRow[]; lock: LockRow | null; observedAt: string;
}
export interface NativeHttpSchemaProofReport {
  status: "passed";
  result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK";
  outputDir: string;
  elapsedMs: number;
  requestUrl: string;
  bindings: { required: string[]; forbiddenPresent: string[]; singleOwner: string };
  runtime: Record<string, unknown>;
  compatibility: { date: string; flags: string[]; sourceSha256: string };
  bundle: { path: string; sha256: string; inputHashes: Record<string, string>; inputHashesAfterRun: Record<string, string> };
  migrations: {
    count: number; embedded: Migration[]; fixtureLockBeforeRequest: LockRow;
    fixtureLockAfterRequest: LockRow | null; releasedFixtureLock: LockRow | null;
    admissions: AdmissionRecord[]; continuationWaitMs: number; readyLedger: LedgerRow[];
    cachedLedgerUnchanged: boolean;
  };
}

class StderrLog extends Log {
  protected override log(message: string): void { process.stderr.write(`${message}\n`); }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function hash(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseCli(args: string[]): CliOptions {
  let bun = "";
  let output = "";
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[index + 1];
    if ((key !== "--bun" && key !== "--output-dir") || !value || value.startsWith("--")) {
      throw new Error("usage: node --experimental-strip-types scripts/prove-http-schema-native.ts --bun <executable> --output-dir <fresh-owned-dir>");
    }
    if (key === "--bun") bun = value;
    else output = value;
    index++;
  }
  if (!bun || !output) throw new Error("both --bun and --output-dir are required");
  return { bunPath: resolve(bun), outputDir: resolve(output) };
}
function runSync(command: string[]): { status: number | null; stdout: string; stderr: string; error?: string } {
  const result = spawnSync(command[0]!, command.slice(1), { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ...(result.error ? { error: String(result.error) } : {}) };
}
async function buildFixture(bunPath: string, outputDir: string): Promise<BuildResult> {
  const { stdout } = await execFile(bunPath, [buildHelperPath, entrypointPath, outputDir, join(root, "deploy/cloudflare/wrangler.toml")], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(stdout)) as Omit<BuildResult, "compatibilityConfigSha256">;
  const metafile = typeof parsed.metafile === "string" ? JSON.parse(parsed.metafile) as Record<string, unknown> : parsed.metafile;
  return { ...parsed, metafile, compatibilityConfigSha256: hash(await readFile(join(root, "deploy/cloudflare/wrangler.toml"))) };
}
async function currentEmbeddedMigrations(): Promise<Migration[]> {
  const generated = JSON.parse(String(await readFile(join(root, migrationSetPath)))) as { entries?: Migration[] };
  assert(Array.isArray(generated.entries) && generated.entries.length === EXPECTED_COUNT,
    `expected ${EXPECTED_COUNT} embedded migrations, got ${generated.entries?.length ?? "none"}`);
  return generated.entries.map(({ name, sha256 }) => ({ name, sha256 }));
}
async function responseBody(response: Pick<Response, "status" | "text">): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error(`HTTP ${response.status} returned non-JSON body: ${text.slice(0, 512)}`); }
}
async function readLedger(db: D1DatabaseLike): Promise<LedgerRow[]> {
  const result = await db.prepare('SELECT name, checksum, applied_at FROM "_takos_opentofu_migrations" ORDER BY rowid').all<LedgerRow>();
  return result.results;
}
async function readLock(db: D1DatabaseLike): Promise<LockRow | null> {
  return await db.prepare('SELECT id, holder, lease_expires_at, status, detail, updated_at FROM "_takos_runtime_migration_lock" WHERE id = 1').first<LockRow>();
}
function assertLedgerPrefix(rows: LedgerRow[], migrations: Migration[], label: string): void {
  assert(rows.length <= migrations.length, `${label}: ledger exceeds embedded migration set`);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const expected = migrations[index]!;
    assert(row.name === expected.name && row.checksum === expected.sha256,
      `${label}: ledger is not the exact ordered embedded prefix at ${index}: ${JSON.stringify({ row, expected })}`);
    assert(typeof row.applied_at === "string" && Number.isFinite(Date.parse(row.applied_at)), `${label}: invalid applied_at for ${row.name}`);
  }
}
function assertStrictProgress(previous: LedgerRow[], current: LedgerRow[], label: string): void {
  assert(current.length > previous.length, `${label}: admission did not strictly advance migration ledger (${previous.length} -> ${current.length})`);
  assert(JSON.stringify(current.slice(0, previous.length)) === JSON.stringify(previous), `${label}: ordered ledger prefix/checksum/applied_at changed`);
}
function pendingDetails(body: unknown): Record<string, unknown> {
  assert(isRecord(body) && isRecord(body.error) && isRecord(body.error.details), `HTTP pending body has unexpected shape: ${JSON.stringify(body)}`);
  return body.error.details;
}
function assertPendingResponse(record: AdmissionRecord, state: "applying" | "pending"): void {
  assert(record.httpStatus === 503, `expected production HTTP 503 while schema is ${state}, got ${record.httpStatus}`);
  assert(isRecord(record.body) && isRecord(record.body.error) && record.body.error.code === "SCHEMA_MIGRATION_PENDING",
    `unexpected production schema-gate response: ${JSON.stringify(record.body)}`);
  const details = pendingDetails(record.body);
  assert(details.state === state, `expected schema state ${state}, got ${JSON.stringify(details)}`);
  assert(record.retryAfter === "5", `expected Retry-After: 5, got ${record.retryAfter}`);
}
function assertDiscoveryResponse(record: AdmissionRecord): void {
  assert(record.httpStatus === 200, `expected discovery HTTP 200, got ${record.httpStatus}: ${JSON.stringify(record.body)}`);
  assert(isRecord(record.body) && record.body.product === "takos" && record.body.name === "Takos" &&
    record.body.issuer === "https://admin.example.test" && record.body.apiBaseUrl === "https://admin.example.test",
  `production Takos discovery response did not match the requested origin: ${JSON.stringify(record.body)}`);
  assert(record.lock?.status === "ready" && record.lock.holder === null && record.lock.lease_expires_at === null,
    `ready discovery response did not leave a released ready lock: ${JSON.stringify(record.lock)}`);
}
async function waitRetryAfter(seconds: number): Promise<number> {
  const started = performance.now();
  const deadline = started + seconds * 1_000;
  while (performance.now() < deadline) await new Promise<void>((resolveWait) => setTimeout(resolveWait, Math.ceil(deadline - performance.now())));
  return performance.now() - started;
}
async function processTreeSnapshot(stage: string): Promise<Record<string, unknown>> {
  const listing = runSync(["ps", "-eo", "pid=,ppid=,comm="]);
  if (listing.status !== 0) return { stage, error: listing.error ?? listing.stderr, children: [] };
  const rows = new Map<number, { ppid: number; command: string }>();
  for (const line of listing.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u);
    if (match) rows.set(Number(match[1]), { ppid: Number(match[2]), command: match[3]! });
  }
  const owned = new Set([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, row] of rows) if (!owned.has(pid) && owned.has(row.ppid)) { owned.add(pid); changed = true; }
  }
  const children: unknown[] = [];
  for (const pid of owned) {
    if (pid === process.pid || rows.get(pid)?.command.toLowerCase() !== "workerd") continue;
    try {
      const exePath = await readlink(`/proc/${pid}/exe`);
      const version = runSync([exePath, "--version"]);
      children.push({ pid, ppid: rows.get(pid)?.ppid, exePath, sha256: hash(await readFile(`/proc/${pid}/exe`)), version: { status: version.status, stdout: version.stdout.trim().slice(0, 256), stderr: version.stderr.trim().slice(0, 256), error: version.error ?? null } });
    } catch (error) { children.push({ pid, error: String(error) }); }
  }
  return { stage, observerPid: process.pid, children };
}
interface D1StatementLike {
  bind(...values: Array<string | number | null | boolean>): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface D1DatabaseLike { prepare(sql: string): D1StatementLike; exec(sql: string): Promise<unknown> }

async function runProof(options: CliOptions, runId: string, startedMs: number): Promise<NativeHttpSchemaProofReport> {
  const migrations = await currentEmbeddedMigrations();
  const manifestPaths = [
    "deploy/cloudflare/wrangler.toml", migrationSetPath,
    "src/worker/cloudflare-entrypoint.ts", "src/worker/index.ts", "src/worker/web.ts",
    "src/worker/platform/migrations/schema-gate.ts", "src/worker/platform/migrations/runtime-migrations.ts",
    "scripts/lib/build-native-proof-fixture.ts", "scripts/prove-http-schema-native.ts",
    "scripts/prove-http-schema-native.test.ts",
    ...migrations.map(({ name }) => `${migrationDir}/${name}`),
  ];
  const preSourceHashes: Record<string, string> = {};
  for (const path of manifestPaths) preSourceHashes[path] = hash(await readFile(join(root, path)));
  for (const entry of migrations) {
    const sourceHash = preSourceHashes[`${migrationDir}/${entry.name}`];
    assert(sourceHash === entry.sha256.replace(/^sha256:/u, ""), `migration SQL checksum differs from embedded manifest: ${entry.name}`);
  }

  const buildDir = join(options.outputDir, "bundle");
  const stateDir = join(options.outputDir, "native-state");
  await mkdir(buildDir);
  let mf: Miniflare | undefined;
  let preserve = false;
  let report: NativeHttpSchemaProofReport | undefined;
  let lifecycleError: unknown;
  const diagnosticEvidence: Record<string, unknown> = { sourceHashesBeforeRun: preSourceHashes, admissions: [] };
  const watchdog = setTimeout(() => {
    preserve = true;
    void writeFile(join(options.outputDir, "failure.json"), `${JSON.stringify({ at: new Date().toISOString(), error: "70-second native proof watchdog expired", ...diagnosticEvidence }, null, 2)}\n`)
      .catch((error: unknown) => process.stderr.write(`watchdog evidence write failed: ${String(error)}\n`));
    void mf?.dispose().finally(() => process.exit(124));
    setTimeout(() => process.exit(124), 2_000).unref();
  }, 70_000);
  try {
    const built = await buildFixture(options.bunPath, buildDir);
    assert(built.compatibilityConfigSha256 === preSourceHashes["deploy/cloudflare/wrangler.toml"], "Wrangler compatibility config changed during fixture build");
    assert(built.success && built.outputs.length === 1, `production entrypoint bundle failed: ${built.logs.join("; ")}`);
    assert(built.compatibilityDate.length > 0 && Array.isArray(built.compatibilityFlags), "production compatibility date/flags missing");
    const script = await readFile(built.outputs[0]!.path, "utf8");
    const inputs = built.metafile?.inputs;
    assert(isRecord(inputs) && Object.keys(inputs).length > 0, "Bun.build metafile has no production entrypoint inputs");
    const bundleInputs: Record<string, string> = {};
    for (const inputPath of Object.keys(inputs).sort()) {
      const resolvedPath = resolve(root, inputPath);
      bundleInputs[inputPath] = hash(await readFile(resolvedPath));
    }
    const mfBindings: Record<string, string> = {
      OIDC_ISSUER_URL: "https://issuer.example.test",
      OIDC_CLIENT_ID: "native-http-schema-proof",
      ADMIN_DOMAIN: "admin.example.test",
      TENANT_BASE_DOMAIN: "tenant.example.test",
      PLATFORM_PRIVATE_KEY: "native-proof-private-placeholder",
      PLATFORM_PUBLIC_KEY: "native-proof-public-placeholder",
      TAKOS_AGENT_START_TOKEN: "native-proof-start-placeholder",
      ENCRYPTION_KEY: "native-proof-encryption-placeholder",
    };
    assert(Object.keys(mfBindings).every((key) => !["OWNER", "GRANT", "BILLING", "EXTERNAL_SECRET"].some((term) => key.includes(term))), "fixture unexpectedly introduced owner/grant/billing/external-secret bindings");
    mf = new Miniflare({
      name: `native-http-schema-${runId}`,
      log: new StderrLog(LogLevel.INFO),
      modules: true,
      script,
      scriptPath: built.outputs[0]!.path,
      compatibilityDate: built.compatibilityDate,
      compatibilityFlags: built.compatibilityFlags,
      bindings: mfBindings,
      kvNamespaces: { HOSTNAME_ROUTING: `native-http-schema-kv-${runId}` },
      durableObjects: {
        SESSION_DO: { className: "SessionDO", useSQLite: false },
        RUN_NOTIFIER: { className: "RunNotifierDO", useSQLite: false },
      },
      durableObjectsPersist: join(stateDir, "do"),
      queueProducers: { RUN_QUEUE: `native-http-schema-queue-${runId}` },
      d1Databases: { DB: `native-http-schema-db-${runId}` },
      d1Persist: join(stateDir, "d1"),
      host: "127.0.0.1",
    });
    await mf.ready;
    const db = await mf.getD1Database("DB") as unknown as D1DatabaseLike;
    assert(typeof db.prepare === "function" && typeof db.exec === "function", "Miniflare did not expose native D1 host methods");
    const presentBindings = [...REQUIRED_BINDINGS];
    assert(presentBindings.length === 13, "minimal required binding inventory changed unexpectedly");
    const holder = `native-http-schema-fixture-${runId}`;
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const updatedAt = new Date().toISOString();
    await db.prepare(`CREATE TABLE "_takos_runtime_migration_lock" (
      "id" INTEGER PRIMARY KEY, "holder" TEXT, "lease_expires_at" TEXT, "status" TEXT NOT NULL,
      "detail" TEXT, "updated_at" TEXT NOT NULL
    )`).run();
    await db.prepare(`INSERT INTO "_takos_runtime_migration_lock" (id, holder, lease_expires_at, status, detail, updated_at) VALUES (1, ?, ?, 'applying', 'native HTTP proof fixture lock', ?)`).bind(holder, leaseExpiresAt, updatedAt).run();
    const seededLock = await readLock(db);
    assert(seededLock?.holder === holder && seededLock.status === "applying" && seededLock.lease_expires_at === leaseExpiresAt, "fixture migration lock did not seed exactly");
    diagnosticEvidence.fixtureLockBeforeRequest = seededLock;
    const initialLedgerTable = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind("_takos_opentofu_migrations").first<{ name: string }>();
    if (initialLedgerTable !== null) {
      const preexistingLedger = await readLedger(db);
      assert(preexistingLedger.length === 0, `fresh native D1 unexpectedly has migration ledger rows: ${JSON.stringify(preexistingLedger)}`);
    }
    assert(initialLedgerTable === null, `fresh native D1 unexpectedly already has a migration ledger table: ${JSON.stringify(initialLedgerTable)}`);

    const admissions: AdmissionRecord[] = [];
    const fetch = async (phase: AdmissionRecord["phase"]): Promise<AdmissionRecord> => {
      const response = await mf!.dispatchFetch(REQUEST_URL, { method: "GET" });
      const body = await responseBody(response);
      const ledger = await readLedger(db);
      const lock = await readLock(db);
      const record: AdmissionRecord = { phase, method: "GET", url: REQUEST_URL, httpStatus: response.status, body, retryAfter: response.headers.get("Retry-After"), ledger, lock, observedAt: new Date().toISOString() };
      admissions.push(record);
      diagnosticEvidence.admissions = admissions;
      return record;
    };
    const blocked = await fetch("fixture-locked");
    assertPendingResponse(blocked, "applying");
    assert(JSON.stringify(blocked.ledger) === "[]", "fixture-locked request wrote migration ledger rows");
    assert(JSON.stringify(blocked.lock) === JSON.stringify(seededLock), `fixture-locked HTTP request mutated the held lock: ${JSON.stringify({ seededLock, after: blocked.lock })}`);

    await db.prepare(`UPDATE "_takos_runtime_migration_lock" SET holder = NULL, lease_expires_at = NULL, status = 'pending', detail = NULL, updated_at = ? WHERE id = 1 AND holder = ? AND lease_expires_at = ?`).bind(new Date().toISOString(), holder, leaseExpiresAt).run();
    const releasedLock = await readLock(db);
    assert(releasedLock?.holder === null && releasedLock.lease_expires_at === null && releasedLock.status === "pending", "fixture lock release did not affect only the owned fixture row");
    diagnosticEvidence.fixtureLockAfterRequest = blocked.lock;
    diagnosticEvidence.releasedFixtureLock = releasedLock;

    let continuationWaitMs = 0;
    let previousLedger: LedgerRow[] = [];
    let ready = false;
    for (let admissionIndex = 0; admissionIndex < 2; admissionIndex++) {
      const record = await fetch("post-release");
      assertLedgerPrefix(record.ledger, migrations, `post-release admission ${admissionIndex + 1}`);
      assertStrictProgress(previousLedger, record.ledger, `post-release admission ${admissionIndex + 1}`);
      if (record.httpStatus === 200) {
        assertDiscoveryResponse(record);
        ready = true;
        break;
      }
      assertPendingResponse(record, "pending");
      const details = pendingDetails(record.body);
      assert(details.applied === record.ledger.length && details.total === EXPECTED_COUNT, `pending HTTP body counts disagree with native ledger: ${JSON.stringify({ details, ledgerCount: record.ledger.length })}`);
      assert(record.lock?.status === "pending" && record.lock.holder === null && record.lock.lease_expires_at === null,
        `pending HTTP admission left an unexpected migration lock: ${JSON.stringify(record.lock)}`);
      if (admissionIndex === 1) throw new Error(`schema remained pending after the second allowed post-release HTTP admission: ${JSON.stringify(record)}`);
      previousLedger = record.ledger;
      continuationWaitMs = await waitRetryAfter(Number(record.retryAfter));
    }
    assert(ready, "ordinary HTTP discovery request did not pass schema admission within the two-request limit");
    const readyAdmission = admissions.at(-1)!;
    assertLedgerPrefix(readyAdmission.ledger, migrations, "ready HTTP admission");
    assert(readyAdmission.ledger.length === EXPECTED_COUNT, `ready HTTP admission applied ${readyAdmission.ledger.length}/${EXPECTED_COUNT} migrations`);
    assert(readyAdmission.lock?.holder === null && readyAdmission.lock.lease_expires_at === null && readyAdmission.lock.status === "ready", `ready HTTP admission left an invalid lock: ${JSON.stringify(readyAdmission.lock)}`);
    const cached = await fetch("cached-ready");
    assertDiscoveryResponse(cached);
    assert(JSON.stringify(cached.ledger) === JSON.stringify(readyAdmission.ledger), "cached ready discovery fetch changed ledger rows or applied_at values");
    assert(JSON.stringify(cached.lock) === JSON.stringify(readyAdmission.lock), "cached ready discovery fetch changed migration lock state");

    const inputHashesAfterRun: Record<string, string> = {};
    for (const inputPath of Object.keys(inputs).sort()) inputHashesAfterRun[inputPath] = hash(await readFile(resolve(root, inputPath)));
    assert(JSON.stringify(inputHashesAfterRun) === JSON.stringify(bundleInputs), "production Bun.build metafile input changed during native HTTP proof");
    const sourceHashesAfter: Record<string, string> = {};
    for (const path of manifestPaths) sourceHashesAfter[path] = hash(await readFile(join(root, path)));
    assert(JSON.stringify(sourceHashesAfter) === JSON.stringify(preSourceHashes), "production source or migration SQL changed during native HTTP proof");
    const runtime = await packageProvenance(options.bunPath, built.bunVersion);
    const workerdSnapshot = await processTreeSnapshot("after-http-proof");
    assertLinuxWorkerdSnapshot(workerdSnapshot);
    report = {
      status: "passed",
      result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK",
      outputDir: options.outputDir,
      elapsedMs: Date.now() - startedMs,
      requestUrl: REQUEST_URL,
      bindings: { required: presentBindings, forbiddenPresent: [], singleOwner: "operator-owner is not bound; route requires no owner/grant/billing/external-secret authority" },
      runtime: { ...runtime, compatibilityDate: built.compatibilityDate, compatibilityFlags: built.compatibilityFlags, workerdSnapshot, sourceHashesBefore: preSourceHashes, sourceHashesAfter },
      compatibility: { date: built.compatibilityDate, flags: built.compatibilityFlags, sourceSha256: built.compatibilityConfigSha256 },
      bundle: { path: built.outputs[0]!.path, sha256: hash(script), inputHashes: bundleInputs, inputHashesAfterRun },
      migrations: {
        count: EXPECTED_COUNT, embedded: migrations,
        fixtureLockBeforeRequest: seededLock,
        fixtureLockAfterRequest: admissions[0]!.lock,
        releasedFixtureLock: releasedLock,
        admissions, continuationWaitMs, readyLedger: readyAdmission.ledger,
        cachedLedgerUnchanged: JSON.stringify(cached.ledger) === JSON.stringify(readyAdmission.ledger),
      },
    };
  } catch (error) {
    preserve = true;
    const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
    await writeFile(join(options.outputDir, "failure.json"), `${JSON.stringify({ at: new Date().toISOString(), error: detail, ...diagnosticEvidence }, null, 2)}\n`).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(watchdog);
    try { await mf?.dispose(); } catch (error) {
      preserve = true;
      lifecycleError = error;
      await writeFile(join(options.outputDir, "dispose-failure.json"), `${JSON.stringify({ at: new Date().toISOString(), error: String(error) }, null, 2)}\n`).catch(() => undefined);
    }
    if (!preserve) {
      try {
        await rm(stateDir, { recursive: true, force: true });
        await rm(buildDir, { recursive: true, force: true });
      } catch (error) {
        preserve = true;
        lifecycleError = error;
      }
    }
  }
  if (lifecycleError !== undefined) throw new Error("native HTTP proof cleanup failed", { cause: lifecycleError });
  assert(report, "native proof finished without a result");
  await writeFile(join(options.outputDir, "result.json"), `${JSON.stringify(report)}\n`);
  return report;
}
async function packageProvenance(bunPath: string, bunVersion: string): Promise<Record<string, unknown>> {
  const fromController = createRequire(import.meta.url);
  const miniflarePath = fromController.resolve("miniflare");
  const fromMiniflare = createRequire(miniflarePath);
  const workerdModulePath = fromMiniflare.resolve("workerd");
  const workerdPackagePaths = [
    join(root, "node_modules/miniflare/node_modules/workerd/package.json"),
    join(root, "node_modules/workerd/package.json"),
  ];
  const workerdPackagePath = workerdPackagePaths.find((candidate) =>
    workerdModulePath.startsWith(`${dirname(candidate)}/`),
  );
  assert(workerdPackagePath, `could not match resolved Miniflare workerd module to an installed package.json: ${workerdModulePath}`);
  const nodeHash = hash(await readFile(process.execPath));
  const bunHash = hash(await readFile(bunPath));
  return {
    node: process.version,
    nodeExecutablePath: process.execPath,
    nodeExecutableSha256: nodeHash,
    miniflarePath,
    miniflareSha256: hash(await readFile(miniflarePath)),
    miniflareVersion: JSON.parse(String(await readFile(join(root, "node_modules/miniflare/package.json")))).version,
    workerdPackagePath,
    workerdModulePath,
    workerdVersion: JSON.parse(String(await readFile(workerdPackagePath))).version,
    workerdPathOverridePresent: Object.prototype.hasOwnProperty.call(process.env, "MINIFLARE_WORKERD_PATH"),
    bunPath,
    bunSha256: bunHash,
    bunVersion,
  };
}

function assertLinuxWorkerdSnapshot(snapshot: Record<string, unknown>): void {
  assert(process.platform === "linux", `native workerd proof requires Linux owned-process evidence, got ${process.platform}`);
  const children = snapshot.children;
  assert(Array.isArray(children) && children.length > 0, `no Linux workerd child owned by the native controller was observed: ${JSON.stringify(snapshot)}`);
  for (const child of children) {
    assert(isRecord(child) && typeof child.exePath === "string" && child.exePath.length > 0 &&
      typeof child.sha256 === "string" && /^[a-f0-9]{64}$/u.test(child.sha256),
    `owned workerd executable path/hash is missing: ${JSON.stringify(child)}`);
    assert(isRecord(child.version) && child.version.status === 0 &&
      typeof child.version.stdout === "string" && /workerd/iu.test(child.version.stdout),
    `owned workerd --version did not return its version: ${JSON.stringify(child)}`);
  }
}

async function main(): Promise<void> {
  let outputOwned = false;
  try {
    assert(process.version.startsWith("v26.1."), `native HTTP schema controller requires Node 26.1, got ${process.version}`);
    const options = parseCli(process.argv.slice(2));
    await mkdir(options.outputDir);
    outputOwned = true;
    const report = await runProof(options, randomUUID(), Date.now());
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    if (outputOwned) await writeFile(join(parseCli(process.argv.slice(2)).outputDir, "controller-failure.json"), `${JSON.stringify({ at: new Date().toISOString(), error: detail }, null, 2)}\n`, { flag: "wx" }).catch(() => undefined);
    process.stderr.write(`${detail}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) void main();
