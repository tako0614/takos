#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync as nodeSpawnSync, execFile as nodeExecFile } from "node:child_process";
import { mkdir, readFile, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Log, LogLevel, Miniflare } from "miniflare";

const execFileAsync = promisify(nodeExecFile);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const root = resolve(scriptDir, "..");
const buildHelperPath = join(scriptDir, "lib", "build-native-proof-fixture.ts");
let miniflareName = "";
let proofDir = "";
let bunPath = "";
let runId = "";
let threadId = "";
let serviceId = "";
const ownerId = "operator-owner";
const workspaceId = "native-owned-workspace";
const providerSub = "https://issuer.example#operator-owner";
let timestamp = "";

interface CliOptions { bunPath: string; outputDir: string }
interface MigrationEntry { name: string; sha256: string }
interface SourceManifest { entries: MigrationEntry[] }
interface SchemaStatus {
  state: "ready" | "pending" | "applying" | "failed";
  total: number;
  applied: number;
  pending: string[];
  ledgerTable: string;
  retryAfterSeconds?: number;
  error?: string;
  failedMigration?: string;
}
interface SourceSnapshot {
  hashes: Record<string, string>;
  migrations: MigrationEntry[];
}
export interface NativeUsageProofReport {
  status: "passed";
  result: "NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK";
  outputDir: string;
  elapsedMs: number;
  runtime: Record<string, unknown>;
  migrationSet: Record<string, unknown> & {
    count: number; applied: number; initialStatus: SchemaStatus; readyStatus: SchemaStatus;
    admissionRequests: SchemaAdmissionRecord[]; continuedFromPending: boolean;
    continuationWaitMs: number;
    ledgerRows: Array<{ name: string; checksum: string; applied_at: string }>;
    secondCallLedgerUnchanged: boolean; finalTriggerCatalog: unknown[];
  };
  terminalCompletion: Record<string, unknown> & {
    failedRunReadback: { status: string; completion_key: string | null; usage: string };
    failedWitnessRows: unknown[]; failedTerminalEventRows: unknown[];
    idempotentRepeatResponse: { idempotent: boolean; completionKey: string };
    repeatedTerminalEvents: unknown[]; repeatedWitnesses: unknown[];
  };
  authoritySnapshots: Record<string, unknown> & { unchanged: boolean };
  injectedUsageRollback: Record<string, unknown> & { events: number; rollups: number; assertions: number };
  nativeReplacement: Record<string, unknown>;
  retry: Record<string, unknown> & {
    response: { completed: number }; events: unknown[]; rollups: unknown[];
    outbox: { delivery_status: string; attempts: number; projected_revision: number | null };
  };
  proofSourceHashes: Record<string, string>;
  sourceHashesBeforeRun: Record<string, string>;
  sourceHashesAfterRun: Record<string, string>;
  bundleInputHashes: Record<string, { resolvedPath: string; sha256: string }>;
  bundleInputHashesAfterRun: Record<string, { resolvedPath: string; sha256: string }>;
  bundleSha256: string;
  compatibility: { date: string; flags: string[]; sourceSha256: string };
  databaseBinding: string;
}
interface NativeStatement {
  bind(...values: Array<string | number | null | boolean>): NativeStatement;
  first<T extends Record<string, unknown> = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface NativeD1 {
  prepare(sql: string): NativeStatement;
  batch<T = unknown>(statements: NativeStatement[]): Promise<T[]>;
  exec(sql: string): Promise<unknown>;
}
interface SchemaRoute {
  status: SchemaStatus;
  secondStatus: SchemaStatus | null;
  embedded: MigrationEntry[];
  ledger: Array<{ name: string; checksum: string; applied_at: string }>;
  ledgerAfterSecond: Array<{ name: string; checksum: string; applied_at: string }>;
  triggerCatalog: Array<Record<string, unknown>>;
  lock: { status: string; holder: string | null; lease_expires_at: string | null } | null;
}
interface SchemaAdmissionRecord {
  httpStatus: number;
  status: SchemaStatus;
  ledgerRows: SchemaRoute["ledger"];
  lock: SchemaRoute["lock"];
  observedAt: string;
}
interface RuntimeContext {
  stages: Array<{ stage: string; at: string; elapsedMs: number; detail?: Record<string, unknown> }>;
  startedEpochMs: number;
  sourceHashesBeforeRun?: Record<string, string>;
  runtimePackages?: Record<string, unknown>;
  ownedBundlePath?: string;
  ownedNativeStatePath?: string;
  preserveOwnedStateOnFailure: boolean;
  originalHostReadbackError?: Record<string, unknown>;
  fullSchemaGateResponse?: unknown;
  workerdBeforeFault?: ProcessSnapshot;
  workerdOnReadbackFailure?: ProcessSnapshot;
  workerdOnReadbackFailureError?: Record<string, unknown>;
  workerdBeforeFaultPidsMissingOnFailure?: number[];
  disposeError?: Record<string, unknown>;
  readbackDiagnostics?: Record<string, unknown>;
  checkpointWriteErrors?: Array<Record<string, unknown>>;
  checkpointDiagnostics: Record<string, unknown>;
  pinnedBunVersion?: string;
  proofError?: unknown;
  failureRetentionPolicy?: string;
  bundleInputHashes?: Record<string, { resolvedPath: string; sha256: string }>;
  bundleInputHashesAfterRun?: Record<string, { resolvedPath: string; sha256: string }>;
  compatibilitySourceSha256?: string;
  schemaAdmissionRequests?: SchemaAdmissionRecord[];
  continuationWaitMs?: number;
}
interface ProcessSnapshot {
  stage: string;
  at: string;
  observerPid: number;
  workerdChildren: WorkerdChild[];
  error?: string;
}
interface WorkerdChild {
  pid: number;
  ppid: number;
  exePath: string | null;
  exeSha256: string | null;
  executableError: Record<string, unknown> | null;
  version: Record<string, unknown> | null;
}
interface BuildFixtureResult {
  success: boolean;
  outputs: Array<{ path: string }>;
  logs: string[];
  metafile: Record<string, unknown> | null;
  bunVersion: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  compatibilityConfigSha256: string;
}
let sourcePaths: string[] = [];

class StderrLog extends Log {
  protected override log(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}
const runContext: RuntimeContext = {
  stages: [],
  startedEpochMs: Date.now(),
  preserveOwnedStateOnFailure: false,
  checkpointDiagnostics: {},
};

function parseCli(args: string[]): CliOptions {
  let compiler = "";
  let output = "";
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[index + 1];
    if ((key !== "--bun" && key !== "--output-dir") || !value || value.startsWith("--")) {
      throw new Error("usage: node --experimental-strip-types scripts/prove-run-usage-native.ts --bun <executable> --output-dir <fresh-owned-dir>");
    }
    if (key === "--bun") compiler = value;
    else output = value;
    index++;
  }
  if (!compiler || !output) throw new Error("both --bun and --output-dir are required");
  return { bunPath: resolve(compiler), outputDir: resolve(output) };
}

function spawnSyncLike(command: string[], _options: Record<string, unknown> = {}) {
  const result = nodeSpawnSync(command[0]!, command.slice(1), {
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    signal: result.signal,
    error: result.error,
  };
}
async function buildFixture(entrypoint: string, outdir: string): Promise<BuildFixtureResult> {
  const { stdout } = await execFileAsync(bunPath, [buildHelperPath, entrypoint, outdir,
    join(root, "deploy/cloudflare/wrangler.toml")], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const summary = JSON.parse(String(stdout)) as {
    success: boolean;
    outputs: Array<{ path: string }>;
    logs: string[];
    metafile: unknown;
    bunVersion: string;
    compatibilityDate: string;
    compatibilityFlags: string[];
  };
  let metafile: Record<string, unknown> | null = null;
  if (typeof summary.metafile === "string") metafile = JSON.parse(summary.metafile) as Record<string, unknown>;
  else if (summary.metafile && typeof summary.metafile === "object") metafile = summary.metafile as Record<string, unknown>;
  return {
    success: summary.success,
    outputs: summary.outputs,
    logs: summary.logs,
    metafile,
    bunVersion: summary.bunVersion,
    compatibilityDate: summary.compatibilityDate,
    compatibilityFlags: summary.compatibilityFlags,
    compatibilityConfigSha256: hash(await readFile(join(root, "deploy/cloudflare/wrangler.toml"))),
  };
}
const migrationSetPath = "src/worker/platform/migrations/migration-set.generated.json";
function markStage(stage: string, detail: Record<string, unknown> = {}) {
  runContext.stages.push({ stage, at: new Date().toISOString(), elapsedMs: Date.now() - runContext.startedEpochMs, detail });
}
function structuredError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, value: String(error) };
  const record: Record<string, unknown> = { name: error.name, message: error.message, stack: error.stack };
  if (depth < 3 && "cause" in error && error.cause !== undefined) record.cause = structuredError(error.cause, depth + 1);
  else if ("cause" in error && error.cause !== undefined) record.cause = String(error.cause);
  return record;
}
async function snapshotOwnedWorkerd(stage: string) {
  const listing = spawnSyncLike(["ps", "-eo", "pid=,ppid=,comm="], { stdout: "pipe", stderr: "pipe" });
  if (listing.exitCode !== 0) return { stage, at: new Date().toISOString(), observerPid: process.pid, error: "ps process snapshot failed", workerdChildren: [] };
  const rows = new Map<number, { ppid: number; comm: string }>();
  for (const line of new TextDecoder().decode(listing.stdout).split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u);
    if (match) rows.set(Number(match[1]), { ppid: Number(match[2]), comm: match[3]! });
  }
  const owned = new Set<number>([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, row] of rows) if (!owned.has(pid) && owned.has(row.ppid)) { owned.add(pid); changed = true; }
  }
  const workerdChildren: WorkerdChild[] = [];
  for (const pid of owned) {
    if (pid === process.pid) continue;
    const row = rows.get(pid);
    if (!row || !/^workerd$/iu.test(row.comm)) continue;
    let exePath: string | null = null;
    let exeSha256: string | null = null;
    let executableError: Record<string, unknown> | null = null;
    try {
      exePath = await readlink(`/proc/${pid}/exe`);
      exeSha256 = hash(await readFile(`/proc/${pid}/exe`));
    } catch (error) { executableError = structuredError(error); }
    let version: Record<string, unknown> | null = null;
    if (exePath) {
      try {
        const result = spawnSyncLike([exePath, "--version"], { stdout: "pipe", stderr: "pipe" });
        version = { exitCode: result.exitCode, signal: result.signal,
          stdout: new TextDecoder().decode(result.stdout).trim().slice(0, 256),
          stderr: new TextDecoder().decode(result.stderr).trim().slice(0, 256),
          error: result.error ? structuredError(result.error) : null };
      } catch (error) { version = { error: structuredError(error) }; }
    }
    workerdChildren.push({ pid, ppid: row.ppid, exePath, exeSha256, executableError, version });
  }
  const snapshot = { stage, at: new Date().toISOString(), observerPid: process.pid, workerdChildren };
  markStage(`workerd-snapshot:${stage}`, { childCount: workerdChildren.length });
  return snapshot;
}
async function checkpointReadbackDiagnostics(checkpoint: string): Promise<void> {
  const destination = join(proofDir, "readback-diagnostic.json");
  const temporary = join(proofDir, ".readback-diagnostic.json.tmp");
  markStage("readback-diagnostic-checkpoint", { checkpoint });
  const payload = {
    checkpoint,
    at: new Date().toISOString(),
    originalHostReadbackError: runContext.originalHostReadbackError ?? null,
    runtimePackages: runContext.runtimePackages ?? null,
    workerdBeforeFault: runContext.workerdBeforeFault ?? null,
    workerdOnReadbackFailure: runContext.workerdOnReadbackFailure ?? null,
    readbackDiagnostics: runContext.readbackDiagnostics ?? null,
    stages: runContext.stages,
  };
  try {
    await writeFile(temporary, JSON.stringify(payload, null, 2) + "\n");
    await rename(temporary, destination);
  } catch (error) {
    const errors = runContext.checkpointWriteErrors ?? [];
    errors.push({ checkpoint, error: structuredError(error) });
    runContext.checkpointWriteErrors = errors;
    markStage("readback-diagnostic-checkpoint-write-failed", { checkpoint, error: structuredError(error) });
  }
}
async function directoryExists(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  return stat(path).then((info) => info.isDirectory()).catch(() => false);
}
async function packageProvenance(): Promise<Record<string, unknown>> {
  const readVersion = async (path: string) => {
    try { return JSON.parse(String(await readFile(join(root, path)))).version as string; }
    catch { return null; }
  };
  const fromController = createRequire(import.meta.url);
  const miniflareModulePath = fromController.resolve("miniflare");
  const fromMiniflare = createRequire(miniflareModulePath);
  const undiciModulePath = fromMiniflare.resolve("undici");
  const undiciPackagePath = fromMiniflare.resolve("undici/package.json");
  const undici = fromMiniflare("undici");
  return {
    miniflareModulePath,
    miniflareModuleSha256: hash(await readFile(miniflareModulePath)),
    undiciModulePath,
    undiciModuleSha256: hash(await readFile(undiciModulePath)),
    undiciPackagePath,
    undiciVersion: JSON.parse(String(await readFile(undiciPackagePath))).version,
    undiciFetchIsNative: String(undici.fetch).includes("[native code]"),
    undiciFetchSha256: hash(String(undici.fetch)),
    node: process.version,
    nodeExecutablePath: process.execPath,
    nodeExecutableSha256: hash(await readFile(process.execPath)),
    bunPath,
    bunSha256: hash(await readFile(bunPath)),
    bunVersion: runContext.pinnedBunVersion ?? null,
    miniflare: await readVersion("node_modules/miniflare/package.json"),
    nestedWorkerdWrapper: await readVersion("node_modules/miniflare/node_modules/workerd/package.json"),
    rootWorkerdWrapper: await readVersion("node_modules/workerd/package.json"),
    miniflareWorkerdPathOverridePresent: Object.prototype.hasOwnProperty.call(process.env, "MINIFLARE_WORKERD_PATH"),
  };
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fieldNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}

function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSchemaAdmission(schema: SchemaRoute, expected: MigrationEntry[]): void {
  assert(JSON.stringify(schema.embedded) === JSON.stringify(expected),
    "production EMBEDDED_MIGRATIONS differs from the generated name/checksum set");
  const status = schema.status;
  assert(status.state === "ready" || status.state === "pending",
    `schema admission may not continue after applying/failed: ${JSON.stringify(status)}`);
  assert(status.ledgerTable === "_takos_opentofu_migrations" && status.total === expected.length &&
    Number.isInteger(status.applied) && status.applied >= 0 && status.applied <= expected.length,
    `schema admission counts/table are inconsistent: ${JSON.stringify(status)}`);
  assert(Array.isArray(schema.ledger) && schema.ledger.length === status.applied &&
    JSON.stringify(schema.ledger.map(({ name, checksum }) => ({ name, sha256: checksum }))) ===
      JSON.stringify(expected.slice(0, status.applied)),
    "native schema admission ledger is not the exact ordered embedded prefix");
  assert(JSON.stringify(status.pending) === JSON.stringify(expected.slice(status.applied).map(({ name }) => name)),
    "native schema admission pending names are not the exact embedded suffix");
  assert(!status.error && !status.failedMigration && schema.lock?.status === status.state &&
    schema.lock.holder === null && schema.lock.lease_expires_at === null,
    `schema admission did not release its migration claim: ${JSON.stringify({ status, lock: schema.lock })}`);
  if (status.state === "pending") {
    assert(status.applied > 0 && status.applied < expected.length && status.retryAfterSeconds === 5 &&
      schema.secondStatus === null && schema.ledgerAfterSecond.length === 0,
      "pending admission must show progress, retry hint 5, and no hidden second gate call");
  } else {
    assert(status.applied === expected.length, "ready admission omitted migrations");
  }
}

async function jsonResponse<T = Record<string, unknown>>(response: { status: number; text(): Promise<string> }): Promise<T> {
  const body = await response.text();
  try { return JSON.parse(body) as T; }
  catch { throw new Error(`response ${response.status} was not JSON: ${JSON.stringify(body)}`); }
}

function fixtureSource(): string {
  const notifier = JSON.stringify(join(root, "src/worker/runtime/durable-objects/run-notifier.ts"));
  const outbox = JSON.stringify(join(root, "src/worker/application/services/app-usage/run-projection-outbox.ts"));
  const schemaGate = JSON.stringify(join(root, "src/worker/platform/migrations/schema-gate.ts"));
  const migrationSet = JSON.stringify(join(root, "src/worker/platform/migrations/migration-set.ts"));
  const completeRun = JSON.stringify(join(root, "src/worker/application/services/agent/complete-run.ts"));
  return `import { RunNotifierDO } from ${notifier};
import { dispatchRunUsageProjectionOutbox } from ${outbox};
import { ensureSchemaReady } from ${schemaGate};
import { EMBEDDED_MIGRATIONS } from ${migrationSet};
import { completeRunAtomically } from ${completeRun};

const RUN_ID = ${JSON.stringify(runId)};
const OWNER_ID = ${JSON.stringify(ownerId)};
const WORKSPACE_ID = ${JSON.stringify(workspaceId)};
const THREAD_ID = ${JSON.stringify(threadId)};
const SERVICE_ID = ${JSON.stringify(serviceId)};
const LEASE_VERSION = 1;
const PROVIDER_SUB = ${JSON.stringify(providerSub)};
const TIMESTAMP = ${JSON.stringify(timestamp)};
function diagnosticError(error, depth = 0) {
  if (!(error instanceof Error)) return { type: typeof error, value: String(error) };
  const result = { name: error.name, message: error.message, stack: error.stack };
  if (depth < 3 && error.cause !== undefined) result.cause = diagnosticError(error.cause, depth + 1);
  else if (error.cause !== undefined) result.cause = String(error.cause);
  return result;
}
export class RunHarness extends RunNotifierDO {
  constructor(state, env) { super(state, env); this.proofInstanceId = crypto.randomUUID(); }
  async fetch(request) {
    if (new URL(request.url).pathname === "/__proof/instance") return Response.json({ instanceId: this.proofInstanceId });
    return super.fetch(request);
  }
}
const completionInput = {
  runId: RUN_ID, threadId: THREAD_ID, serviceId: SERVICE_ID, leaseVersion: LEASE_VERSION,
  status: "completed", usage: { inputTokens: 1000, outputTokens: 2000 },
  messages: [], terminalEvent: { status: "completed", source: "native-full-schema-proof" },
};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__proof/schema") {
      const first = await ensureSchemaReady(env.DB);
      let ledger = [];
      let triggerCatalog = [];
      if (first.ledgerTable) {
        try { ledger = (await env.DB.prepare("SELECT name, checksum, applied_at FROM _takos_opentofu_migrations ORDER BY rowid").all()).results; }
        catch (error) { return Response.json({ stage: "ledger-read", status: first, error: diagnosticError(error) }, { status: 599 }); }
      }
      try { triggerCatalog = (await env.DB.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).results; }
      catch (error) { return Response.json({ stage: "trigger-catalog-read", status: first, error: diagnosticError(error) }, { status: 599 }); }
      // Only prove the memoized ready/no-op path after a fully ready result.
      // A pending/failed first result must not trigger a second migration run.
      const second = first.state === "ready" ? await ensureSchemaReady(env.DB) : null;
      let ledgerAfterSecond = [];
      if (second?.ledgerTable) ledgerAfterSecond = (await env.DB.prepare("SELECT name, checksum, applied_at FROM _takos_opentofu_migrations ORDER BY rowid").all()).results;
      const lock = await env.DB.prepare("SELECT status, holder, lease_expires_at FROM _takos_runtime_migration_lock WHERE id = 1").first();
      return Response.json({ status: first, secondStatus: second, embedded: EMBEDDED_MIGRATIONS.map((entry) => ({ name: entry.name, sha256: entry.sha256 })), ledger, ledgerAfterSecond, triggerCatalog, lock });
    }
    if (url.pathname === "/__proof/complete") {
      try { return Response.json(await completeRunAtomically(env.DB, completionInput)); }
      catch (error) { return Response.json({ error: diagnosticError(error) }, { status: 599 }); }
    }
    if (url.pathname === "/__proof/dispatch") {
      try {
        const proofNow = url.searchParams.get("now") || TIMESTAMP;
        const completed = await dispatchRunUsageProjectionOutbox(env, { now: proofNow, staleBefore: proofNow, limit: 1 });
        return Response.json({ completed });
      } catch (error) {
        return Response.json({ dispatcherError: diagnosticError(error) }, { status: 599 });
      }
    }
    if (url.pathname === "/__proof/readbacks") {
      try {
        const witnessId = url.searchParams.get("witnessId");
        const counts = {
          events: await env.DB.prepare("SELECT COUNT(*) AS count FROM app_usage_events").first("count"),
          rollups: await env.DB.prepare("SELECT COUNT(*) AS count FROM app_usage_rollups").first("count"),
          assertions: await env.DB.prepare("SELECT COUNT(*) AS count FROM run_usage_projection_assertions").first("count"),
        };
        const outbox = await env.DB.prepare("SELECT delivery_status, attempts, projected_revision, last_error FROM run_usage_projection_outbox WHERE id = ?").bind(witnessId).first();
        const events = await env.DB.prepare("SELECT idempotency_key, owner_account_id, scope_type, space_id, meter_type, units, reference_id, reference_type, created_at FROM app_usage_events WHERE reference_id = ? ORDER BY meter_type").bind(RUN_ID).all();
        const rollups = await env.DB.prepare("SELECT owner_account_id, scope_type, scope_id, space_id, meter_type, period_start, units FROM app_usage_rollups WHERE scope_id = ? ORDER BY meter_type").bind(WORKSPACE_ID).all();
        return Response.json({ counts, outbox, events: events.results, rollups: rollups.results });
      } catch (error) { return Response.json({ error: diagnosticError(error) }, { status: 599 }); }
    }
    if (url.pathname === "/__proof/instance") {
      const stub = env.RUN_NOTIFIER.get(env.RUN_NOTIFIER.idFromName(RUN_ID));
      return stub.fetch("http://internal/__proof/instance");
    }
    if (url.pathname.startsWith("/__proof/notifier/")) {
      const stub = env.RUN_NOTIFIER.get(env.RUN_NOTIFIER.idFromName(RUN_ID));
      const target = new URL(request.url);
      target.hostname = "internal";
      target.pathname = target.pathname.slice("/__proof/notifier".length) || "/";
      return stub.fetch(new Request(target, request));
    }
    return new Response("proof route not found", { status: 404 });
  },
};
`;
}

const staticSourcePaths = [
  "src/worker/application/services/app-usage/usage-recorder.ts",
  "src/worker/application/services/app-usage/run-projection-outbox.ts",
  "src/worker/application/services/agent/complete-run.ts",
  "src/worker/application/services/identity/owner-admission.ts",
  "src/worker/runtime/durable-objects/run-notifier.ts",
  "src/worker/runtime/durable-objects/run-notifier-journal-state.ts",
  "src/worker/runtime/durable-objects/notifier-base.ts",
  "src/worker/runtime/durable-objects/notifier-journal.ts",
  "src/worker/runtime/durable-objects/run-receipt-index.ts",
  "src/worker/runtime/durable-objects/run-receipt-maintenance.ts",
  "src/worker/runtime/durable-objects/run-archive-index.ts",
  "src/worker/runtime/durable-objects/run-archive-maintenance.ts",
  "src/worker/runtime/durable-objects/run-usage-ledger.ts",
  "src/worker/infra/db/schema-app-usage.ts",
  "src/worker/infra/db/schema-accounts.ts",
  "src/worker/infra/db/schema-agents.ts",
  "src/worker/infra/db/client.ts",
  "src/worker/platform/migrations/schema-gate.ts",
  "src/worker/platform/migrations/runtime-migrations.ts",
  "src/worker/platform/migrations/migration-set.ts",
  "src/worker/platform/migrations/migration-set.generated.json",
  "src/worker/local-platform/d1-sql-rewrite.ts",
  "src/worker/shared/types/bindings.ts",
  "deploy/cloudflare/wrangler.toml",
  "db/migrations-control/migrations/0110_run_usage_projection_outbox.sql",
];

async function currentSourcePaths(): Promise<{ paths: string[]; migrations: MigrationEntry[] }> {
  const generated = JSON.parse(String(await readFile(join(root, migrationSetPath)))) as SourceManifest;
  assert(Array.isArray(generated.entries) && generated.entries.length > 0,
    "generated embedded migration set is missing or empty");
  assert(generated.entries.some((entry) => entry.name === "0011_services_schema_cutover.sql"), "embedded set omits migration 0011");
  assert(generated.entries.some((entry) => entry.name === "0016_workers_deployments_fk_repair.sql"), "embedded set omits migration 0016");
  assert(generated.entries.some((entry) => entry.name === "0110_run_usage_projection_outbox.sql"), "embedded set omits migration 0110");
  const migrationSources = generated.entries.map((entry) => `db/migrations-control/migrations/${entry.name}`);
  return {
    paths: [...new Set([...staticSourcePaths, ...migrationSources])],
    migrations: generated.entries.map(({ name, sha256 }) => ({ name, sha256 })),
  };
}

async function snapshotProductionSources(paths: string[], migrations: MigrationEntry[]): Promise<SourceSnapshot> {
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    hashes[path] = hash(await readFile(join(root, path)));
  }
  for (const entry of migrations) {
    const path = `db/migrations-control/migrations/${entry.name}`;
    assert(hashes[path] === entry.sha256.replace(/^sha256:/u, ""),
      `embedded migration checksum does not match source bytes: ${entry.name}`);
  }
  return { hashes, migrations };
}

async function runProof(): Promise<NativeUsageProofReport> {
  runContext.startedEpochMs = Date.now();
  markStage("production-source-snapshot-start");
  const sourceInventory = await currentSourcePaths();
  sourcePaths = sourceInventory.paths;
  const sourceSnapshot = await snapshotProductionSources(sourcePaths, sourceInventory.migrations);
  runContext.sourceHashesBeforeRun = sourceSnapshot.hashes;
  const triggerMigrationSourceEvidence: Record<string, unknown> = {};
  for (const name of ["0011_services_schema_cutover.sql", "0016_workers_deployments_fk_repair.sql", "0018_drop_worker_binding_mirrors.sql", "0033_drop_legacy_worker_mirrors.sql"]) {
    const sourcePath = `db/migrations-control/migrations/${name}`;
    const sourceText = String(await readFile(join(root, sourcePath)));
    const creates = [...sourceText.matchAll(/\bCREATE\s+(?:TEMP\s+)?TRIGGER\b/giu)].length;
    const drops = [...sourceText.matchAll(/\bDROP\s+TRIGGER\b/giu)].length;
    triggerMigrationSourceEvidence[name] = { sourcePath, sha256: sourceSnapshot.hashes[sourcePath], creates, drops };
  }
  assert(fieldNumber(triggerMigrationSourceEvidence["0011_services_schema_cutover.sql"], "creates") === 7 &&
    fieldNumber(triggerMigrationSourceEvidence["0016_workers_deployments_fk_repair.sql"], "creates") === 3 &&
    fieldNumber(triggerMigrationSourceEvidence["0018_drop_worker_binding_mirrors.sql"], "drops") === 4 &&
    fieldNumber(triggerMigrationSourceEvidence["0033_drop_legacy_worker_mirrors.sql"], "drops") === 3,
    `trigger-bearing migration source differs from expected raw SQL structure: ${JSON.stringify(triggerMigrationSourceEvidence)}`);
  markStage("production-source-snapshot-complete", { sourceCount: sourcePaths.length, migrationCount: sourceSnapshot.migrations.length });
  const sourceHashesBeforeRun = sourceSnapshot.hashes;
  runContext.compatibilitySourceSha256 = sourceHashesBeforeRun["deploy/cloudflare/wrangler.toml"];
  const fixturePath = join(proofDir, "fixture-worker.ts");
  const buildDir = join(proofDir, "bundle");
  const persistDir = join(proofDir, "native-state");
  runContext.ownedBundlePath = buildDir;
  runContext.ownedNativeStatePath = persistDir;
  await mkdir(buildDir, { recursive: true });
  await writeFile(fixturePath, fixtureSource());
  markStage("fixture-worker-written");
  let mf: Miniflare | undefined;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let reportOutput: NativeUsageProofReport | null = null;
  markStage("native-watchdog-armed", { internalWatchdogMs: 70000, outerTimeoutMs: 75000 });
  const watchdog = setTimeout(() => {
    runContext.preserveOwnedStateOnFailure = true;
    runContext.failureRetentionPolicy = "70-second controller watchdog; preserve fresh isolated bundle/native-state for parent inspection";
    markStage("native-watchdog-expired");
    process.stderr.write("native terminal usage D1 proof exceeded 70-second deadline\n");
    const failure = {
      at: new Date().toISOString(),
      error: "native terminal usage D1 proof exceeded 70-second deadline",
      sourceHashesBeforeRun: runContext.sourceHashesBeforeRun ?? null,
      fullSchemaGateResponse: runContext.fullSchemaGateResponse ?? null,
      schemaAdmissionRequests: runContext.schemaAdmissionRequests ?? null,
      continuationWaitMs: runContext.continuationWaitMs ?? null,
      runtimePackages: runContext.runtimePackages ?? null,
      stages: runContext.stages,
      failureRetentionPolicy: runContext.failureRetentionPolicy,
    };
    void writeFile(join(proofDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`)
      .catch((error: unknown) => process.stderr.write(`watchdog failure record write failed: ${String(error)}\n`));
    void mf?.dispose().finally(() => process.exit(124));
    setTimeout(() => process.exit(124), 2_000).unref();
  }, 70_000);
  try {
    const built = await buildFixture(fixturePath, buildDir);
    runContext.pinnedBunVersion = built.bunVersion;
    assert(built.compatibilityConfigSha256 === runContext.compatibilitySourceSha256,
      "Wrangler compatibility config changed between source snapshot and fixture build");
    assert(built.success && built.outputs.length === 1,
      `fixture bundle failed: ${built.logs.map(String).join("; ")}`);
    const script = await readFile(built.outputs[0]!.path, "utf8");
    markStage("fixture-bundle-built");
    const bundleInputs = built.metafile?.inputs;
    assert(isRecord(bundleInputs) && Object.keys(bundleInputs).length > 0,
      "Bun.build metafile has no inputs; refusing to claim build-input provenance");
    const bundleHashes: Record<string, { resolvedPath: string; sha256: string }> = {};
    for (const inputPath of Object.keys(bundleInputs).sort()) {
      const resolvedPath = resolve(root, inputPath);
      bundleHashes[inputPath] = { resolvedPath, sha256: hash(await readFile(resolvedPath)) };
    }
    const d1Name = `native-${runId}`;
    mf = new Miniflare({
      name: miniflareName,
      log: new StderrLog(LogLevel.INFO),
      modules: true,
      script,
      scriptPath: built.outputs[0]!.path,
      compatibilityDate: built.compatibilityDate,
      compatibilityFlags: built.compatibilityFlags,
      bindings: {
        OIDC_ISSUER_URL: "https://issuer.example",
        OIDC_OWNER_SUBJECT: "operator-owner",
      },
      durableObjects: { RUN_NOTIFIER: { className: "RunHarness", useSQLite: false } },
      durableObjectsPersist: join(persistDir, "do"),
      d1Databases: { DB: d1Name },
      d1Persist: join(persistDir, "d1"),
      r2Buckets: { TAKOS_OFFLOAD: d1Name },
      r2Persist: join(persistDir, "r2"),
      host: "127.0.0.1",
    });
    markStage("miniflare-ready-await-start");
    await mf.ready;
    markStage("miniflare-ready");
    const db = await mf.getD1Database("DB") as unknown as NativeD1;
    markStage("initial-host-d1-proxy-acquired");
    assert(typeof db.prepare === "function" && typeof db.batch === "function" &&
      typeof db.exec === "function", "Miniflare getD1Database did not expose native D1 methods");
    markStage("native-full-schema-production-gate-start", { defaultBudgetMs: 20000, admissionRequest: 1 });
    const schemaResponse = await mf.dispatchFetch("http://localhost/__proof/schema");
    let schema = await jsonResponse<SchemaRoute & Record<string, unknown>>(schemaResponse);
    runContext.fullSchemaGateResponse = schema;
    markStage("native-full-schema-production-gate-returned", {
      httpStatus: schemaResponse.status,
      state: schema.status?.state,
      applied: schema.status?.applied,
      total: schema.status?.total,
    });
    const expectedMigrations = sourceSnapshot.migrations;
    assert(schemaResponse.status === 200, `production schema gate route failed: ${JSON.stringify(schema)}`);
    const admissionRequests: SchemaAdmissionRecord[] = [{
      httpStatus: schemaResponse.status, status: schema.status, ledgerRows: schema.ledger,
      lock: schema.lock, observedAt: new Date().toISOString(),
    }];
    runContext.schemaAdmissionRequests = admissionRequests;
    validateSchemaAdmission(schema, expectedMigrations);
    let continuationWaitMs = 0;
    if (schema.status.state === "pending") {
      const previousLedger = schema.ledger;
      const waitStarted = performance.now();
      const resumeAfter = waitStarted + schema.status.retryAfterSeconds! * 1000;
      markStage("native-schema-pending-continuation-wait-start", { retryAfterSeconds: 5 });
      // Honor the production retry hint in real host time. These waits issue
      // no requests; there is at most one explicit continuation admission.
      while (performance.now() < resumeAfter) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, Math.ceil(resumeAfter - performance.now())));
      }
      continuationWaitMs = performance.now() - waitStarted;
      runContext.continuationWaitMs = continuationWaitMs;
      markStage("native-schema-pending-continuation-request", { admissionRequest: 2, continuationWaitMs });
      const continuedResponse = await mf.dispatchFetch("http://localhost/__proof/schema");
      schema = await jsonResponse<SchemaRoute & Record<string, unknown>>(continuedResponse);
      runContext.fullSchemaGateResponse = schema;
      assert(continuedResponse.status === 200, `schema continuation route failed: ${JSON.stringify(schema)}`);
      admissionRequests.push({
        httpStatus: continuedResponse.status, status: schema.status, ledgerRows: schema.ledger,
        lock: schema.lock, observedAt: new Date().toISOString(),
      });
      validateSchemaAdmission(schema, expectedMigrations);
      assert(schema.ledger.length > previousLedger.length &&
        JSON.stringify(schema.ledger.slice(0, previousLedger.length)) === JSON.stringify(previousLedger),
        "schema continuation did not grow the ledger while preserving every prior name/checksum/applied_at");
      markStage("native-schema-pending-continuation-returned", {
        state: schema.status.state, applied: schema.status.applied, total: schema.status.total,
      });
    }
    const schemaStatus = schema.status;
    assert(schemaStatus.state === "ready",
      `production schema gate is not ready after at most two default-budget admissions; no further request: ${JSON.stringify(schemaStatus)}`);
    assert(schemaStatus?.ledgerTable === "_takos_opentofu_migrations",
      `production schema gate reported unexpected ledger table: ${JSON.stringify(schemaStatus?.ledgerTable)}`);
    assert(schemaStatus?.state === "ready" && schemaStatus.applied === expectedMigrations.length &&
      schemaStatus.total === expectedMigrations.length && schemaStatus.pending?.length === 0,
      `production default-budget schema admissions did not finish the full embedded set: ${JSON.stringify(schemaStatus)}`);
    const ledgerRows = schema.ledger;
    assert(Array.isArray(ledgerRows) && ledgerRows.length === expectedMigrations.length,
      `native D1 migration ledger row count mismatch: ${ledgerRows?.length} != ${expectedMigrations.length}`);
    assert(JSON.stringify(ledgerRows.map(({ name, checksum }) => ({ name, sha256: checksum }))) === JSON.stringify(expectedMigrations),
      "native D1 ledger does not match the full generated set in contiguous insertion order");
    assert(JSON.stringify(schema.ledgerAfterSecond) === JSON.stringify(schema.ledger),
      "second cached production ensureSchemaReady call changed the native D1 migration ledger");
    const secondStatus = schema.secondStatus;
    assert(secondStatus?.state === "ready" && secondStatus.applied === expectedMigrations.length,
      `second production ensureSchemaReady call was not ready/no-op: ${JSON.stringify(secondStatus)}`);
    const triggerCatalogAfterMigrations = schema.triggerCatalog;
    assert(Array.isArray(triggerCatalogAfterMigrations), "native sqlite_master trigger catalog read failed");
    for (const required of ["0011_services_schema_cutover.sql", "0016_workers_deployments_fk_repair.sql", "0018_drop_worker_binding_mirrors.sql", "0033_drop_legacy_worker_mirrors.sql", "0110_run_usage_projection_outbox.sql"])
      assert(expectedMigrations.some((entry) => entry.name === required), `production migration set omitted ${required}`);
    assert(triggerCatalogAfterMigrations.length === 0,
      `full migration replay should leave no user-defined SQL triggers: ${JSON.stringify(triggerCatalogAfterMigrations)}`);

    markStage("full-schema-minimal-owner-seed-start");
    await db.prepare(`INSERT INTO accounts
      (id, type, status, name, slug, owner_account_id, created_at, updated_at)
      VALUES (?, 'user', 'active', 'Operator Owner', ?, ?, ?, ?)`)
      .bind(ownerId, ownerId, ownerId, timestamp, timestamp).run();
    await db.prepare(`INSERT INTO auth_identities
      (id, user_id, provider, provider_sub, linked_at, last_login_at)
      VALUES (?, ?, 'oidc', ?, ?, ?)`)
      .bind(`${runId}-owner-oidc`, ownerId, providerSub, timestamp, timestamp).run();
    await db.prepare(`INSERT INTO accounts
      (id, type, status, name, slug, owner_account_id, created_at, updated_at)
      VALUES (?, 'team', 'active', 'Private Workspace', ?, ?, ?, ?)`)
      .bind(workspaceId, workspaceId, ownerId, timestamp, timestamp).run();
    await db.prepare(`INSERT INTO account_settings (account_id, private_account, created_at, updated_at)
      VALUES (?, 1, ?, ?)`)
      .bind(workspaceId, timestamp, timestamp).run();
    await db.prepare(`INSERT INTO threads (id, account_id, title, created_at, updated_at)
      VALUES (?, ?, 'Native full schema usage proof', ?, ?)`)
      .bind(threadId, workspaceId, timestamp, timestamp).run();
    await db.prepare(`INSERT INTO runs
      (id, thread_id, account_id, requester_account_id, agent_type, model, status, input, usage,
       service_id, lease_version, created_at)
      VALUES (?, ?, ?, ?, 'default', 'gpt-local', 'running', '{}', '{}', ?, 1, ?)`)
      .bind(runId, threadId, workspaceId, ownerId,
        serviceId, timestamp).run();
    const authorityBeforeProjection = {
      accounts: (await db.prepare(`SELECT id, type, status, name, slug, owner_account_id FROM accounts WHERE id IN (?, ?) ORDER BY id`)
        .bind(ownerId, workspaceId).all()).results,
      identities: (await db.prepare(`SELECT id, user_id, provider, provider_sub, linked_at, last_login_at FROM auth_identities WHERE id = ?`)
        .bind(`${runId}-owner-oidc`).all()).results,
      workspaceSettings: (await db.prepare(`SELECT account_id, private_account FROM account_settings WHERE account_id = ?`)
        .bind(workspaceId).all()).results,
    };
    assert(authorityBeforeProjection.accounts.length === 2 &&
      authorityBeforeProjection.accounts.some((account) => account.id === ownerId && account.type === "user") &&
      authorityBeforeProjection.accounts.some((account) => account.id === workspaceId && account.type === "team" && account.owner_account_id === ownerId) &&
      authorityBeforeProjection.identities.length === 1 &&
      authorityBeforeProjection.identities[0]?.provider_sub === providerSub &&
      authorityBeforeProjection.workspaceSettings.length === 1 &&
      authorityBeforeProjection.workspaceSettings[0]?.private_account === 1,
      `minimal full-schema seed did not establish the exact owner/OIDC/private-workspace authority: ${JSON.stringify(authorityBeforeProjection)}`);
    const witnessFailureTrigger = "native_full_schema_reject_witness_20261001";
    await db.prepare(`CREATE TRIGGER ${witnessFailureTrigger}
      BEFORE INSERT ON run_usage_projection_outbox
      BEGIN SELECT RAISE(ABORT, 'native full-schema proof injected witness failure'); END`).run();
    const faultTriggerCatalog = await db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .bind(witnessFailureTrigger).all();
    assert(faultTriggerCatalog.results.length === 1,
      "native SQL trigger was not visible in the actual sqlite_master trigger catalog");
    const terminalFaultResponse = await mf.dispatchFetch("http://localhost/__proof/complete", { method: "POST" });
    const terminalFault = await jsonResponse(terminalFaultResponse);
    assert(terminalFaultResponse.status === 599 && terminalFault.error,
      `injected witness trigger did not reject production completeRunAtomically: ${JSON.stringify(terminalFault)}`);
    const terminalFaultMessage = terminalFault.error && typeof terminalFault.error === "object"
      ? (terminalFault.error as Record<string, unknown>).message : undefined;
    assert(typeof terminalFaultMessage === "string" &&
      terminalFaultMessage.includes("native full-schema proof injected witness failure") &&
      terminalFaultMessage.includes("SQLITE_CONSTRAINT_TRIGGER"),
      `terminal rollback did not report the exact injected native witness failure: ${JSON.stringify(terminalFault)}`);
    const rejectedRun = await db.prepare("SELECT status, completion_key, usage FROM runs WHERE id = ?")
      .bind(runId).first<{ status: string; completion_key: string | null; usage: string }>();
    const rejectedWitnesses = await db.prepare("SELECT id FROM run_usage_projection_outbox WHERE run_id = ?").bind(runId).all();
    const rejectedTerminalEvents = await db.prepare("SELECT id FROM run_events WHERE run_id = ?").bind(runId).all();
    assert(rejectedRun?.status === "running" && rejectedRun.completion_key == null && rejectedRun.usage === "{}" &&
      rejectedWitnesses.results.length === 0 && rejectedTerminalEvents.results.length === 0,
      `failed native terminal batch partially committed Run/event/witness: ${JSON.stringify({ rejectedRun, witnesses: rejectedWitnesses.results, terminalEvents: rejectedTerminalEvents.results })}`);
    await db.prepare(`DROP TRIGGER ${witnessFailureTrigger}`).run();
    const triggerCatalogAfterTerminalFaultCleanup = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    assert(triggerCatalogAfterTerminalFaultCleanup.results.length === 0, "terminal-fault trigger cleanup left a user-defined SQL trigger");
    const terminalResponse = await mf.dispatchFetch("http://localhost/__proof/complete", { method: "POST" });
    const terminal = await jsonResponse(terminalResponse);
    assert(terminalResponse.status === 200 && terminal.committed === true && terminal.idempotent === false &&
      typeof terminal.completionKey === "string",
      `production completeRunAtomically retry did not commit: ${JSON.stringify(terminal)}`);
    const completedRun = await db.prepare("SELECT status, completion_key, usage, service_id, lease_version FROM runs WHERE id = ?").bind(runId).first();
    const completedWitnesses = await db.prepare(`SELECT id, run_id, completion_key, run_status, workspace_id,
      owner_account_id, delivery_status, attempts FROM run_usage_projection_outbox WHERE run_id = ?`).bind(runId).all();
    const committedTerminalEvents = await db.prepare("SELECT id, type, event_key FROM run_events WHERE run_id = ?").bind(runId).all();
    assert(completedRun?.status === "completed" && completedRun.completion_key === terminal.completionKey &&
      completedRun.usage === JSON.stringify({ inputTokens: 1000, outputTokens: 2000 }) &&
      committedTerminalEvents.results.length === 1 &&
      completedWitnesses.results.length === 1 && completedWitnesses.results[0]?.id === `run-usage-projection:${terminal.completionKey}` &&
      completedWitnesses.results[0]?.run_status === "completed" && completedWitnesses.results[0]?.workspace_id === workspaceId &&
      completedWitnesses.results[0]?.owner_account_id === ownerId && completedWitnesses.results[0]?.delivery_status === "queued",
      `production terminal commit did not create one owner-bound queued witness: ${JSON.stringify({ completedRun, witnesses: completedWitnesses.results })}`);
    const witnessId = `run-usage-projection:${terminal.completionKey}`;
    const terminalRepeatResponse = await mf.dispatchFetch("http://localhost/__proof/complete", { method: "POST" });
    const terminalRepeat = await jsonResponse(terminalRepeatResponse);
    const repeatTerminalEvents = await db.prepare("SELECT id, type, event_key FROM run_events WHERE run_id = ?").bind(runId).all();
    const repeatWitnesses = await db.prepare("SELECT id, completion_key, owner_account_id, delivery_status FROM run_usage_projection_outbox WHERE run_id = ?").bind(runId).all();
    assert(terminalRepeatResponse.status === 200 && terminalRepeat.committed === true && terminalRepeat.idempotent === true &&
      terminalRepeat.completionKey === terminal.completionKey && repeatTerminalEvents.results.length === 1 &&
      repeatWitnesses.results.length === 1 && repeatWitnesses.results[0]?.id === witnessId &&
      repeatWitnesses.results[0]?.delivery_status === "queued",
      `repeat production completeRunAtomically call was not idempotent with one event/witness: ${JSON.stringify({ terminalRepeat, events: repeatTerminalEvents.results, witnesses: repeatWitnesses.results })}`);
    assert(JSON.stringify({
      accounts: (await db.prepare(`SELECT id, type, status, name, slug, owner_account_id FROM accounts WHERE id IN (?, ?) ORDER BY id`).bind(ownerId, workspaceId).all()).results,
      identities: (await db.prepare(`SELECT id, user_id, provider, provider_sub, linked_at, last_login_at FROM auth_identities WHERE id = ?`).bind(`${runId}-owner-oidc`).all()).results,
      workspaceSettings: (await db.prepare(`SELECT account_id, private_account FROM account_settings WHERE account_id = ?`).bind(workspaceId).all()).results,
    }) === JSON.stringify(authorityBeforeProjection), "terminal CAS/witness changed owner, OIDC, or workspace authority rows");
    const d1Before = await db.prepare("SELECT COUNT(*) AS count FROM app_usage_events").first("count");
    markStage("schema-ready-terminal-witness-committed-clean-count-confirmed", {
      migrationCount: expectedMigrations.length, terminalWitnessCount: completedWitnesses.results.length,
    });
    assert(Number(d1Before) === 0, `fixture did not start clean: event count ${d1Before}`);
    const markerBefore = await jsonResponse(await mf.dispatchFetch("http://localhost/__proof/instance"));
    assert(typeof markerBefore.instanceId === "string", "initial native DO marker missing");
    await mf.unsafeEvictDurableObject(
      miniflareName, "RunHarness", { name: runId },
    );
    const markerAfterEviction = await jsonResponse(await mf.dispatchFetch("http://localhost/__proof/instance"));
    assert(markerBefore.instanceId !== markerAfterEviction.instanceId,
      "test-only native RunNotifier wrapper instance marker did not change after native eviction");

    const runtimePackages = await packageProvenance();
    runContext.runtimePackages = runtimePackages;
    runContext.workerdBeforeFault = await snapshotOwnedWorkerd("before-injected-trigger-dispatch");
    assert(runContext.workerdBeforeFault.workerdChildren.length > 0 &&
      runContext.workerdBeforeFault.workerdChildren.some((child) =>
        typeof child.exePath === "string" && typeof child.exeSha256 === "string" &&
        isRecord(child.version) && typeof child.version.stdout === "string"),
      `could not capture an actual owned workerd executable path/hash/version: ${JSON.stringify(runContext.workerdBeforeFault)}`);
    markStage("creating-native-trigger-fault");
    await db.prepare(`CREATE TRIGGER native_proof_fail_output
      BEFORE INSERT ON app_usage_events
      WHEN NEW.meter_type = 'llm_tokens_output'
      BEGIN SELECT RAISE(ABORT, 'native proof injected output meter failure'); END`).run();
    let faultResponse: { status: number; body: Record<string, unknown> } | null = null;
    let faultTransportError: string | null = null;
    try {
      const response = await mf.dispatchFetch("http://localhost/__proof/dispatch", { method: "POST" });
      faultResponse = { status: response.status, body: await jsonResponse(response) };
      assert(response.status === 200 && faultResponse.body.completed === 0,
        `injected meter fault was unexpectedly acknowledged: ${JSON.stringify(faultResponse)}`);
      markStage("fault-dispatch-returned", { status: response.status, completed: faultResponse.body.completed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert(message.includes("socket connection was closed unexpectedly"),
        `unexpected native fault transport error: ${message}`);
      faultTransportError = message;
      markStage("fault-dispatch-transport-closed", { error: message });
    }
    let faultEvents: unknown;
    try {
      markStage("first-post-fault-host-d1-readback-start");
      faultEvents = await db.prepare("SELECT COUNT(*) AS count FROM app_usage_events").first("count");
      markStage("first-post-fault-host-d1-readback-succeeded");
    } catch (originalError) {
      runContext.preserveOwnedStateOnFailure = true;
      runContext.originalHostReadbackError = structuredError(originalError);
      markStage("first-post-fault-host-d1-readback-failed", { error: structuredError(originalError) });
      await checkpointReadbackDiagnostics("original-host-error-before-runtime-snapshot");
      try { runContext.workerdOnReadbackFailure = await snapshotOwnedWorkerd("host-d1-readback-failure"); }
      catch (snapshotError) { runContext.workerdOnReadbackFailureError = structuredError(snapshotError); }
      if (runContext.workerdOnReadbackFailure) {
        const faultPids = new Set(runContext.workerdBeforeFault?.workerdChildren.map((child) => child.pid) ?? []);
        const failurePids = new Set(runContext.workerdOnReadbackFailure.workerdChildren.map((child) => child.pid));
        runContext.workerdBeforeFaultPidsMissingOnFailure = [...faultPids].filter((pid) => !failurePids.has(pid));
      }
      const diagnostics: Record<string, unknown> = {
        startedAt: new Date().toISOString(),
        workerNativeD1Readbacks: { status: "not-started" },
        freshHostD1Proxy: { status: "not-started", obtainedVia: "a new Miniflare.getD1Database(DB) call" },
      };
      runContext.readbackDiagnostics = diagnostics;
      await checkpointReadbackDiagnostics("before-diagnostic-probes");
      try {
        markStage("worker-native-d1-readbacks-probe-start");
        const response = await mf!.dispatchFetch(`http://localhost/__proof/readbacks?witnessId=${encodeURIComponent(witnessId)}`);
        diagnostics.workerNativeD1Readbacks = { status: response.status, body: await jsonResponse(response) };
        markStage("worker-native-d1-readbacks-probe-finished", { status: response.status });
      } catch (probeError) {
        diagnostics.workerNativeD1Readbacks = { error: structuredError(probeError) };
        markStage("worker-native-d1-readbacks-probe-failed", { error: structuredError(probeError) });
      }
      await checkpointReadbackDiagnostics("after-worker-native-d1-probe");

      const freshProxy: Record<string, unknown> = {
        status: "acquiring",
        obtainedVia: "a new Miniflare.getD1Database(DB) call",
      };
      diagnostics.freshHostD1Proxy = freshProxy;
      try {
        markStage("fresh-host-d1-proxy-probe-start");
        const freshDb = await mf!.getD1Database("DB") as unknown as NativeD1;
        freshProxy.status = "acquired";
        freshProxy.sameObjectAsOriginalProxy = freshDb === db;
        await checkpointReadbackDiagnostics("after-fresh-host-proxy-acquired");
        freshProxy.select1 = await freshDb.prepare("SELECT 1 AS value").first("value");
        freshProxy.status = "select1-succeeded";
        await checkpointReadbackDiagnostics("after-fresh-host-proxy-select1");
        freshProxy.eventCount = await freshDb.prepare("SELECT COUNT(*) AS count FROM app_usage_events").first("count");
        freshProxy.status = "complete";
        markStage("fresh-host-d1-proxy-probe-finished");
      } catch (probeError) {
        freshProxy.status = "failed";
        freshProxy.error = structuredError(probeError);
        markStage("fresh-host-d1-proxy-probe-failed", { error: structuredError(probeError) });
      }
      await checkpointReadbackDiagnostics("after-fresh-host-proxy-probe");
      runContext.readbackDiagnostics = diagnostics;
      markStage("rethrow-original-host-readback-error");
      throw originalError;
    }
    const faultRollups = await db.prepare("SELECT COUNT(*) AS count FROM app_usage_rollups").first("count");
    const faultAssertions = await db.prepare("SELECT COUNT(*) AS count FROM run_usage_projection_assertions").first("count");
    const faultOutbox = await db.prepare(`SELECT delivery_status, attempts, projected_revision, last_error
      FROM run_usage_projection_outbox WHERE id = ?`).bind(witnessId).first();
    markStage("host-rollback-readbacks-complete");
    assert(Number(faultEvents) === 0 && Number(faultRollups) === 0 &&
      Number(faultAssertions) === 0 && faultOutbox?.delivery_status === "queued" &&
      Number(faultOutbox.attempts) === 1 && faultOutbox?.projected_revision == null &&
      typeof faultOutbox.last_error === "string" &&
      faultOutbox.last_error.includes("native proof injected output meter failure"),
      `native failed batch left a partial usage write or logical ACK: ${JSON.stringify({
        events: faultEvents, rollups: faultRollups, assertions: faultAssertions,
        outbox: faultOutbox })}`);
    await db.prepare("DROP TRIGGER native_proof_fail_output").run();
    const triggersAfterFaultCleanup = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    assert(triggersAfterFaultCleanup.results.length === 0, `proof left an unexpected SQL trigger behind: ${JSON.stringify(triggersAfterFaultCleanup.results)}`);
    await mf.unsafeEvictDurableObject(
      miniflareName, "RunHarness", { name: runId },
    );
    const coldMarker = await jsonResponse(await mf.dispatchFetch("http://localhost/__proof/instance"));
    assert(coldMarker.instanceId !== markerAfterEviction.instanceId &&
      coldMarker.instanceId !== markerBefore.instanceId,
      "native DO third instance marker was not distinct after the second eviction");
    const retryNow = "2030-01-01T00:00:00.000Z";
    const dispatchResponse = await mf.dispatchFetch(
      `http://localhost/__proof/dispatch?now=${encodeURIComponent(retryNow)}`,
      { method: "POST" });
    const dispatchBody = await jsonResponse(dispatchResponse);
    markStage("cold-retry-dispatch-returned", { status: dispatchResponse.status, completed: dispatchBody.completed });
    assert(dispatchResponse.status === 200 && dispatchBody.completed === 1,
      `native outbox dispatch did not complete: ${dispatchResponse.status} ${JSON.stringify(dispatchBody)}`);
    const eventRows = await db.prepare(`SELECT idempotency_key, owner_account_id, scope_type,
      space_id, meter_type, units, reference_id, reference_type, created_at
      FROM app_usage_events WHERE reference_id = ? ORDER BY meter_type`)
      .bind(runId).all();
    const rollupRows = await db.prepare(`SELECT owner_account_id, scope_type, scope_id, space_id,
      meter_type, period_start, units FROM app_usage_rollups WHERE scope_id = ? ORDER BY meter_type`)
      .bind(workspaceId).all();
    const outbox = await db.prepare(`SELECT id, run_id, completion_key, run_status, workspace_id,
      owner_account_id, delivery_status, attempts, projected_revision, claim_token, claimed_at
      FROM run_usage_projection_outbox WHERE id = ?`).bind(witnessId).first<{
        id: string; run_id: string; completion_key: string; run_status: string; workspace_id: string;
        owner_account_id: string; delivery_status: string; attempts: number;
        projected_revision: number | null; claim_token: string | null; claimed_at: string | null;
      }>();
    assert(eventRows.results.length === 2 &&
      eventRows.results.every((row) => row.owner_account_id === ownerId && row.scope_type === "space" &&
        row.space_id === workspaceId && row.reference_id === runId && row.reference_type === "run") &&
      eventRows.results.some((row) => row.idempotency_key === `run:${runId}:llm_tokens_input` && row.units === 1) &&
      eventRows.results.some((row) => row.idempotency_key === `run:${runId}:llm_tokens_output` && row.units === 2),
      `expected exactly canonical input/output token rows: ${JSON.stringify(eventRows.results)}`);
    assert(rollupRows.results.length === 2 &&
      rollupRows.results.every((row) => row.owner_account_id === ownerId && row.scope_type === "space" &&
        row.scope_id === workspaceId && row.space_id === workspaceId) &&
      rollupRows.results.some((row) => row.meter_type === "llm_tokens_input" && row.units === 1) &&
      rollupRows.results.some((row) => row.meter_type === "llm_tokens_output" && row.units === 2),
      `expected exactly two owner-workspace rollups: ${JSON.stringify(rollupRows.results)}`);
    assert(outbox?.delivery_status === "done" && Number(outbox.attempts) === 2 &&
      outbox.projected_revision === 3 &&
      outbox.claim_token === null && outbox.claimed_at === null,
      `native outbox acknowledgement was not durable: ${JSON.stringify(outbox)}`);
    const finalCount = await db.prepare("SELECT COUNT(*) AS count FROM app_usage_events WHERE reference_id = ?")
      .bind(runId).first("count");
    assert(Number(finalCount) === 2, `unexpected duplicate event count: ${finalCount}`);
    const authorityAfterProjection = {
      accounts: (await db.prepare(`SELECT id, type, status, name, slug, owner_account_id FROM accounts WHERE id IN (?, ?) ORDER BY id`).bind(ownerId, workspaceId).all()).results,
      identities: (await db.prepare(`SELECT id, user_id, provider, provider_sub, linked_at, last_login_at FROM auth_identities WHERE id = ?`).bind(`${runId}-owner-oidc`).all()).results,
      workspaceSettings: (await db.prepare(`SELECT account_id, private_account FROM account_settings WHERE account_id = ?`).bind(workspaceId).all()).results,
    };
    assert(JSON.stringify(authorityAfterProjection) === JSON.stringify(authorityBeforeProjection),
      "usage projection/retry changed owner, OIDC, or workspace authority rows");

    const sourceHashesAfterRun: Record<string, string> = {};
    for (const path of sourcePaths) sourceHashesAfterRun[path] = hash(await readFile(join(root, path)));
    assert(JSON.stringify(sourceHashesAfterRun) === JSON.stringify(sourceHashesBeforeRun),
      "production source hashes changed during the native proof");
    const bundleInputHashesAfterRun: Record<string, { resolvedPath: string; sha256: string }> = {};
    for (const [inputPath, input] of Object.entries(bundleHashes)) {
      bundleInputHashesAfterRun[inputPath] = {
        resolvedPath: input.resolvedPath,
        sha256: hash(await readFile(input.resolvedPath)),
      };
    }
    assert(JSON.stringify(bundleInputHashesAfterRun) === JSON.stringify(bundleHashes),
      "a Bun.build metafile input changed after the bundle was produced");
    runContext.bundleInputHashes = bundleHashes;
    runContext.bundleInputHashesAfterRun = bundleInputHashesAfterRun;
    const proofSourceHashes = {
      "scripts/prove-run-usage-native.ts": hash(await readFile(scriptPath)),
      "scripts/lib/build-native-proof-fixture.ts": hash(await readFile(buildHelperPath)),
      "generated/fixture-worker.ts": hash(await readFile(fixturePath)),
    };
    markStage("native-proof-assertions-complete");
    reportOutput = {
      status: "passed",
      result: "NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK",
      outputDir: proofDir,
      elapsedMs: Date.now() - started,
      runtime: {
        host: "Node controller; Worker executes in native workerd",
        createdAt: startedAt,
        nodeVersion: process.version,
        nodeExecutablePath: process.execPath,
        runtimePackages,
        actualWorkerdBeforeFault: runContext.workerdBeforeFault?.workerdChildren ?? [],
        bunCompilerVersion: built.bunVersion,
        stages: runContext.stages,
      },
      migrationSet: {
        count: expectedMigrations.length,
        applied: schemaStatus.applied,
        defaultBudgetMs: 20000,
        admissionRequestLimit: 2,
        admissionRequests,
        initialStatus: admissionRequests[0]!.status,
        readyStatus: schemaStatus,
        continuedFromPending: admissionRequests.length === 2,
        continuationWaitMs,
        secondReadyNoopStatus: secondStatus,
        embeddedEntries: expectedMigrations,
        ledgerRows,
        ledgerOrderAndChecksumsMatchEmbeddedSet: true,
        secondCallLedgerUnchanged: true,
        finalTriggerCatalog: triggerCatalogAfterMigrations,
        generatedMigrationSetSource: migrationSetPath,
        generatedMigrationSetSha256: sourceHashesBeforeRun[migrationSetPath],
        allMigrationSqlSourcesSha256: Object.fromEntries(sourceSnapshot.migrations.map((entry) => {
          const path = `db/migrations-control/migrations/${entry.name}`;
          return [entry.name, sourceHashesBeforeRun[path]];
        })),
        triggerMigrationSourceEvidence,
        sourceOrigin: "production ensureSchemaReady(DB) uses default options; at most one recorded continuation after a validated pending prefix and retry hint, followed by a ready-only cache check; this fixture does not serve the production public HTTP gate",
      },
      terminalCompletion: {
        injectedWitnessTrigger: witnessFailureTrigger,
        failureResponse: terminalFault,
        failedRunReadback: rejectedRun,
        failedWitnessRows: rejectedWitnesses.results,
        failedTerminalEventRows: rejectedTerminalEvents.results,
        triggerVisibleInNativeSqliteMaster: faultTriggerCatalog.results,
        triggerCatalogAfterDrop: triggerCatalogAfterTerminalFaultCleanup.results,
        committedResponse: terminal,
        idempotentRepeatResponse: {
          ...terminalRepeat,
          idempotent: terminalRepeat.idempotent === true,
          completionKey: String(terminalRepeat.completionKey),
        },
        committedRun: completedRun,
        committedTerminalEvents: committedTerminalEvents.results,
        repeatedTerminalEvents: repeatTerminalEvents.results,
        repeatedWitnesses: repeatWitnesses.results,
        committedWitness: completedWitnesses.results[0],
        guarantee: "native D1 atomic completeRunAtomically failure leaves running Run and no witness; retry creates one completed Run and owner-bound queued witness",
      },
      authoritySnapshots: { beforeTerminal: authorityBeforeProjection, afterProjection: authorityAfterProjection, unchanged: true },
      injectedUsageRollback: {
        trigger: "native_proof_fail_output", faultResponse, faultTransportError,
        events: Number(faultEvents), rollups: Number(faultRollups),
        assertions: Number(faultAssertions), outbox: faultOutbox,
        guarantee: "SQL trigger aborts output meter; native D1 has zero usage writes and no logical outbox ACK",
      },
      nativeReplacement: {
        before: markerBefore, after: markerAfterEviction, afterFault: coldMarker,
        mechanism: "Miniflare.unsafeEvictDurableObject; test-only wrapper constructor instanceId",
      },
      retry: {
        response: { ...dispatchBody, completed: Number(dispatchBody.completed) },
        events: eventRows.results,
        rollups: rollupRows.results,
        outbox,
      },
      proofSourceHashes,
      sourceHashesBeforeRun,
      sourceHashesAfterRun,
      bundleInputHashes: bundleHashes,
      bundleInputHashesAfterRun,
      bundleSha256: hash(script),
      compatibility: {
        date: built.compatibilityDate,
        flags: built.compatibilityFlags,
        sourceSha256: built.compatibilityConfigSha256,
      },
      databaseBinding: "Miniflare.getD1Database(DB), native workerd D1; not @libsql/client",
    };
    runContext.failureRetentionPolicy = "preserve only the fresh isolated output directory on failure; success removes owned bundle and native state before writing result.json";
  } catch (error) {
    runContext.proofError = structuredError(error);
    runContext.preserveOwnedStateOnFailure = true;
    throw error;
  } finally {
    markStage("miniflare-dispose-start");
    clearTimeout(watchdog);
    try {
      await mf?.dispose();
      markStage("miniflare-disposed");
    } catch (disposeError) {
      runContext.disposeError = structuredError(disposeError);
      runContext.preserveOwnedStateOnFailure = true;
      markStage("miniflare-dispose-failed", { error: runContext.disposeError });
    }
    if (runContext.preserveOwnedStateOnFailure) {
      runContext.failureRetentionPolicy = "preserve the fresh isolated bundle/native-state after failure for parent inspection; parent owns later cleanup";
      markStage("owned-bundle-native-state-retained-for-failure-diagnostics");
    } else {
      await rm(persistDir, { recursive: true, force: true });
      await rm(buildDir, { recursive: true, force: true });
      markStage("owned-bundle-native-state-removed");
    }
  }
  assert(runContext.disposeError === undefined, `Miniflare disposal failed: ${JSON.stringify(runContext.disposeError)}`);
  assert(reportOutput !== null, "native proof reached cleanup without a success report");
  reportOutput.runtime = {
    ...reportOutput.runtime,
    stages: runContext.stages,
    cleanup: "Miniflare disposed; fresh owned native-state and bundle removed before result.json was written",
  };
  reportOutput.elapsedMs = Date.now() - started;
  await writeFile(join(proofDir, "result.json"), `${JSON.stringify(reportOutput)}\n`);
  process.stdout.write(`${JSON.stringify(reportOutput)}\n`);
  return reportOutput;
}

async function main(): Promise<void> {
  let outputOwned = false;
  try {
    const cli = parseCli(process.argv.slice(2));
    proofDir = cli.outputDir;
    bunPath = cli.bunPath;
    await mkdir(proofDir);
    outputOwned = true;
    runId = randomUUID();
    threadId = `thread-${runId}`;
    serviceId = `service-${runId}`;
    timestamp = new Date().toISOString();
    miniflareName = `native-usage-${runId}`;
    runContext.startedEpochMs = Date.now();
    markStage("fresh-output-directory-created", { runId, outputDir: proofDir });
    await runProof();
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    markStage("proof-failed", { error: structuredError(error) });
    if (outputOwned) {
      const failureSourceHashes: Record<string, string> = {};
      for (const path of sourcePaths) {
        try { failureSourceHashes[path] = hash(await readFile(join(root, path))); }
        catch { failureSourceHashes[path] = "unreadable"; }
      }
      let runtimePackages: Record<string, unknown> | null = runContext.runtimePackages ?? null;
      if (!runtimePackages) {
        try { runtimePackages = await packageProvenance(); }
        catch (provenanceError) { runtimePackages = { error: structuredError(provenanceError) }; }
      }
      const failure = {
        at: new Date().toISOString(),
        error: detail,
        structuredError: structuredError(error),
        failureSourceHashes,
        sourceHashesBeforeRun: runContext.sourceHashesBeforeRun ?? null,
        sourceHashesMatchPreRun: runContext.sourceHashesBeforeRun
          ? sourcePaths.every((path) => failureSourceHashes[path] === runContext.sourceHashesBeforeRun?.[path])
          : null,
        fullSchemaGateResponse: runContext.fullSchemaGateResponse ?? null,
        schemaAdmissionRequests: runContext.schemaAdmissionRequests ?? null,
        continuationWaitMs: runContext.continuationWaitMs ?? null,
        runtimePackages,
        stages: runContext.stages,
        workerdBeforeFault: runContext.workerdBeforeFault ?? null,
        workerdOnReadbackFailure: runContext.workerdOnReadbackFailure ?? null,
        workerdOnReadbackFailureError: runContext.workerdOnReadbackFailureError ?? null,
        miniflareDisposeError: runContext.disposeError ?? null,
        workerdBeforeFaultPidsMissingOnFailure: runContext.workerdBeforeFaultPidsMissingOnFailure ?? null,
        originalHostReadbackError: runContext.originalHostReadbackError ?? null,
        readbackDiagnostics: runContext.readbackDiagnostics ?? null,
        readbackDiagnosticCheckpointWriteErrors: runContext.checkpointWriteErrors ?? [],
        failureRetentionPolicy: runContext.failureRetentionPolicy ?? "retain fresh isolated output and any owned native state/bundle for parent inspection",
        retainedBundle: await directoryExists(runContext.ownedBundlePath),
        retainedNativeState: await directoryExists(runContext.ownedNativeStatePath),
      };
      try { await writeFile(join(proofDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`); }
      catch (writeError) { process.stderr.write(`failure record write failed: ${String(writeError)}\n`); }
    }
    process.stderr.write(`${detail}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
