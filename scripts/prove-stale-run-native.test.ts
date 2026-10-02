import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { qualifyOwnedProcessGroup, type ProcessWitness } from "./lib/native-container-proof-process.ts";

const root = join(import.meta.dir, "..");
const deadlineMs = 75_000;
const reapMs = 2_000;

async function captureBounded(stream: ReadableStream<Uint8Array>, path: string, limit = 4 * 1024 * 1024, tailLimit = 128 * 1024) {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let storedBytes = 0;
  let bytesSeen = 0;
  let tail = Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesSeen += value.byteLength;
    if (storedBytes < limit) {
      const part = value.subarray(0, Math.min(value.length, limit - storedBytes));
      parts.push(part);
      storedBytes += part.length;
    }
    tail = Buffer.concat([tail, Buffer.from(value)]).subarray(-tailLimit);
  }
  await writeFile(path, Buffer.concat(parts), { mode: 0o600, flag: "wx" });
  return { tail: tail.toString("utf8"), bytesSeen, storedBytes, truncated: bytesSeen > storedBytes };
}

async function procWitness(pid: number): Promise<ProcessWitness | undefined> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/u);
    return { pid, state: fields[0]!, pgid: Number(fields[2]), sessionId: Number(fields[3]), startTicks: fields[19]! };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") return undefined;
    throw error;
  }
}

async function currentOwnedMembers(pgid: number): Promise<Record<string, ProcessWitness>> {
  const result: Record<string, ProcessWitness> = {};
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    const witness = await procWitness(Number(entry));
    if (witness?.pgid === pgid && witness.sessionId === pgid) result[String(witness.pid)] = witness;
  }
  return result;
}

async function pidfdStop(pgid: number, members: Record<string, ProcessWitness>): Promise<void> {
  if (Object.keys(members).length === 0) return;
  const stop = Bun.spawn(["python3", join(root, "scripts/lib/native-container-proof-stop.py"), JSON.stringify({ pgid, members })], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([stop.exited, new Response(stop.stdout).text(), new Response(stop.stderr).text()]);
  if (code !== 0) throw new Error(`pidfd owned-process cleanup failed closed: ${stderr.slice(0, 2000)}`);
  const result = JSON.parse(stdout) as { mechanism: string; signaled: number[]; alreadyExited: number[] };
  if (result.mechanism !== "pidfd") throw new Error("owned process cleanup used an unexpected mechanism");
}

async function cleanupOwnedChild(input: {
  outputDir: string;
  pid: number;
  leaderAtStart: ProcessWitness | undefined;
  leaderStartTicks: string | undefined;
  ownershipSnapshot: () => { observed: Record<string, ProcessWitness>; error: unknown };
  passed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  stopSampling: () => void;
  sampler: Promise<void> | undefined;
  sampleGroup: () => Promise<void>;
  exited: Promise<number>;
  stdoutPromise: Promise<{ tail: string; bytesSeen: number; storedBytes: number; truncated: boolean }>;
  stderrPromise: Promise<{ tail: string; bytesSeen: number; storedBytes: number; truncated: boolean }>;
}): Promise<{ errors: unknown[] }> {
  const errors: unknown[] = [];
  let liveBeforeStop: Record<string, ProcessWitness> = {};
  let remaining: Record<string, ProcessWitness> = {};
  let observed: Record<string, ProcessWitness> = {};
  let finalAbsenceConfirmed = false;
  if (input.timer) clearTimeout(input.timer);
  input.stopSampling();
  try {
    if (input.sampler) await input.sampler;
    await input.sampleGroup();
  } catch (caught) { errors.push(caught); }
  try {
    const ownership = input.ownershipSnapshot();
    observed = ownership.observed;
    if (!input.leaderStartTicks) throw new Error("owned child leader start-time witness was unavailable; refusing cleanup without exact identity");
    if (ownership.error) throw ownership.error;
    const current = await currentOwnedMembers(input.pid);
    observed = qualifyOwnedProcessGroup(input.pid, input.leaderStartTicks, current[String(input.pid)], current, observed);
    liveBeforeStop = structuredClone(current);
    if (input.passed && Object.keys(liveBeforeStop).length > 0) errors.push(new Error(`native stale Run proof left qualified process group members alive; cleaning them up: ${Object.keys(liveBeforeStop).join(",")}`));
    await pidfdStop(input.pid, liveBeforeStop);
    await Promise.race([input.exited, Bun.sleep(reapMs).then(() => { throw new Error("native proof controller did not exit after pidfd cleanup"); })]);
    let emptyScans = 0;
    for (let i = 0; i < reapMs / 20; i++) {
      remaining = await currentOwnedMembers(input.pid);
      if (Object.keys(remaining).length === 0) {
        emptyScans++;
        if (emptyScans === 2) break;
      } else {
        emptyScans = 0;
        observed = qualifyOwnedProcessGroup(input.pid, input.leaderStartTicks, remaining[String(input.pid)], remaining, observed);
        await pidfdStop(input.pid, remaining);
      }
      await Bun.sleep(20);
    }
    if (emptyScans !== 2) throw new Error(`native child absence was not confirmed by two consecutive scans after pidfd stop: ${Object.keys(remaining).join(",")}`);
    finalAbsenceConfirmed = true;
  } catch (caught) { errors.push(new Error(`owned native child cleanup failed closed; output=${input.outputDir}`, { cause: caught })); }
  try {
    const [stdoutCapture, stderrCapture] = await Promise.all([input.stdoutPromise, input.stderrPromise]);
    await writeFile(join(input.outputDir, "parent-process-cleanup.json"), JSON.stringify({ leaderAtStart: input.leaderAtStart, observedWitnesses: observed, liveBeforeStop, pidfdCleanupRequired: Object.keys(liveBeforeStop).length > 0, finalRemainingMembers: remaining, finalAbsenceConfirmed, stdoutCapture: { file: "parent-stdout.raw", ...stdoutCapture }, stderrCapture: { file: "parent-stderr.raw", ...stderrCapture } }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } catch (caught) { errors.push(new Error(`owned native child cleanup evidence could not be retained; output=${input.outputDir}`, { cause: caught })); }
  return { errors };
}

test("native canonical Worker cron and Queue recover stale Runs through Miniflare D1", async () => {
  const node = Bun.which("node");
  expect(node, "native stale Run proof requires the installed Node 26 controller").not.toBeNull();
  const version = await Bun.$`${node!} --version`.text();
  expect(version.trim().startsWith("v26.1.")).toBe(true);
  const bunPath = process.execPath;
  const bunVersion = await Bun.$`${bunPath} --version`.text();
  expect(bunVersion.trim()).toBe("1.3.14");
  const base = join(root, "tmp/native-stale-run-proof");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const outputDir = join(base, randomUUID());
  const child = Bun.spawn([
    node!, "--experimental-strip-types", join(import.meta.dir, "prove-stale-run-native.mjs"),
    "--bun", bunPath, "--output-dir", outputDir,
  ], { cwd: root, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const stdoutPromise = captureBounded(child.stdout, join(outputDir, "parent-stdout.raw"));
  const stderrPromise = captureBounded(child.stderr, join(outputDir, "parent-stderr.raw"));
  let leaderAtStart: ProcessWitness | undefined;
  let observed: Record<string, ProcessWitness> = {};
  let leaderStartTicks: string | undefined;
  let ownershipError: unknown;
  let sampling = false;
  const sampleGroup = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const current = await currentOwnedMembers(child.pid);
      const head = current[String(child.pid)];
      observed = qualifyOwnedProcessGroup(child.pid, leaderStartTicks, head, current, observed);
    } catch (error) { ownershipError = error; }
    finally { sampling = false; }
  };
  let stopSampling = false;
  let sampler: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let passed = false;
  let failure: unknown;
  try {
    for (let attempt = 0; attempt < 20 && !leaderAtStart; attempt++) {
      leaderAtStart = await procWitness(child.pid);
      if (!leaderAtStart) await Bun.sleep(50);
    }
    expect(leaderAtStart?.pgid).toBe(child.pid);
    expect(leaderAtStart?.sessionId).toBe(child.pid);
    leaderStartTicks = leaderAtStart?.startTicks;
    await sampleGroup();
    sampler = (async () => {
      while (!stopSampling) {
        await Bun.sleep(250);
        if (!stopSampling) await sampleGroup();
      }
    })();
    const [code, stdout, stderr] = await Promise.race([
      Promise.all([child.exited, stdoutPromise, stderrPromise] as const),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void sampleGroup().then(async () => {
            if (ownershipError) { reject(ownershipError); return; }
            try {
              const current = await currentOwnedMembers(child.pid);
              observed = qualifyOwnedProcessGroup(child.pid, leaderStartTicks, current[String(child.pid)], current, observed);
              await pidfdStop(child.pid, observed);
              reject(new Error(`native stale Run proof exceeded ${deadlineMs}ms; output=${outputDir}`));
            } catch (error) { reject(error); }
          });
        }, deadlineMs);
      }),
    ]);
    expect(code, `native stale Run child failed; stdout=${stdout.tail.slice(-5000)} stderr=${stderr.tail.slice(-5000)} output=${outputDir}`).toBe(0);
    expect(stdout.truncated, "parent stdout artifact exceeded its explicit 4 MiB evidence bound").toBe(false);
    expect(stderr.truncated, "parent stderr artifact exceeded its explicit 4 MiB evidence bound").toBe(false);
    const receiptCandidates = (await readFile(join(outputDir, "parent-stdout.raw"), "utf8")).trim().split(/\r?\n/u).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value?.status === "passed" && value?.result === "NATIVE_WORKER_STALE_RUN_QUEUE_RECOVERY_OK" ? [{ line, value }] : [];
      } catch { return []; }
    });
    expect(receiptCandidates, `native proof must emit exactly one strict success receipt; stdout=${stdout.tail.slice(-5000)}`).toHaveLength(1);
    const receiptLine = receiptCandidates[0]!.line;
    const receipt = JSON.parse(receiptLine!) as { status: string; result: string; outputDir: string; resultFile: string; sha256: string; bytes: number };
    expect(receipt).toMatchObject({ status: "passed", result: "NATIVE_WORKER_STALE_RUN_QUEUE_RECOVERY_OK", outputDir, resultFile: "result.json" });
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Number.isSafeInteger(receipt.bytes)).toBe(true);
    const resultBytes = await readFile(join(outputDir, receipt.resultFile));
    expect(resultBytes.byteLength).toBe(receipt.bytes);
    expect(createHash("sha256").update(resultBytes).digest("hex")).toBe(receipt.sha256);
    const report = JSON.parse(resultBytes.toString("utf8")) as Record<string, any>;
    expect(report.status).toBe("passed");
    expect(report.result).toBe("NATIVE_WORKER_STALE_RUN_QUEUE_RECOVERY_OK");
    expect(report.scheduledOutcome).toMatchObject({ outcome: "ok" });
    expect(report.directQueueBatchOutcome).toMatchObject({ outcome: "ok", retryBatch: { retry: false }, retryMessages: [] });
    expect(report.directQueueBatchOutcome.explicitAcks.sort()).toEqual(["fresh-running-delivery", "terminal-delivery"]);
    expect(report.migrations).toMatchObject({ applied: 106, total: 106 });
    expect(report.migrations.ledgerMatchesManifest).toBe(true);
    expect(report.migrations.admissions.length).toBeGreaterThanOrEqual(1);
    expect(report.migrations.admissions.length).toBeLessThanOrEqual(2);
    for (const admission of report.migrations.admissions) {
      expect(admission.ledger).toHaveLength(admission.schema.applied);
      expect(admission.ledger.map((row: any) => row.name)).toEqual(report.migrations.manifest.slice(0, admission.schema.applied).map((row: any) => row.name));
      expect(admission.ledger.map((row: any) => row.checksum)).toEqual(report.migrations.manifest.slice(0, admission.schema.applied).map((row: any) => row.sha256));
      expect(admission.lock).toMatchObject({ id: 1, holder: null, lease_expires_at: null });
    }
    if (report.migrations.admissions.length === 2) {
      const [first, second] = report.migrations.admissions;
      expect(first.schema.state).toBe("pending");
      expect(second.schema.state).toBe("ready");
      expect(second.ledger.slice(0, first.ledger.length)).toEqual(first.ledger);
    }
    expect(report.scope.executorHost).toContain("no Container dispatch");
    expect(report.scope.directControlDelivery).toContain("getWorker().queue(queueName, messagesArray)");
    expect(report.cronRecovery.beforeQueueSend.run).toMatchObject({ status: "queued", service_id: null, service_heartbeat: null, lease_version: 7 });
    expect(report.cronRecovery.afterNativeQueueDelivery.run).toMatchObject({ status: "running", lease_version: 8 });
    const claimed = report.queueTakeover.run;
    expect(claimed).toMatchObject({ status: "running", model: "persisted-model", lease_version: 8, service_heartbeat: expect.any(String) });
    expect(claimed.service_id).not.toBe("old-service");
    expect(claimed.engine_checkpoint).toBe(report.cronRecovery.beforeQueueSend.run.engine_checkpoint);
    expect(claimed.usage).toBe(report.cronRecovery.beforeQueueSend.run.usage);
    expect(claimed.account_id).toBe("native-stale-private-workspace");
    expect(claimed.requester_account_id).toBe("native-stale-owner");
    expect(report.queueTakeover.operations).toContainEqual(expect.objectContaining({ id: "completed-op", status: "completed", result_output: "{\"ok\":true}" }));
    expect(report.queueTakeover.operations).toContainEqual(expect.objectContaining({ id: "pending-op", status: "uncertain" }));
    const queueDispatchSnapshot = report.queue.dispatchSnapshots.find((entry: any) => entry.dispatch.runId === "queue-stale");
    expect(queueDispatchSnapshot.beforeHostResponse.operations).toContainEqual(expect.objectContaining({ id: "pending-op", status: "uncertain" }));
    expect(queueDispatchSnapshot.beforeHostResponse.operations).toContainEqual(expect.objectContaining({ id: "completed-op", status: "completed" }));
    expect(report.duplicateDelivery.leaseUnchanged).toBe(true);
    expect(report.duplicateDelivery.after.service_id).toBe(claimed.service_id);
    expect(report.freshRunning.run).toMatchObject({ status: "running", service_id: "fresh-service", lease_version: 11 });
    expect(report.terminal.run).toMatchObject({ status: "completed", service_id: "terminal-service", lease_version: 3 });
    expect(report.unchangedEvidence.freshBefore).toEqual(report.unchangedEvidence.freshAfter);
    expect(report.unchangedEvidence.terminalBefore).toEqual(report.unchangedEvidence.terminalAfter);
    expect(report.unchangedEvidence.authorityBefore).toEqual(report.unchangedEvidence.authorityAfter);
    expect(report.queue.acknowledgements).toContainEqual(expect.objectContaining({ id: "fresh-running", action: "ack" }));
    expect(report.queue.acknowledgements).toContainEqual(expect.objectContaining({ id: "terminal", action: "ack" }));
    expect(report.queue.dispatches.filter((dispatch: any) => dispatch.runId === "queue-stale")).toHaveLength(1);
    expect(report.queue.dispatches.filter((dispatch: any) => dispatch.runId === "cron-stale")).toHaveLength(1);
    expect(report.queue.dispatches.find((dispatch: any) => dispatch.runId === "cron-stale")).toMatchObject({ model: "persisted-model" });
    expect(report.queue.dispatches.find((dispatch: any) => dispatch.runId === "queue-stale")).toMatchObject({ model: "persisted-model", leaseVersion: 8 });
    expect(report.queueTakeover.receipts).toContainEqual(expect.objectContaining({ type: "executor_dispatch_receipt", data: expect.stringContaining("native-stale-proof-no-container") }));
    expect(report.sourceHashesAfterRun).toEqual(report.sourceHashesBeforeRun);
    expect(report.runtime.runtimeHashesAfterRun).toEqual(report.runtime.runtimeHashesBeforeRun);
    expect(report.runtime.workerdBinarySha256AfterRun).toBe(report.runtime.workerdBinarySha256BeforeRun);
    expect(report.runtime.bundleSha256AfterRun).toBe(report.runtime.bundleSha256);
    expect(report.bundleInputHashesAfterRun).toEqual(report.bundleInputHashes);
    expect(Object.keys(report.bundleInputHashes).length).toBeGreaterThan(0);
    passed = true;
  } catch (error) { failure = error; }
  finally {
    const cleanup = await cleanupOwnedChild({ outputDir, pid: child.pid, leaderAtStart, leaderStartTicks, ownershipSnapshot: () => ({ observed, error: ownershipError }), passed, timer, stopSampling: () => { stopSampling = true; }, sampler, sampleGroup, exited: child.exited, stdoutPromise, stderrPromise });
    if (cleanup.errors.length > 0) failure = failure === undefined ? (cleanup.errors.length === 1 ? cleanup.errors[0] : new AggregateError(cleanup.errors, `owned native child cleanup had multiple errors; output=${outputDir}`)) : new AggregateError([failure, ...cleanup.errors], `native proof and owned-process cleanup failed; output=${outputDir}`);
    if (!passed) console.error(`native stale Run diagnostics retained: ${outputDir}`);
  }
  if (failure) throw failure;
}, deadlineMs + reapMs + 1_000);
