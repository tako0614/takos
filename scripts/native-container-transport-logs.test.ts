import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureNativeContainerTransportLogs } from "./lib/native-container-transport-logs.mjs";
import { fixtureContainerName, type NativeContainerWitness } from "./lib/native-container-proof-ownership.ts";

const maxBytes = 4 * 1024 * 1024;
const agentImage = "takos-agent:local";
const agentImageId = `sha256:${"a".repeat(64)}`;
const capturedSince = "2026-10-02T12:00:00.000Z";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const witness: NativeContainerWitness = {
  runId: "run_11111111-2222-3333-4444-555555555555",
  containerId: "container_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  durableObjectId: "d".repeat(64),
  imageTag: agentImage,
  dockerImageId: agentImageId,
};
const name = fixtureContainerName(witness, agentImage, agentImageId);
const physical = { id: "1".repeat(64), name, imageId: agentImageId, imageReference: agentImage, running: true, pid: 4321 };
const dockerInspection = (changes: Record<string, unknown> = {}) => [{
  Id: physical.id, Name: physical.name, Image: physical.imageId,
  Config: { Image: physical.imageReference }, State: { Running: physical.running, Pid: physical.pid },
  ...changes,
}];

async function privateDirectory(work: (outputDir: string) => Promise<void>): Promise<void> {
  const outputDir = await mkdtemp(join(tmpdir(), "native-container-transport-logs-"));
  await chmod(outputDir, 0o700);
  try { await work(outputDir); }
  finally { await rm(outputDir, { recursive: true, force: true }); }
}

function fakeCommand(options: {
  inspection?: unknown;
  stdout?: Buffer;
  stderr?: Buffer;
}) {
  const calls: Array<{ name: string; args: string[]; timeout: number; maxBuffer: number }> = [];
  const command = async (name: string, args: string[], timeout: number, maxBuffer: number) => {
    calls.push({ name, args, timeout, maxBuffer });
    if (args[1] === "inspect") return { stdout: Buffer.from(JSON.stringify(options.inspection ?? dockerInspection())), stderr: Buffer.alloc(0) };
    return { stdout: options.stdout ?? Buffer.alloc(0), stderr: options.stderr ?? Buffer.alloc(0) };
  };
  return { command, calls };
}

function captureOptions(outputDir: string, command: ReturnType<typeof fakeCommand>["command"], changes: Record<string, unknown> = {}) {
  return {
    witness: { ...witness, dockerContainers: [{ ...physical }] },
    beforeIds: new Set<string>(), agentImage, agentImageId, outputDir,
    phase: "admission", since: capturedSince, command, ...changes,
  };
}

test("captures exact fresh Container stdout/stderr bytes privately with hashes and DEBUG count", async () => {
  await privateDirectory(async (outputDir) => {
    const stdout = Buffer.from("2026-10-02T12:00:01Z \u001b[32mDEBUG\u001b[0m request started\nINFO finished\n");
    const stderr = Buffer.from("2026-10-02T12:00:02Z WARN stderr marker\n");
    const fake = fakeCommand({ stdout, stderr });
    const record = await captureNativeContainerTransportLogs(captureOptions(outputDir, fake.command, { requireDebug: true }));

    assert.equal(record.physicalId, physical.id);
    assert.equal(record.runId, witness.runId);
    assert.equal(record.containerId, witness.containerId);
    assert.equal(record.durableObjectId, witness.durableObjectId);
    assert.equal(record.phase, "admission");
    assert.equal(record.since, capturedSince);
    assert.equal(record.capturePath, join(outputDir, "admission-agent-log-capture.json"));
    assert.equal(record.debugLines, 1);
    assert.equal(record.stdout.bytes, stdout.length);
    assert.equal(record.stdout.sha256, hash(stdout));
    assert.equal(record.stderr.bytes, stderr.length);
    assert.equal(record.stderr.sha256, hash(stderr));
    assert.deepEqual(await readFile(record.stdout.path), stdout);
    assert.deepEqual(await readFile(record.stderr.path), stderr);
    assert.equal((await stat(record.stdout.path)).mode & 0o777, 0o600);
    assert.equal((await stat(record.stderr.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(outputDir, "admission-agent-log-capture.json"))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(outputDir, "admission-agent-log-capture.json"), "utf8")).debugLines, 1);
    assert.deepEqual(fake.calls.map(({ args, timeout, maxBuffer }) => ({ args, timeout, maxBuffer })), [
      { args: ["container", "inspect", physical.id], timeout: 3_000, maxBuffer: maxBytes },
      { args: ["container", "logs", "--since", capturedSince, "--timestamps", physical.id], timeout: 5_000, maxBuffer: maxBytes },
    ]);
  });
});

test("rejects preexisting, wrong-name, wrong-image and changed-inspection witnesses before logs", async () => {
  await privateDirectory(async (outputDir) => {
    const mismatchCases = [
      { label: "preexisting", options: { beforeIds: new Set([physical.id]) }, inspection: dockerInspection() },
      { label: "wrong name", options: { witness: { ...witness, dockerContainers: [{ ...physical, name: "/other-container" }] } }, inspection: dockerInspection() },
      { label: "wrong image", options: { witness: { ...witness, dockerContainers: [{ ...physical, imageId: `sha256:${"b".repeat(64)}` }] } }, inspection: dockerInspection() },
      { label: "changed inspection", options: {}, inspection: dockerInspection({ Name: "/changed-name" }) },
    ];
    for (const [index, item] of mismatchCases.entries()) {
      const fake = fakeCommand({ inspection: item.inspection });
      const options = captureOptions(outputDir, fake.command, { phase: `mismatch-${index}`, ...item.options });
      await assert.rejects(captureNativeContainerTransportLogs(options), /preexisting|identity|witness/u, item.label);
      assert.equal(fake.calls.some((call) => call.args[1] === "logs"), false, `${item.label} reached logs`);
    }
    assert.deepEqual((await readdir(outputDir)), []);
  });
});

test("requireDebug fails closed after preserving captured logs when no DEBUG line exists", async () => {
  await privateDirectory(async (outputDir) => {
    const stdout = Buffer.from("INFO startup complete\n");
    const fake = fakeCommand({ stdout });
    await assert.rejects(captureNativeContainerTransportLogs(captureOptions(outputDir, fake.command, { requireDebug: true })), /no DEBUG lines/u);
    assert.deepEqual(await readFile(join(outputDir, "admission-agent.stdout.log")), stdout);
    assert.equal(fake.calls.some((call) => call.args[1] === "logs"), true);
  });
});

test("rejects a log stream that exceeds 4 MiB before writing evidence", async () => {
  await privateDirectory(async (outputDir) => {
    for (const [index, stream] of ["stdout", "stderr"].entries()) {
      const fake = fakeCommand({ [stream]: Buffer.alloc(maxBytes + 1, 0x41) });
      await assert.rejects(captureNativeContainerTransportLogs(captureOptions(outputDir, fake.command,
        { phase: `overflow-${index}` })), /4 MiB/u);
      assert.deepEqual(await readdir(outputDir), []);
    }
  });
});

test("refuses evidence filename reuse with wx semantics and preserves prior bytes", async () => {
  await privateDirectory(async (outputDir) => {
    const stdout = Buffer.from("DEBUG first capture\n");
    const first = fakeCommand({ stdout });
    const record = await captureNativeContainerTransportLogs(captureOptions(outputDir, first.command));
    const before = await readFile(record.stdout.path);
    const second = fakeCommand({ stdout: Buffer.from("DEBUG replacement\n") });
    await assert.rejects(captureNativeContainerTransportLogs(captureOptions(outputDir, second.command)), /reuse existing/u);
    assert.deepEqual(await readFile(record.stdout.path), before);
    assert.equal(second.calls.length, 0);
  });
});
