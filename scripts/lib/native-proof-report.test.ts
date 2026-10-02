import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  MAX_PROOF_LOG_LINE_BYTES,
  retainAndEmitNativeProofReport,
  type NativeProofReportFamily,
} from "./native-proof-report";
import { qualifyOwnedProcessGroup, type ProcessWitness } from "./native-container-proof-process";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const TEST_TMP = join(REPOSITORY_ROOT, "tmp");
const roots: string[] = [];

async function freshRoot(): Promise<string> {
  await mkdir(TEST_TMP, { recursive: true });
  const root = await mkdtemp(join(TEST_TMP, "native-proof-report-test-"));
  roots.push(root);
  return root;
}

async function expectMissing(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`expected path to be absent: ${path}`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function resultFor(family: NativeProofReportFamily): string {
  return family === "nativeHttpSchemaProofReportChunk"
    ? "NATIVE_HTTP_SCHEMA_ADMISSION_OK"
    : "NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK";
}

function reportFor(family: NativeProofReportFamily, payload = "proof🙂日本語"): string {
  return JSON.stringify({ status: "passed", result: resultFor(family), payload });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function envelopePath(root: string, family: NativeProofReportFamily, nonce: string): string {
  return join(root, "tmp/native-proof-reports", `${family}-${nonce}.json`);
}

async function readEnvelope(path: string): Promise<{
  schemaVersion: number;
  family: NativeProofReportFamily;
  sha256: string;
  bytes: number;
  serializedReport: string;
}> {
  return JSON.parse(await readFile(path, "utf8")) as {
    schemaVersion: number;
    family: NativeProofReportFamily;
    sha256: string;
    bytes: number;
    serializedReport: string;
  };
}

describe("retained native proof report receipts", () => {
  test("retains a large escaped UTF-8 report before emitting one short receipt", async () => {
    const root = await freshRoot();
    const family = "nativeHttpSchemaProofReportChunk";
    const nonce = randomUUID();
    const payload = `quote:" backslash:\\ newline:\n tab:\t nul:\u0000 日本語🙂🚀 `.repeat(18_000);
    const serializedReport = reportFor(family, payload);
    const expectedPath = envelopePath(root, family, nonce);
    const writes: string[] = [];

    const path = await retainAndEmitNativeProofReport(root, family, nonce, serializedReport, async (line) => {
      const envelope = await readEnvelope(expectedPath);
      expect(envelope).toEqual({
        schemaVersion: 1,
        family,
        sha256: sha256(serializedReport),
        bytes: Buffer.byteLength(serializedReport, "utf8"),
        serializedReport,
      });
      expect((await stat(expectedPath)).mode & 0o777).toBe(0o600);
      writes.push(line);
      return Buffer.byteLength(line, "utf8");
    });

    expect(path).toBe(expectedPath);
    expect(writes).toHaveLength(1);
    const line = writes[0]!;
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(MAX_PROOF_LOG_LINE_BYTES);
    expect(line.endsWith("\n")).toBe(true);
    expect(line).not.toContain(payload);
    expect(line).not.toContain("serializedReport");
    expect(JSON.parse(line)).toEqual({
      nativeProofReportRetained: {
        family,
        sha256: sha256(serializedReport),
        bytes: Buffer.byteLength(serializedReport, "utf8"),
        path: `tmp/native-proof-reports/${family}-${nonce}.json`,
      },
    });
    const envelope = await readEnvelope(path);
    expect(envelope.serializedReport).toBe(serializedReport);
    expect(envelope.sha256).toBe(sha256(serializedReport));
    expect(envelope.bytes).toBe(Buffer.byteLength(serializedReport, "utf8"));
  });

  test("retains the complete envelope when receipt writes error, short-write, return zero, or time out", async () => {
    const root = await freshRoot();
    const family = "nativeUsageProofReportChunk";
    const serializedReport = reportFor(family, `usage-証跡🙂${"x".repeat(96 * 1024)}`);
    const failWriters: Array<{ write: (line: string) => Promise<number>; expected: string }> = [
      { write: async () => { throw new Error("writer failed"); }, expected: "writer failed" },
      { write: async (line) => Buffer.byteLength(line, "utf8") - 1, expected: "short" },
      { write: async () => 0, expected: "short" },
      { write: () => new Promise<number>(() => {}), expected: "timed out" },
    ];
    for (const { write, expected } of failWriters) {
      const nonce = randomUUID();
      const path = envelopePath(root, family, nonce);
      await expect(retainAndEmitNativeProofReport(root, family, nonce, serializedReport, write, 20)).rejects.toThrow(expected);
      const envelope = await readEnvelope(path);
      expect(envelope.serializedReport).toBe(serializedReport);
      expect(envelope.sha256).toBe(sha256(serializedReport));
      expect(envelope.bytes).toBe(Buffer.byteLength(serializedReport, "utf8"));
    }
  });

  test("rejects invalid reports and duplicate nonces before invoking the receipt writer", async () => {
    const root = await freshRoot();
    let writes = 0;
    const writer = async (line: string) => {
      writes += 1;
      return Buffer.byteLength(line, "utf8");
    };
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), "", writer))
      .rejects.toThrow("non-empty");
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), "{", writer))
      .rejects.toThrow("valid JSON");
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), reportFor("nativeUsageProofReportChunk", "x".repeat(8 * 1024 * 1024)), writer))
      .rejects.toThrow("exceeds");
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), JSON.stringify({ status: "failed", result: resultFor("nativeUsageProofReportChunk") }), writer))
      .rejects.toThrow("status must be passed");
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), reportFor("nativeHttpSchemaProofReportChunk"), writer))
      .rejects.toThrow("result must be");
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", "not-a-uuid", reportFor("nativeUsageProofReportChunk"), writer))
      .rejects.toThrow("UUID");
    expect(writes).toBe(0);

    const nonce = randomUUID();
    const report = reportFor("nativeUsageProofReportChunk");
    const path = await retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", nonce, report, writer);
    const saved = await readFile(path);
    expect(writes).toBe(1);
    await expect(retainAndEmitNativeProofReport(root, "nativeUsageProofReportChunk", nonce, report, writer)).rejects.toThrow();
    expect(writes).toBe(1);
    expect(await readFile(path)).toEqual(saved);
  });

  test("rejects symlinked root, tmp, and report base without writing foreign files or receipts", async () => {
    const root = await freshRoot();
    const foreign = await freshRoot();
    const family = "nativeHttpSchemaProofReportChunk";
    const report = reportFor(family);
    const writer = async () => {
      throw new Error("receipt writer must not be called");
    };
    const linkedRoot = join(TEST_TMP, `native-proof-report-root-link-${randomUUID()}`);
    roots.push(linkedRoot);
    await symlink(root, linkedRoot);
    await expect(retainAndEmitNativeProofReport(linkedRoot, family, randomUUID(), report, writer)).rejects.toThrow("canonical physical path");
    await expectMissing(join(root, "tmp"));

    const tmpRoot = await freshRoot();
    await symlink(foreign, join(tmpRoot, "tmp"));
    const tmpNonce = randomUUID();
    await expect(retainAndEmitNativeProofReport(tmpRoot, family, tmpNonce, report, writer)).rejects.toThrow("tmp resolves outside");
    await expectMissing(join(foreign, "native-proof-reports"));
    await expectMissing(envelopePath(foreign, family, tmpNonce));

    const baseRoot = await freshRoot();
    await mkdir(join(baseRoot, "tmp"));
    await symlink(foreign, join(baseRoot, "tmp/native-proof-reports"));
    const baseNonce = randomUUID();
    await expect(retainAndEmitNativeProofReport(baseRoot, family, baseNonce, report, writer)).rejects.toThrow("directory resolves outside");
    await expectMissing(envelopePath(foreign, family, baseNonce));
  });

  test("writes one exact receipt from a real bun:test child through a delayed shared 4096-byte pipe", async () => {
    expect(process.platform, "native proof pipe-pressure test requires Linux").toBe("linux");
    const python = Bun.which("python3");
    expect(python, "native proof pipe-pressure test requires Python 3 for F_SETPIPE_SZ").not.toBeNull();
    const root = await freshRoot();
    const family = "nativeUsageProofReportChunk";
    const nonce = randomUUID();
    const fixturePath = join(root, "receipt-pressure.test.ts");
    const modulePath = join(import.meta.dir, "native-proof-report.ts");
    await writeFile(fixturePath, `import { test, expect } from "bun:test";
import { retainAndEmitNativeProofReport } from ${JSON.stringify(modulePath)};
test("persist before emitting compact receipt", async () => {
  const report = JSON.stringify({ status: "passed", result: "${resultFor(family)}", payload: "x".repeat(256 * 1024) });
  const path = await retainAndEmitNativeProofReport(process.env.NATIVE_PROOF_ROOT!, "${family}", "${nonce}", report);
  expect(path.endsWith("${family}-${nonce}.json")).toBe(true);
});
`, "utf8");
    const readyPath = join(root, "supervisor-ready.json");
    const goPath = join(root, "supervisor-go");
    const childPath = join(root, "bun-child.json");
    const acknowledgedPath = join(root, "bun-child-acknowledged");
    const pythonSource = [
      "import ctypes, fcntl, json, os, signal, subprocess, sys, threading, time",
      "bun, fixture, evidence_root, ready_path, go_path, child_path, acknowledged_path = sys.argv[1:8]",
      "def state(pid):",
      "  with open('/proc/' + str(pid) + '/stat', encoding='utf-8') as source: raw = source.read()",
      "  fields = raw[raw.rfind(')') + 2:].split()",
      "  return {'pid': pid, 'state': fields[0], 'pgid': int(fields[2]), 'sessionId': int(fields[3]), 'startTicks': fields[19]}",
      "def announce(path, value):",
      "  with open(path, 'x', encoding='utf-8') as target: json.dump(value, target)",
      "def wait_for(path, deadline):",
      "  while not os.path.exists(path):",
      "    if time.monotonic() >= deadline: raise TimeoutError('fixture handshake exceeded its 7s deadline: ' + path)",
      "    time.sleep(0.005)",
      "if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):",
      "  raise RuntimeError('Linux/Python pidfd supervision is required')",
      "self_fd = os.pidfd_open(os.getpid(), 0)",
      "try: signal.pidfd_send_signal(self_fd, 0)",
      "finally: os.close(self_fd)",
      "announce(ready_path, state(os.getpid()))",
      "wait_for(go_path, time.monotonic() + 7)",
      "parent_pid = os.getpid()",
      "def die_with_parent():",
      "  libc = ctypes.CDLL(None, use_errno=True)",
      "  if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0: raise OSError(ctypes.get_errno(), 'PR_SET_PDEATHSIG failed')",
      "  if os.getppid() != parent_pid: os._exit(126)",
      "read_fd, write_fd = os.pipe()",
      "capacity = fcntl.fcntl(read_fd, fcntl.F_SETPIPE_SZ, 4096)",
      "assert capacity == 4096, capacity",
      "env = os.environ.copy()",
      "env['NATIVE_PROOF_ROOT'] = evidence_root",
      "proc = None",
      "proc_fd = None",
      "reader = None",
      "captured = bytearray()",
      "try:",
      // Bun stays in the fresh detached Python group. PDEATHSIG closes the
      // spawn-to-witness gap if the supervisor dies before announcing Bun.
      "  proc = subprocess.Popen([bun, 'test', fixture], stdout=write_fd, stderr=write_fd, env=env, close_fds=True, preexec_fn=die_with_parent)",
      "  proc_fd = os.pidfd_open(proc.pid, 0)",
      "  signal.pidfd_send_signal(proc_fd, 0)",
      "  announce(child_path, state(proc.pid))",
      "  os.close(write_fd)",
      "  write_fd = None",
      "  def drain():",
      "    time.sleep(0.075)",
      "    while True:",
      "      part = os.read(read_fd, 65536)",
      "      if not part: break",
      "      captured.extend(part)",
      "  reader = threading.Thread(target=drain, daemon=True)",
      "  reader.start()",
      "  deadline = time.monotonic() + 7",
      "  try:",
      "    wait_for(acknowledged_path, deadline)",
      "    code = proc.wait(timeout=max(0, deadline - time.monotonic()))",
      "  except subprocess.TimeoutExpired as error:",
      "    try: signal.pidfd_send_signal(proc_fd, signal.SIGKILL)",
      "    except ProcessLookupError: pass",
      "    try: proc.wait(timeout=1)",
      "    except subprocess.TimeoutExpired: raise RuntimeError('Bun test child did not reap after SIGKILL') from error",
      "    raise TimeoutError('Bun test child exceeded its 7s deadline') from error",
      "finally:",
      "  if write_fd is not None: os.close(write_fd)",
      "  if proc is not None and proc.poll() is None:",
      "    try: signal.pidfd_send_signal(proc_fd, signal.SIGKILL)",
      "    except ProcessLookupError: pass",
      "    proc.wait(timeout=1)",
      "  if proc_fd is not None: os.close(proc_fd)",
      "  if reader is not None:",
      "    reader.join(timeout=1)",
      "    if reader.is_alive():",
      "      os.close(read_fd)",
      "      reader.join(timeout=0.25)",
      "      raise RuntimeError('pipe reader did not stop after Bun child reaped')",
      "  os.close(read_fd)",
      "sys.stdout.buffer.write(captured)",
      "sys.stderr.write('pipe_capacity=' + str(capacity) + ' exit=' + str(code) + '\\n')",
      "sys.exit(code)",
    ].join("\n");
    const child = Bun.spawn([python!, "-c", pythonSource, process.execPath, fixturePath, root,
      readyPath, goPath, childPath, acknowledgedPath], {
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
    let watchdogFired = false;
    let watchdogFailure: unknown;
    let watchdogCleanup: Promise<void> | undefined;
    let observed: Record<string, ProcessWitness> = {};
    const processState = async (pid: number): Promise<ProcessWitness | undefined> => {
      try {
        const raw = await readFile(`/proc/${pid}/stat`, "utf8");
        const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/u);
        return { pid, state: fields[0]!, pgid: Number(fields[2]), sessionId: Number(fields[3]), startTicks: fields[19]! };
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
        throw error;
      }
    };
    const groupMembers = async (): Promise<Record<string, ProcessWitness>> => {
      const members: Record<string, ProcessWitness> = {};
      for (const entry of await readdir("/proc")) {
        if (!/^[0-9]+$/u.test(entry)) continue;
        const state = await processState(Number(entry));
        if (state?.pgid === child.pid && state.state !== "Z") members[entry] = state;
      }
      return members;
    };
    const witness = async (path: string): Promise<ProcessWitness> => {
      while (Date.now() < startedAt + 10_000 && !watchdogFired) {
        try { return JSON.parse(await readFile(path, "utf8")) as ProcessWitness; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
        if (child.exitCode !== null) throw new Error(`fixture exited before witness ${path}`);
        await Bun.sleep(5);
      }
      throw new Error(`fixture witness timed out: ${path}`);
    };
    let leaderStartTicks: string | undefined;
    const stopOwnedChildren = async () => {
      const current = await groupMembers();
      const unobserved = Object.keys(current).filter((pid) => observed[pid] === undefined);
      observed = qualifyOwnedProcessGroup(child.pid, leaderStartTicks,
        await processState(child.pid), current, observed);
      if (Object.keys(current).length === 0) {
        await child.exited;
        return;
      }
      if (!observed[String(child.pid)]) throw new Error("original supervisor identity was not observed; refusing numeric cleanup");
      const stop = Bun.spawn([python!, join(import.meta.dir, "native-container-proof-stop.py"),
        JSON.stringify({ pgid: child.pid, members: current })], { stdout: "pipe", stderr: "pipe" });
      const [output, diagnostics, code] = await Promise.all([
        new Response(stop.stdout).text(), new Response(stop.stderr).text(), stop.exited,
      ]);
      if (code !== 0) throw new Error(`pidfd cleanup failed: ${diagnostics}`);
      expect(JSON.parse(output).mechanism).toBe("pidfd");
      await child.exited;
      const end = Date.now() + 1_000;
      while (Date.now() < end && Object.keys(await groupMembers()).length) await Bun.sleep(10);
      if (Object.keys(await groupMembers()).length) throw new Error("owned fixture group remains live after pidfd cleanup");
      if (unobserved.length) throw new Error(`unobserved fixture group members required cleanup: ${unobserved.join(", ")}`);
    };
    const startedAt = Date.now();
    let resolveWatchdog!: (value: "timeout") => void;
    const watchdogTimedOut = new Promise<"timeout">((resolve) => { resolveWatchdog = resolve; });
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      watchdogCleanup = stopOwnedChildren().catch((error) => {
        watchdogFailure = error;
      });
      resolveWatchdog("timeout");
    }, 10_000);
    let stdout = "";
    let stderr = "";
    let exitCode = Number.NaN;
    let fixtureFailure: unknown;
    let outputResult: [string, string, number] | undefined;
    try {
      const output = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      void output.then((result) => { outputResult = result; }, () => {});
      const leader = await witness(readyPath);
      const liveLeader = await processState(child.pid);
      expect(liveLeader).toMatchObject({ pid: leader.pid, pgid: leader.pgid,
        sessionId: leader.sessionId, startTicks: leader.startTicks });
      observed = qualifyOwnedProcessGroup(child.pid, leader.startTicks, liveLeader,
        { [String(child.pid)]: liveLeader! }, observed);
      leaderStartTicks = leader.startTicks;
      await writeFile(goPath, "go", { flag: "wx" });
      const bunChild = await witness(childPath);
      const currentLeader = await processState(child.pid);
      const currentBun = await processState(bunChild.pid);
      expect(currentBun).toMatchObject({ pid: bunChild.pid, pgid: bunChild.pgid,
        sessionId: bunChild.sessionId, startTicks: bunChild.startTicks });
      const currentGroup = await groupMembers();
      expect(Object.keys(currentGroup).every((pid) => pid === String(child.pid) || pid === String(bunChild.pid)),
        "fixture started an unexpected process").toBe(true);
      observed = qualifyOwnedProcessGroup(child.pid, leader.startTicks, currentLeader,
        { ...currentGroup, [String(bunChild.pid)]: currentBun! }, observed);
      await writeFile(acknowledgedPath, "ack", { flag: "wx" });
      const completed = await Promise.race([output, watchdogTimedOut]);
      if (completed === "timeout") throw new Error("receipt pressure fixture exceeded its 10s outer watchdog");
      [stdout, stderr, exitCode] = completed;
    } catch (error) {
      fixtureFailure = error;
    } finally {
      clearTimeout(watchdog);
    }
    try {
      await (watchdogCleanup ?? stopOwnedChildren());
      if (watchdogCleanup) await watchdogCleanup;
      const current = await groupMembers();
      observed = qualifyOwnedProcessGroup(child.pid, leaderStartTicks,
        await processState(child.pid), current, observed);
      if (Object.keys(current).length) throw new Error("owned fixture group remains live after supervisor exit");
      for (const member of Object.values(observed)) {
        const remaining = await processState(member.pid);
        if (remaining?.startTicks === member.startTicks && remaining.state !== "Z") {
          throw new Error(`owned fixture process remains alive: ${member.pid}`);
        }
      }
    } catch (error) {
      await writeFile(join(root, "cleanup-diagnostic.json"), JSON.stringify({
        cleanupError: String(error), fixtureFailure: String(fixtureFailure),
        stdout: outputResult?.[0] ?? null, stderr: outputResult?.[1] ?? null, observed,
      }, null, 2));
      const rootIndex = roots.indexOf(root);
      if (rootIndex >= 0) roots.splice(rootIndex, 1);
      throw new Error(`fixture cleanup unproven; preserved diagnostics at ${root}: ${String(error)}`);
    }
    if (fixtureFailure !== undefined) throw fixtureFailure;
    expect(watchdogFired, "receipt pressure fixture exceeded its 10s outer watchdog").toBe(false);
    expect(watchdogFailure).toBeUndefined();
    expect(exitCode, stderr).toBe(0);
    expect(stderr).toContain("pipe_capacity=4096 exit=0");
    expect(Buffer.byteLength(stdout, "utf8")).toBeLessThan(4096);
    const receiptLines = stdout.split("\n").filter((line) => {
      try { return JSON.parse(line).nativeProofReportRetained !== undefined; } catch { return false; }
    });
    expect(receiptLines).toHaveLength(1);
    const receipt = JSON.parse(receiptLines[0]!) as { nativeProofReportRetained: { family: string; sha256: string; bytes: number; path: string } };
    const saved = await readEnvelope(join(root, receipt.nativeProofReportRetained.path));
    expect(saved.family).toBe(family);
    expect(receipt.nativeProofReportRetained).toEqual({
      family,
      sha256: sha256(saved.serializedReport),
      bytes: Buffer.byteLength(saved.serializedReport, "utf8"),
      path: `tmp/native-proof-reports/${family}-${nonce}.json`,
    });
    expect(saved.serializedReport).toContain("x".repeat(1024));
    expect(stdout).not.toContain(saved.serializedReport);
  }, 12_000);
});
