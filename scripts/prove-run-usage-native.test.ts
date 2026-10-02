import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { retainAndEmitNativeProofReport } from "./lib/native-proof-report.ts";

import type { NativeUsageProofReport } from "./prove-run-usage-native.ts";

const root = join(import.meta.dir, "..");
const deadlineMs = 75_000;
const reapMs = 2_500;
// The native deadline stays fixed; reporting has 5s for writes and 5s reserved for retention.
const reportMarginMs = 10_000;

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function cleanOwnedGroup(pid: number, successful: boolean): Promise<string | undefined> {
  try {
    if (!signalGroup(pid, 0)) return undefined;
    signalGroup(pid, "SIGKILL");
    const deadline = Date.now() + reapMs;
    while (Date.now() < deadline) {
      if (!signalGroup(pid, 0)) {
        return successful
          ? `successful native usage proof left process group ${pid} running`
          : undefined;
      }
      await Bun.sleep(25);
    }
    return `owned native usage proof group ${pid} remained live after SIGKILL`;
  } catch (error) {
    return `could not clean owned native usage proof group ${pid}: ${String(error)}`;
  }
}

test("native D1 full schema and terminal usage recover through a cold RunNotifier", async () => {
  // Tests elsewhere mock Miniflare inside Bun. A real Node child gives this
  // proof the installed host implementation and native workerd bindings.
  const node = Bun.which("node");
  expect(node, "native usage proof requires the CI-pinned Node host").not.toBeNull();
  const base = join(root, "tmp/native-run-usage-proof");
  await mkdir(base, { recursive: true });
  const outputDirectory = join(base, randomUUID());
  const child = Bun.spawn([
    node!, "--experimental-strip-types", join(import.meta.dir, "prove-run-usage-native.ts"),
    "--bun", process.execPath, "--output-dir", outputDirectory,
  ], {
    cwd: root,
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let successful = false;
  let failed = false;
  let failure: unknown;
  let serializedReport: string | undefined;
  try {
    // The bound includes pipe draining, so a leaked workerd cannot keep this
    // test alive after the controller exits. Only this child's group is owned.
    const [code, output, diagnostics] = await Promise.race([
      Promise.all([child.exited, stdout, stderr] as const),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            signalGroup(child.pid, "SIGTERM");
            reject(new Error(`native usage proof exceeded ${deadlineMs}ms`));
          } catch (error) {
            reject(error);
          }
        }, deadlineMs);
      }),
    ]);
    expect(code, `${output}\n${diagnostics}\nisolated proof: ${outputDirectory}`).toBe(0);
    const report = JSON.parse(output) as NativeUsageProofReport;
    expect(report.result).toBe("NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK");
    expect(JSON.parse(await readFile(join(outputDirectory, "result.json"), "utf8"))).toEqual(report);
    const configBytes = await readFile(join(root, "deploy/cloudflare/wrangler.toml"));
    const config = Bun.TOML.parse(configBytes.toString()) as {
      compatibility_date: string;
      compatibility_flags: string[];
    };
    expect(report.compatibility).toEqual({
      date: config.compatibility_date,
      flags: config.compatibility_flags,
      sourceSha256: createHash("sha256").update(configBytes).digest("hex"),
    });
    expect(report.migrationSet.readyStatus.state).toBe("ready");
    expect(report.migrationSet.admissionRequests.length).toBeGreaterThanOrEqual(1);
    expect(report.migrationSet.admissionRequests.length).toBeLessThanOrEqual(2);
    if (report.migrationSet.continuedFromPending) {
      expect(report.migrationSet.initialStatus.state).toBe("pending");
      expect(report.migrationSet.initialStatus.retryAfterSeconds).toBe(5);
      expect(report.migrationSet.continuationWaitMs).toBeGreaterThanOrEqual(5_000);
      expect(report.migrationSet.admissionRequests).toHaveLength(2);
      const prior = report.migrationSet.admissionRequests[0]!.ledgerRows;
      expect(report.migrationSet.ledgerRows.slice(0, prior.length)).toEqual(prior);
      expect(report.migrationSet.ledgerRows.length).toBeGreaterThan(prior.length);
    } else {
      expect(report.migrationSet.initialStatus.state).toBe("ready");
      expect(report.migrationSet.admissionRequests).toHaveLength(1);
      expect(report.migrationSet.continuationWaitMs).toBe(0);
    }
    expect(report.migrationSet.applied).toBe(report.migrationSet.count);
    expect(report.migrationSet.ledgerRows).toHaveLength(report.migrationSet.count);
    expect(report.migrationSet.secondCallLedgerUnchanged).toBe(true);
    expect(report.migrationSet.finalTriggerCatalog).toEqual([]);
    expect(report.terminalCompletion.failedRunReadback.status).toBe("running");
    expect(report.terminalCompletion.failedWitnessRows).toEqual([]);
    expect(report.terminalCompletion.failedTerminalEventRows).toEqual([]);
    expect(report.terminalCompletion.idempotentRepeatResponse.idempotent).toBe(true);
    expect(report.terminalCompletion.repeatedTerminalEvents).toHaveLength(1);
    expect(report.terminalCompletion.repeatedWitnesses).toHaveLength(1);
    expect(report.authoritySnapshots.unchanged).toBe(true);
    expect(report.injectedUsageRollback.events).toBe(0);
    expect(report.injectedUsageRollback.rollups).toBe(0);
    expect(report.injectedUsageRollback.assertions).toBe(0);
    expect(report.retry.response.completed).toBe(1);
    expect(report.retry.events).toHaveLength(2);
    expect(report.retry.rollups).toHaveLength(2);
    expect(report.retry.outbox.delivery_status).toBe("done");
    expect(report.retry.outbox.attempts).toBe(2);
    expect(report.retry.outbox.projected_revision).toBe(3);
    expect(report.sourceHashesAfterRun).toEqual(report.sourceHashesBeforeRun);
    expect(Object.keys(report.bundleInputHashes).length).toBeGreaterThan(0);
    expect(report.bundleInputHashesAfterRun).toEqual(report.bundleInputHashes);
    serializedReport = JSON.stringify(report);
    successful = true;
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (timer) clearTimeout(timer);
    const [groupIssue, reaped] = await Promise.all([
      cleanOwnedGroup(child.pid, successful),
      Promise.race([
        child.exited.then(() => true),
        Bun.sleep(reapMs).then(() => false),
      ]),
    ]);
    const cleanupIssue = groupIssue ??
      (!reaped ? `native usage controller ${child.pid} did not reap within ${reapMs}ms` : undefined);
    if (cleanupIssue) {
      failed = true;
      failure = new Error(cleanupIssue, { cause: failure });
    }
    if (failed) console.error(`native usage proof diagnostics retained: ${outputDirectory}`);
  }
  if (failed) throw failure;
  try {
    if (serializedReport === undefined) throw new Error("native usage proof has no complete report");
    await retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", basename(outputDirectory), serializedReport);
    await rm(outputDirectory, { recursive: true, force: true });
  } catch (error) {
    console.error(`native usage proof diagnostics retained: ${outputDirectory}`);
    throw new Error(`native usage proof evidence retention failed: ${outputDirectory}`, { cause: error });
  }
}, deadlineMs + reapMs + reportMarginMs + 1_000);
