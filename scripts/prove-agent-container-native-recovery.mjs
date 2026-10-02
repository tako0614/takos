#!/usr/bin/env node
// Opt-in local native proof. It uses preloaded images and fresh fixture state.
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { imageIdentity } from "./lib/oci-image-identity.ts";
import { createNativeProofEvidenceDirectory, parseNativeContainerProofArgs } from "./lib/native-container-proof-options.ts";
import { assertFreshInspection, assertNativeRecoveryWitnesses, selectOwnedStops } from "./lib/native-container-proof-ownership.ts";
import { qualifyOwnedProcessGroup } from "./lib/native-container-proof-process.ts";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outerMs = 350_000;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ensure = (value, message) => { if (!value) throw new Error(message); };
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function processState(pid) {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/u);
    return { pid, state: fields[0], pgid: Number(fields[2]), sessionId: Number(fields[3]), startTicks: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return undefined;
    throw error;
  }
}

async function groupMembers(pgid) {
  const result = {};
  for (const entry of await readdir("/proc")) {
    if (!/^[0-9]+$/u.test(entry)) continue;
    const state = await processState(Number(entry));
    if (!state || state.pgid !== pgid || state.state === "Z") continue;
    try { result[entry] = { ...state, executable: await readlink(`/proc/${entry}/exe`) }; }
    catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
  }
  return result;
}

async function heavyProcesses() {
  const result = [];
  for (const entry of await readdir("/proc")) {
    if (!/^[0-9]+$/u.test(entry)) continue;
    try {
      const executable = (await readFile(`/proc/${entry}/cmdline`)).toString().split("\0")[0].split("/").pop();
      if (["cargo", "rustc", "workerd", "docker-buildx"].includes(executable)) {
        const state = await processState(Number(entry));
        if (state && state.state !== "Z") result.push({ ...state, executable });
      }
    } catch (error) { if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error; }
  }
  return result;
}

async function main() {
  const options = parseNativeContainerProofArgs(process.argv.slice(2), root);
  ensure(process.platform === "linux" && process.version === "v26.1.0" && typeof globalThis.Bun === "undefined",
    "native proof requires the pinned Linux Node26.1.0 host");
  await createNativeProofEvidenceDirectory(options);
  const record = { startedAt: new Date().toISOString(), qualified: false, scope: "local native two-Container checkpoint/tool-ACK recovery and executor-stopped first usage projection/lost successful usage ACK/real-due cold retry/idle; fixture lease-CAS only", options, outerDeadlineMs: outerMs, observedGroupMembers: {}, dockerSnapshots: [] };
  const reportPath = join(options.outputDir, "supervisor-result.json");
  const save = async () => writeFile(reportPath, JSON.stringify(record, null, 2) + "\n");
  const dockerConfig = join(options.outputDir, "docker-config");
  await mkdir(dockerConfig, { mode: 0o700 });
  const env = { PATH: `${dirname(options.bun)}:/usr/local/bin:/usr/bin:/bin`, HOME: process.env.HOME ?? "/tmp", DOCKER_CONFIG: dockerConfig, DOCKER_HOST: "unix:///var/run/docker.sock" };
  const command = async (name, args, timeout = 15_000) => {
    const value = await execFile(name, args, { cwd: root, env, timeout, maxBuffer: 64 * 1024 * 1024 });
    return value.stdout;
  };
  const sourceSnapshot = async () => {
    const paths = (await command("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    const result = {};
    for (const path of [...new Set(paths)].sort()) result[path] = hash(await readFile(join(root, path)));
    return result;
  };
  const inspected = async (ids) => ids.length ? JSON.parse(await command("docker", ["container", "inspect", ...ids], 5_000)) : [];
  const allIds = async () => (await command("docker", ["ps", "-aq", "--no-trunc"], 5_000)).trim().split("\n").filter(Boolean);
  const dockerCandidates = async () => {
    const ids = new Set();
    for (const image of [options.image, options.sidecarImage]) {
      for (const id of (await command("docker", ["ps", "-aq", "--no-trunc", "--filter", `ancestor=${image}`], 5_000)).trim().split("\n").filter(Boolean)) ids.add(id);
    }
    return (await inspected([...ids])).map((value) => ({ id: value.Id, name: value.Name, imageId: value.Image, imageReference: value.Config.Image, running: value.State.Running, pid: value.State.Pid }));
  };
  let child, childExit, timer, stdout, stderr;
  const nativeDir = join(options.outputDir, "native");
  const childOptions = { ...options, outputDir: nativeDir };
  let signalReason;
  const signalHandler = (signal) => { signalReason = signal; };
  const sigint = () => signalHandler("SIGINT");
  const sigterm = () => signalHandler("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  async function stopOwnedGroup() {
    if (!child) return;
    const current = await groupMembers(child.pid);
    const head = await processState(child.pid);
    record.observedGroupMembers = qualifyOwnedProcessGroup(child.pid, record.controllerStartTicks, head, current, record.observedGroupMembers);
    if (Object.keys(current).length) {
      const stopped = JSON.parse(await command("python3", [join(root, "scripts/lib/native-container-proof-stop.py"),
        JSON.stringify({ pgid: child.pid, members: current })], 5_000));
      ensure(stopped.mechanism === "pidfd", "process cleanup lacks kernel-owned identity handles");
      (record.processStops ??= []).push(stopped);
      const end = Date.now() + 2_500;
      while (Date.now() < end && Object.keys(await groupMembers(child.pid)).length) await pause(25);
    }
    record.groupMembersAfter = await groupMembers(child.pid);
    ensure(Object.keys(record.groupMembersAfter).length === 0, "owned process group remains live");
  }
  try {
    ensure((await command("git", ["rev-parse", "--show-toplevel"])).trim() === await realpath(root), "source root is not this checkout");
    await access(options.bun, 1);
    ensure((await command(options.bun, ["--version"])).trim() === "1.3.14", "native proof requires pinned Bun1.3.14");
    record.processCleanupRuntime = JSON.parse(await command("python3", [join(root, "scripts/lib/native-container-proof-stop.py"), "--check"]));
    ensure(record.processCleanupRuntime.pidfdSupported === true, "Linux/Python pidfd cleanup unavailable");
    record.heavyProcessesBefore = await heavyProcesses();
    ensure(record.heavyProcessesBefore.length < 2, "heavy concurrency cap reached; native proof not started");
    childOptions.imageIdentity = await imageIdentity({ layout: options.layout, reference: options.reference, sourceCommit: options.sourceCommit, expectedManifestDigest: options.expectedManifestDigest });
    const image = JSON.parse(await command("docker", ["image", "inspect", options.image, "--format", "{{json .}}"]));
    const sidecar = JSON.parse(await command("docker", ["image", "inspect", options.sidecarImage, "--format", "{{json .}}"]));
    // The child checks descriptor/config/diff-ID equality before native start.
    childOptions.dockerImageId = image.Id;
    childOptions.sidecarImageId = sidecar.Id;
    record.imageIdentity = childOptions.imageIdentity;
    record.dockerImageId = image.Id;
    record.sidecarImageId = sidecar.Id;
    record.containersBefore = await allIds();
    record.candidatesBefore = await dockerCandidates();
    ensure(!record.candidatesBefore.some((value) => value.imageId === image.Id && value.running), "selected agent image is already running; native proof not started");
    record.sourceCommit = (await command("git", ["rev-parse", "HEAD"])).trim();
    record.workingTreeStatus = await command("git", ["status", "--porcelain=v1", "-uall"]);
    record.workingTreeDirty = Boolean(record.workingTreeStatus);
    record.sourceHashesBefore = await sourceSnapshot();
    childOptions.sourceHashesBefore = record.sourceHashesBefore;
    record.parentSourceSnapshot = { fileCount: Object.keys(record.sourceHashesBefore).length,
      sha256: hash(JSON.stringify(Object.entries(record.sourceHashesBefore).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0))) };
    const mfRequire = createRequire(import.meta.resolve("miniflare"));
    const workerdModule = mfRequire.resolve("workerd");
    const workerdRequire = createRequire(workerdModule);
    const workerdBinary = workerdRequire.resolve("@cloudflare/workerd-linux-64/bin/workerd");
    const runtimePaths = [process.execPath, options.bun, record.processCleanupRuntime.executable,
      fileURLToPath(import.meta.resolve("miniflare")), workerdModule, workerdBinary];
    record.runtimeHashesBefore = {};
    for (const path of runtimePaths) record.runtimeHashesBefore[path] = hash(await readFile(path));
    record.runtimePaths = runtimePaths;
    const config = join(options.outputDir, "controller-config.json");
    await writeFile(config, JSON.stringify(childOptions, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    stdout = createWriteStream(join(options.outputDir, "controller-stdout.log"), { flags: "wx", mode: 0o600 });
    stderr = createWriteStream(join(options.outputDir, "controller-stderr.log"), { flags: "wx", mode: 0o600 });
    for (const stream of [stdout, stderr]) stream.on("error", (error) => { signalReason = `native log write failed: ${error}`; });
    const args = ["-n", "10", "ionice", "-c", "2", "-n", "7", process.execPath, join(root, "scripts/lib/native-container-recovery-controller.mjs"), config];
    child = spawn("nice", args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let exited = false;
    // Install listeners before the first await: a failed spawn has no PID or exit event.
    childExit = new Promise((done) => {
      child.once("error", (error) => { exited = true; done({ code: null, signal: null, error: String(error) }); });
      child.once("exit", (code, signal) => { exited = true; done({ code, signal }); });
    });
    ensure(Number.isSafeInteger(child.pid), "native controller could not spawn");
    record.pid = child.pid;
    record.pgid = child.pid;
    record.controllerStartTicks = (await processState(child.pid))?.startTicks;
    let logBytes = 0;
    const logLimit = 64 * 1024 * 1024;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (bytes) => {
      logBytes += bytes.length;
      if (logBytes > logLimit) {
        signalReason = "log size bound exceeded";
        stream.unpipe();
        stream.pause();
      }
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    const began = performance.now();
    timer = setTimeout(() => {
      signalReason = "outer deadline exceeded";
      record.interrupted = signalReason;
      void stopOwnedGroup().catch((error) => { record.groupCleanupError = String(error); });
    }, outerMs);
    while (!exited) {
      const members = await groupMembers(child.pid);
      record.observedGroupMembers = qualifyOwnedProcessGroup(child.pid, record.controllerStartTicks,
        await processState(child.pid), members, record.observedGroupMembers);
      if (signalReason) { record.interrupted = signalReason; await stopOwnedGroup(); break; }
      const candidates = await dockerCandidates();
      record.dockerSnapshots.push({ elapsedSeconds: (performance.now() - began) / 1000, candidates });
      await save();
      await pause(1_000);
    }
    record.controllerExit = await Promise.race([childExit, pause(5_000).then(() => { throw new Error("controller did not reap"); })]);
    record.elapsedSeconds = (performance.now() - began) / 1000;
    clearTimeout(timer);
    await stopOwnedGroup();
    await Promise.race([Promise.all([new Promise((done) => stdout.writableFinished ? done() : stdout.once("finish", done)), new Promise((done) => stderr.writableFinished ? done() : stderr.once("finish", done))]), pause(2_500).then(() => { throw new Error("native log pipes did not close"); })]);
    ensure(record.controllerExit.code === 0,
      "native controller exited unsuccessfully; raw diagnostics are retained in controller-stderr.log");
    record.nativeReport = await readJson(join(nativeDir, "result.json"));
    record.nativeCleanup = await readJson(join(nativeDir, "native-container-cleanup.json"));
    const nativeSources = record.nativeReport.sourceHashesBefore;
    ensure(nativeSources && Object.keys(nativeSources).length > 0 &&
      Object.entries(nativeSources).every(([path, digest]) => record.sourceHashesBefore[path] === digest),
      "native child source snapshot differs from its supervisor");
    ensure(record.nativeReport.sourceCommit === record.sourceCommit &&
      record.nativeReport.sourceState?.headCommit === record.sourceCommit &&
      record.nativeReport.sourceState?.dirtyStatus === record.workingTreeStatus,
      "native child commit or dirty-state identity differs from its supervisor");
    for (const phase of ["before", "after"]) {
      const snapshot = record.nativeReport.parentSourceSnapshot?.[phase];
      ensure(snapshot?.fileCount === record.parentSourceSnapshot.fileCount &&
        snapshot.sha256 === record.parentSourceSnapshot.sha256,
        "native child full source-map readback differs from its supervisor");
    }
    record.sourceIdentityLinked = true;
    record.nativePassed = record.controllerExit.code === 0 && record.nativeReport.status === "passed" && record.nativeReport.result === "LOCAL_CANONICAL_CONTAINER_FIRST_PROJECTOR_LOST_ACK_COLD_RETRY_PROBE_OK";
  } catch (error) {
    record.error = { name: error.name, message: error.message, stack: error.stack, stdout: error.stdout, stderr: error.stderr };
  } finally {
    if (signalReason) record.interrupted = signalReason;
    clearTimeout(timer);
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
    if (child) {
      try { await stopOwnedGroup(); }
      catch (error) { record.groupCleanupError = String(error); }
      if (childExit) await Promise.race([childExit.catch(() => undefined), pause(5_000)]);
    }
    stdout?.end();
    stderr?.end();
    try {
      if (record.containersBefore) {
        const witnesses = [];
        for (const file of ["container-witness.json", "replacement-container-witness.json"]) {
          try { witnesses.push(await readJson(join(nativeDir, file))); }
          catch (error) { ensure(error.code === "ENOENT", `cannot read owned Container witness: ${error.stack ?? error}`); }
        }
        record.witnesses = witnesses;
        const candidates = await dockerCandidates();
        record.ownedStops = [];
        const selected = new Set();
        for (const witness of witnesses) {
          for (const value of selectOwnedStops({ witness, beforeIds: new Set(record.containersBefore), candidates, agentImage: options.image, agentImageId: record.dockerImageId, sidecarImage: options.sidecarImage, sidecarImageId: record.sidecarImageId })) {
            ensure(!selected.has(value.id), "duplicate physical cleanup identity across Run witnesses");
            selected.add(value.id);
            const before = assertFreshInspection(value, (await inspected([value.id]))[0]);
            if (before.Running) await command("docker", ["container", "stop", "--time", "2", value.id], 10_000);
            const after = assertFreshInspection(value, (await inspected([value.id]))[0]);
            ensure(!after.Running && after.Pid === 0, "exact owned Container survived stop");
            record.ownedStops.push({ ...value, before, after });
          }
        }
        record.containersAfter = await allIds();
        ensure(record.containersBefore.every((id) => record.containersAfter.includes(id)), "a preexisting Container ID disappeared");
        record.candidatesAfter = await dockerCandidates();
        record.remainingOwned = record.candidatesAfter.filter((value) => !record.containersBefore.includes(value.id) && value.running);
        ensure(record.remainingOwned.length === 0, "fresh running agent/proxy remains");
      }
      if (record.sourceHashesBefore) {
        record.sourceHashesAfter = await sourceSnapshot();
        record.sourceBytesUnchanged = JSON.stringify(record.sourceHashesAfter) === JSON.stringify(record.sourceHashesBefore);
        ensure(record.sourceBytesUnchanged, "checkout source bytes changed during native proof");
      }
      if (record.runtimePaths) {
        record.runtimeHashesAfter = {};
        for (const path of record.runtimePaths) record.runtimeHashesAfter[path] = hash(await readFile(path));
        record.runtimeBytesUnchanged = JSON.stringify(record.runtimeHashesAfter) === JSON.stringify(record.runtimeHashesBefore);
        ensure(record.runtimeBytesUnchanged, "native runtime bytes changed during proof");
      }
    } catch (error) { record.cleanupOrReadbackError = String(error); }
    const acknowledgements = record.nativeCleanup?.acknowledgements ?? [];
    record.nativeCleanupAcknowledged = record.nativeCleanup?.status === "acknowledged" && record.nativeCleanup?.httpStatus === 200 && acknowledgements.length === 2 && acknowledgements.every((value) => value.status === 200) && new Set(acknowledgements.map((value) => value.containerId)).size === 2;
    record.physicalWitnessQualified = false;
    try {
      assertNativeRecoveryWitnesses({ witnesses: record.witnesses, acknowledgements,
        beforeIds: new Set(record.containersBefore), agentImage: options.image, agentImageId: record.dockerImageId });
      record.physicalWitnessQualified = true;
    } catch (error) { record.physicalWitnessError = String(error); }
    record.qualified = !record.error && !record.interrupted && !record.groupCleanupError && !record.cleanupOrReadbackError && record.nativePassed === true && record.nativeCleanupAcknowledged === true && record.physicalWitnessQualified === true && record.sourceIdentityLinked === true && record.sourceBytesUnchanged === true && record.runtimeBytesUnchanged === true && Object.keys(record.groupMembersAfter ?? { absent: true }).length === 0;
    record.finishedAt = new Date().toISOString();
    await save();
  }
  process.stdout.write(JSON.stringify({ result: record.qualified ? "NATIVE_CONTAINER_CHECKPOINT_USAGE_RECOVERY_PROOF_OK" : "NATIVE_CONTAINER_CHECKPOINT_USAGE_RECOVERY_PROOF_FAILED", qualified: record.qualified, sourceCommit: record.sourceCommit, workingTreeDirty: record.workingTreeDirty, evidence: reportPath, nativeEvidence: join(nativeDir, "result.json"), error: record.error?.message ?? record.cleanupOrReadbackError ?? record.interrupted }) + "\n");
  process.exitCode = record.qualified ? 0 : 1;
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
