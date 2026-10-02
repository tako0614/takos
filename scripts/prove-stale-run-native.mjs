#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Log, LogLevel, Miniflare } from "miniflare";
import { nativeStaleRunFixtureSource } from "./lib/native-stale-run-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  const name = args[i];
  const value = args[i + 1];
  if (!["--bun", "--output-dir"].includes(name) || !value || value.startsWith("--") || options.has(name)) throw new Error("usage: prove-stale-run-native.mjs --bun <pinned-bun> --output-dir <fresh-owned-dir>");
  options.set(name, value);
}
if (options.size !== 2) throw new Error("usage: prove-stale-run-native.mjs --bun <pinned-bun> --output-dir <fresh-owned-dir>");
const bunPath = resolve(options.get("--bun"));
const outputDir = resolve(options.get("--output-dir"));
if (!outputDir.startsWith(join(root, "tmp") + "/")) throw new Error("output directory must be freshly isolated under the owning checkout tmp/");
const ownedRoot = await realpath(root);
const ownedTmp = await realpath(join(root, "tmp"));
const outputParent = await realpath(dirname(outputDir));
if (ownedTmp !== join(ownedRoot, "tmp") || (outputParent !== ownedTmp && !outputParent.startsWith(ownedTmp + "/"))) throw new Error("output parent must resolve inside the owning checkout tmp/ without redirecting to another worktree");
await mkdir(outputDir, { recursive: false, mode: 0o700 });
const bundleDir = join(outputDir, "bundle");
const stateDir = join(outputDir, "native-state");
await mkdir(bundleDir, { mode: 0o700 });
const proofStarted = Date.now();
let mf;
let stage = "preflight";
let report;
let diagnosticEvidence = {};
let sourceHashesBeforeRun;
let bundleSha256;
const watchdog = setTimeout(() => {
  void (async () => {
    const diagnostic = { status: "failed", stage: stage ?? "watchdog", elapsedMs: Date.now() - proofStarted, error: "native stale Run proof exceeded its 70s inner bound", diagnosticEvidence, runtimeStateRetained: true };
    try { await writeFile(join(outputDir, "failure.json"), `${JSON.stringify(diagnostic, null, 2)}\n`, { flag: "wx", mode: 0o600 }); } catch {}
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    if (mf) { try { await Promise.race([mf.dispose(), new Promise((_, reject) => setTimeout(() => reject(new Error("Miniflare dispose exceeded watchdog cleanup window")), 1_000))]); mf = undefined; } catch (error) { diagnostic.disposeError = String(error); } }
    process.exitCode = 124;
  })();
}, 70_000);
const sourcePaths = [
  "src/worker/index.ts",
  "src/worker/runtime/worker/runtime-factory.ts",
  "src/worker/runtime/runner/cron-handler.ts",
  "src/worker/runtime/runner/queue-handler.ts",
  "src/worker/runtime/runner/runner-constants.ts",
  "src/worker/platform/migrations/schema-gate.ts",
  "src/worker/platform/migrations/migration-set.ts",
  "src/worker/platform/migrations/migration-set.generated.json",
  "deploy/cloudflare/wrangler.toml",
  "scripts/lib/native-stale-run-fixture.mjs",
  "scripts/prove-stale-run-native.mjs",
  "scripts/prove-stale-run-native.test.ts",
  "scripts/lib/build-native-proof-fixture.ts",
  "scripts/lib/native-container-proof-process.ts",
  "scripts/lib/native-container-proof-stop.py",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fileHash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
const captureHashes = async (paths) => Object.fromEntries(await Promise.all(paths.map(async (path) => [path, hash(await readFile(join(root, path)))])));
try {
  sourceHashesBeforeRun = await captureHashes(sourcePaths);
  const miniflareRequire = createRequire(import.meta.resolve("miniflare"));
  const miniflareModulePath = miniflareRequire.resolve("miniflare");
  const workerdWrapperMain = miniflareRequire.resolve("workerd");
  const workerdWrapperRequire = createRequire(workerdWrapperMain);
  const workerdWrapperPackagePath = workerdWrapperRequire.resolve("workerd/package.json");
  const runtimePaths = [
    "node_modules/miniflare/package.json",
    relative(root, miniflareModulePath),
    relative(root, workerdWrapperPackagePath),
    relative(root, workerdWrapperMain),
  ];
  const runtimeHashesBeforeRun = await captureHashes(runtimePaths);
  const workerdWrapper = JSON.parse(await readFile(workerdWrapperPackagePath, "utf8"));
  const workerdBinary = resolve(dirname(workerdWrapperMain), "../", workerdWrapper.bin.workerd);
  const workerdBinarySha256BeforeRun = await fileHash(workerdBinary);
  const workerdVersionRun = spawnSync(workerdBinary, ["--version"], { encoding: "utf8", timeout: 2_000 });
  if (workerdVersionRun.status !== 0) throw new Error(`installed workerd binary version read failed: ${workerdVersionRun.stderr}`);
  const workerdVersion = workerdVersionRun.stdout.trim();
  const wrangler = (await readFile(join(root, "deploy/cloudflare/wrangler.toml"), "utf8"));
  const compatibilityDate = wrangler.match(/^compatibility_date\s*=\s*"([^"]+)"/mu)?.[1];
  const flagsText = wrangler.match(/^compatibility_flags\s*=\s*(\[[^\n]+\])/mu)?.[1];
  if (!compatibilityDate || !flagsText) throw new Error("Cloudflare compatibility date/flags missing from owning wrangler config");
  const compatibilityFlags = JSON.parse(flagsText);
  const fixturePath = join(outputDir, "worker-fixture.ts");
  await writeFile(fixturePath, nativeStaleRunFixtureSource(
    join(root, "src/worker/index.ts"),
    join(root, "src/worker/platform/migrations/schema-gate.ts"),
    join(root, "src/worker/platform/migrations/migration-set.ts"),
  ), { flag: "wx", mode: 0o600 });
  const builder = spawnSync(bunPath, [join(root, "scripts/lib/build-native-proof-fixture.ts"), fixturePath, bundleDir, join(root, "deploy/cloudflare/wrangler.toml")], { cwd: root, encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  if (builder.status !== 0) throw new Error(`pinned Bun native fixture build failed: ${builder.stderr || builder.stdout || builder.error}`);
  const build = JSON.parse(builder.stdout);
  if (!build.success || build.bunVersion !== "1.3.14" || build.compatibilityDate !== compatibilityDate || JSON.stringify(build.compatibilityFlags) !== JSON.stringify(compatibilityFlags)) throw new Error(`pinned native fixture metadata mismatch: ${JSON.stringify({ success: build.success, bunVersion: build.bunVersion, compatibilityDate: build.compatibilityDate, compatibilityFlags: build.compatibilityFlags })}`);
  const workerBundle = build.outputs.find((output) => /worker-fixture\.(?:js|mjs)$/u.test(output.path))?.path ?? build.outputs[0]?.path;
  if (!workerBundle) throw new Error("Bun native proof build produced no Worker module");
  const bundleInputs = {};
  for (const input of Object.keys(build.metafile?.inputs ?? {}).sort()) {
    const resolvedPath = resolve(root, input);
    bundleInputs[input] = { repositoryPath: relative(root, resolvedPath).split("\\").join("/"), sha256: hash(await readFile(resolvedPath)) };
  }
  bundleSha256 = hash(await readFile(workerBundle));
  stage = "miniflare-create";
  mf = new Miniflare({
    name: `native-stale-run-${process.pid}`,
    scriptPath: workerBundle,
    modules: true,
    compatibilityDate,
    compatibilityFlags: [...compatibilityFlags, "service_binding_extra_handlers"],
    d1Databases: { DB: "native-stale-run-db" },
    d1Persist: stateDir,
    queueProducers: { RUN_QUEUE: { queueName: "takos-runs" } },
    queueConsumers: { "takos-runs": { maxBatchSize: 1, maxBatchTimeout: 1, maxRetries: 0 } },
    durableObjects: { RUN_NOTIFIER: { className: "RunNotifierDO" } },
    bindings: { OIDC_ISSUER_URL: "https://issuer.native-stale.example", OIDC_OWNER_SUBJECT: "native-stale-owner-subject" },
    log: new Log(LogLevel.ERROR),
  });
  const worker = await mf.getWorker();
  const admissions = [];
  let readyAdmission;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await worker.fetch("http://native/__native/admit");
    const admission = await response.json();
    admissions.push(admission);
    if (response.status === 200) { readyAdmission = admission; break; }
    if (response.status !== 202 || attempt !== 0 || !["pending", "applying"].includes(admission.schema?.state)) throw new Error(`native schema admission ${attempt + 1} failed: ${JSON.stringify({ status: response.status, schema: admission.schema, ledgerCount: admission.ledger?.length, lock: admission.lock })}`);
    const delayMs = Math.max(1, Math.min(60, admission.schema.retryAfterSeconds ?? 5)) * 1000;
    await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
  }
  if (!readyAdmission || readyAdmission.schema.state !== "ready" || readyAdmission.schema.applied !== 106 || readyAdmission.schema.total !== 106) throw new Error(`native schema did not reach ready within two production admissions: ${JSON.stringify(admissions.map(({ schema, ledger, lock }) => ({ schema, ledgerCount: ledger.length, ledgerPrefix: ledger.slice(-2), lock })))}`);
  const seedResponse = await worker.fetch("http://native/__native/seed");
  const seedText = await seedResponse.text();
  if (!seedResponse.ok) throw new Error(`native fixture seed failed (${seedResponse.status}): ${seedText}`);
  const seed = JSON.parse(seedText);
  seed.schema = readyAdmission.schema;

  stage = "canonical-scheduled";
  const scheduledOutcome = await worker.scheduled({ cron: "* * * * *", scheduledTime: new Date() });
  diagnosticEvidence.scheduledOutcome = scheduledOutcome;
  if (scheduledOutcome?.outcome !== "ok") throw new Error(`canonical scheduled event failed: ${JSON.stringify(scheduledOutcome)}`);
  const awaitRunState = async (runId, predicate, limitMs = 10_000) => {
    const until = Date.now() + limitMs;
    let state;
    do {
      state = await (await worker.fetch("http://native/__native/readback")).json();
      diagnosticEvidence.lastReadback = state;
      if (predicate(state.runs[runId].run, state)) return state;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    } while (Date.now() < until);
    throw new Error(`native queue consumer did not reach expected state for ${runId}: ${JSON.stringify(state.runs[runId])}`);
  };
  const scheduleReadback = await awaitRunState("cron-stale", (run, state) => run.status === "running" && run.service_id !== "old-service" && Number(run.lease_version) === 8 && state.acknowledgements.some((item) => item.id === "cron-stale" && item.action === "ack") && state.dispatches.some((dispatch) => dispatch.runId === "cron-stale" && dispatch.serviceId === run.service_id));
  diagnosticEvidence.scheduleReadback = scheduleReadback;
  const cronMessage = scheduleReadback.emitted.find((message) => message.runId === "cron-stale");
  if (!cronMessage) throw new Error("canonical scheduled handler did not emit RUN_QUEUE for fixture-eligible stale heartbeat");
  const cronQueueSnapshot = scheduleReadback.emittedSnapshots.find((entry) => entry.body.runId === "cron-stale")?.beforeQueueSend;
  if (cronQueueSnapshot?.run.status !== "queued" || cronQueueSnapshot.run.service_id !== null || cronQueueSnapshot.run.service_heartbeat !== null || Number(cronQueueSnapshot.run.lease_version) !== 7) throw new Error(`cron did not queue the stale Run from its expected reset state: ${JSON.stringify(cronQueueSnapshot)}`);
  const agedQueueRun = await (await worker.fetch("http://native/__native/age-queue-run")).json();

  stage = "canonical-queue";
  const queueTakeoverMessage = { ...cronMessage, runId: "queue-stale", model: "conflicting-queue-model", timestamp: Date.now(), retryCount: 0 };
  await (await worker.fetch("http://native/__native/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(queueTakeoverMessage) })).json();
  const firstQueueReadback = await awaitRunState("queue-stale", (run, state) => run.status === "running" && run.service_id !== "old-service" && Number(run.lease_version) === 8 && state.acknowledgements.some((item) => item.id === "queue-stale" && item.action === "ack") && state.dispatches.some((dispatch) => dispatch.runId === "queue-stale" && dispatch.serviceId === run.service_id));
  diagnosticEvidence.firstQueueReadback = firstQueueReadback;
  const claimedQueueRun = firstQueueReadback.runs["queue-stale"].run;
  const directQueueBatch = await worker.queue("takos-runs", [
    { body: { ...cronMessage, runId: "fresh-running", model: "ignored-model", retryCount: 0 }, id: "fresh-running-delivery", timestamp: new Date(), attempts: 1 },
    { body: { ...cronMessage, runId: "terminal", model: "ignored-model", retryCount: 0 }, id: "terminal-delivery", timestamp: new Date(), attempts: 1 },
  ]);
  diagnosticEvidence.directQueueBatchOutcome = directQueueBatch;
  if (directQueueBatch?.outcome !== "ok" || directQueueBatch.retryBatch?.retry !== false || directQueueBatch.retryMessages?.length !== 0 || JSON.stringify([...directQueueBatch.explicitAcks].sort()) !== JSON.stringify(["fresh-running-delivery", "terminal-delivery"])) throw new Error(`canonical fresh/terminal Queue event failed or requested retry: ${JSON.stringify(directQueueBatch)}`);
  const retryMessage = { ...cronMessage, runId: "queue-stale", model: "another-conflicting-model", timestamp: Date.now(), retryCount: 0 };
  await (await worker.fetch("http://native/__native/enqueue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retryMessage) })).json();
  const finalReadback = await awaitRunState("queue-stale", (run, state) => run.status === "running" && run.service_id === claimedQueueRun.service_id && Number(run.lease_version) === 8 && state.acknowledgements.filter((item) => item.id === "queue-stale" && item.action === "ack").length >= 2 && state.acknowledgements.filter((item) => item.id === "cron-stale" && item.action === "ack").length >= state.emitted.filter((message) => message.runId === "cron-stale").length && state.dispatches.some((dispatch) => dispatch.runId === "queue-stale" && dispatch.serviceId === run.service_id));
  diagnosticEvidence.finalReadback = finalReadback;
  const sourceHashesAfterRun = await captureHashes(sourcePaths);
  const runtimeHashesAfterRun = await captureHashes(runtimePaths);
  const workerdBinarySha256AfterRun = await fileHash(workerdBinary);
  const bundleInputHashesAfterRun = {};
  for (const [input, value] of Object.entries(bundleInputs)) bundleInputHashesAfterRun[input] = { repositoryPath: value.repositoryPath, sha256: hash(await readFile(join(root, value.repositoryPath))) };
  const bundleSha256AfterRun = hash(await readFile(workerBundle));
  const lease = Number(claimedQueueRun.lease_version);
  report = {
    status: "passed",
    result: "NATIVE_WORKER_STALE_RUN_QUEUE_RECOVERY_OK",
    outputDir,
    elapsedMs: Date.now() - proofStarted,
    scope: {
      entrypoint: "Miniflare getWorker().scheduled()/queue() -> bundled src/worker/index.ts production delegates",
      queue: "RUN_QUEUE native Miniflare producer; fixture observer captures send; queue event uses the actual production consumer",
      directControlDelivery: "cron-stale and queue-stale use native RUN_QUEUE producer/consumer; fresh-running and terminal control deliveries use getWorker().queue(queueName, messagesArray) for the public service_binding_extra_handlers path",
      executorHost: "explicit EXECUTOR_HOST transport stub; it returns the synthetic receipt id native-stale-proof-no-container; no Container dispatch, lifecycle, image, or model execution proof",
      timeEligibility: "fixture heartbeat is six minutes old under the current five-minute policy; no real-time lapse is claimed",
      authority: "synthetic OIDC owner issuer/subject and private Workspace seeded into isolated D1",
    },
    runtime: { node: process.version, bun: build.bunVersion, miniflare: JSON.parse(await readFile(join(root, "node_modules/miniflare/package.json"), "utf8")).version, miniflareModuleRepositoryPath: relative(root, miniflareModulePath).split("\\").join("/"), workerdPackage: workerdWrapper.version, workerdVersion, workerdBinaryRepositoryPath: relative(root, workerdBinary).split("\\").join("/"), workerdBinarySha256BeforeRun, workerdBinarySha256AfterRun, compatibilityDate, compatibilityFlags, effectiveCompatibilityFlags: [...compatibilityFlags, "service_binding_extra_handlers"], bundleSha256, bundleSha256AfterRun, runtimeHashesBeforeRun, runtimeHashesAfterRun },
    migrations: { applied: seed.schema.applied, total: seed.schema.total, names: seed.migrations.map((migration) => migration.name), manifest: seed.migrations, ledger: seed.ledger, ledgerMatchesManifest: seed.ledger.length === seed.migrations.length && seed.ledger.every((row, index) => row.name === seed.migrations[index].name && row.checksum === seed.migrations[index].sha256), admissions },
    queue: { emitted: finalReadback.emitted, emittedSnapshots: finalReadback.emittedSnapshots, dispatches: finalReadback.dispatches, dispatchSnapshots: finalReadback.dispatchSnapshots, acknowledgements: finalReadback.acknowledgements },
    cronRecovery: { beforeQueueSend: cronQueueSnapshot, afterNativeQueueDelivery: scheduleReadback.runs["cron-stale"] },
    queueTakeoverEligibility: agedQueueRun,
    scheduledOutcome,
    directQueueBatchOutcome: directQueueBatch,
    queueTakeover: finalReadback.runs["queue-stale"],
    freshRunning: finalReadback.runs["fresh-running"],
    terminal: finalReadback.runs.terminal,
    unchangedEvidence: { freshBefore: seed.baselineRuns["fresh-running"], freshAfter: finalReadback.runs["fresh-running"], terminalBefore: seed.baselineRuns.terminal, terminalAfter: finalReadback.runs.terminal, authorityBefore: seed.authority, authorityAfter: finalReadback.authority },
    duplicateDelivery: { before: claimedQueueRun, after: finalReadback.runs["queue-stale"].run, leaseUnchanged: Number(finalReadback.runs["queue-stale"].run.lease_version) === lease },
    sourceHashesBeforeRun,
    sourceHashesAfterRun,
    bundleInputHashes: bundleInputs,
    bundleInputHashesAfterRun,
    bundleSha256,
    databaseBinding: "Miniflare native D1; production ensureSchemaReady(DB) default options; at most two admissions separated by Retry-After; all 106 embedded migrations",
  };
  if (JSON.stringify(sourceHashesBeforeRun) !== JSON.stringify(sourceHashesAfterRun)) throw new Error("a watched production source/config input changed during proof");
  if (JSON.stringify(runtimeHashesBeforeRun) !== JSON.stringify(runtimeHashesAfterRun) || workerdBinarySha256BeforeRun !== workerdBinarySha256AfterRun || bundleSha256 !== bundleSha256AfterRun) throw new Error("pinned native runtime or Worker bundle bytes changed during proof");
  if (JSON.stringify(report.unchangedEvidence.freshBefore) !== JSON.stringify(report.unchangedEvidence.freshAfter) || JSON.stringify(report.unchangedEvidence.terminalBefore) !== JSON.stringify(report.unchangedEvidence.terminalAfter) || JSON.stringify(report.unchangedEvidence.authorityBefore) !== JSON.stringify(report.unchangedEvidence.authorityAfter)) throw new Error("fresh/terminal Run or synthetic identity/Workspace authority changed during native delivery");
  if (!report.migrations.ledgerMatchesManifest) throw new Error("native migration ledger did not match every embedded migration checksum");
  if (JSON.stringify(bundleInputs) !== JSON.stringify(bundleInputHashesAfterRun)) throw new Error("a Bun.build metafile input changed during proof");
  const queueDispatches = finalReadback.dispatches.filter((dispatch) => dispatch.runId === "queue-stale");
  const cronDispatches = finalReadback.dispatches.filter((dispatch) => dispatch.runId === "cron-stale");
  if (cronDispatches.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cronDispatches[0]?.serviceId ?? "") || cronDispatches[0]?.leaseVersion !== 8) throw new Error(`cron duplicate delivery did not dispatch exactly once under lease 8: ${JSON.stringify(cronDispatches)}`);
  if (queueDispatches.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(queueDispatches[0]?.serviceId ?? "") || queueDispatches[0]?.serviceId === "old-service") throw new Error(`Queue delivery did not dispatch exactly once with a production-created serviceUUID: ${JSON.stringify({ queueDispatches, allDispatches: finalReadback.dispatches, acknowledgements: finalReadback.acknowledgements })}`);
  if (lease !== 8 || claimedQueueRun.status !== "running" || claimedQueueRun.model !== "persisted-model" || Number(finalReadback.runs["queue-stale"].run.lease_version) !== 8) throw new Error(`stale Queue lease/model claim mismatch: ${JSON.stringify(claimedQueueRun)}`);
  if (finalReadback.runs["fresh-running"].run.service_id !== "fresh-service" || Number(finalReadback.runs["fresh-running"].run.lease_version) !== 11) throw new Error("fresh running Run was mutated by stale recovery/queue duplicate");
  if (finalReadback.runs.terminal.run.status !== "completed" || Number(finalReadback.runs.terminal.run.lease_version) !== 3) throw new Error("terminal Run was mutated by Queue delivery");
  const ops = finalReadback.runs["queue-stale"].operations;
  if (ops.find((row) => row.id === "completed-op")?.status !== "completed" || ops.find((row) => row.id === "pending-op")?.status !== "uncertain") throw new Error(`operation ledger fencing mismatch: ${JSON.stringify(ops)}`);
  if (JSON.stringify(finalReadback.runs["queue-stale"].run.engine_checkpoint) !== JSON.stringify(seed.fixture.checkpoint) || finalReadback.runs["queue-stale"].run.usage !== "{\"inputTokens\":41,\"outputTokens\":17}" || finalReadback.runs["queue-stale"].run.account_id !== "native-stale-private-workspace" || finalReadback.runs["queue-stale"].run.requester_account_id !== "native-stale-owner") throw new Error("opaque checkpoint, cumulative usage, Workspace, or requester changed during claim");
  const queueDispatchSnapshot = finalReadback.dispatchSnapshots.find((entry) => entry.dispatch.runId === "queue-stale");
  if (!queueDispatchSnapshot || queueDispatchSnapshot.beforeHostResponse.operations.find((row) => row.id === "pending-op")?.status !== "uncertain" || queueDispatchSnapshot.beforeHostResponse.operations.find((row) => row.id === "completed-op")?.status !== "completed") throw new Error("pending operation was not fenced uncertain before the EXECUTOR_HOST transport stub was called");
  const receipt = finalReadback.runs["queue-stale"].receipts.find((row) => row.event_key === `executor-dispatch:queue-stale:lease:8:service:${claimedQueueRun.service_id}`);
  if (!receipt || !receipt.data.includes("native-stale-proof-no-container")) throw new Error("synthetic host receipt did not pass the production lease-fenced receipt path");
  if (report.elapsedMs > 70_000) throw new Error(`native proof exceeded its 70s inner bound: ${report.elapsedMs}ms`);
  stage = "owned-dispose";
  await mf.dispose(); mf = undefined;
  report.cleanup = "Miniflare disposed; owned bundle and native D1 state retained under result directory for independent readback";
  await writeFile(join(outputDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  clearTimeout(watchdog);
  process.stdout.write(`${JSON.stringify({ status: report.status, result: report.result, outputDir, resultFile: "result.json", sha256: hash(await readFile(join(outputDir, "result.json"))), bytes: (await readFile(join(outputDir, "result.json"))).byteLength })}\n`);
} catch (error) {
  const diagnostics = { status: "failed", stage, elapsedMs: Date.now() - proofStarted, error: { name: error?.name, message: String(error?.message ?? error), stack: error?.stack }, diagnosticEvidence, sourceHashesBeforeRun, bundleSha256: bundleSha256 ?? null, runtimeStateRetained: true };
  try { await writeFile(join(outputDir, "failure.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, { flag: "wx", mode: 0o600 }); } catch {}
  if (mf) { try { await mf.dispose(); } catch (disposeError) { diagnostics.disposeError = String(disposeError); } }
  process.stderr.write(`${JSON.stringify(diagnostics)}\n`);
  clearTimeout(watchdog);
  process.exitCode = 1;
}
