import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { assertFreshInspection, fixtureContainerName } from "./native-container-proof-ownership.ts";

const maxBytes = 4 * 1024 * 1024;
const physicalIdPattern = /^[a-f0-9]{64}$/u;
const phasePattern = /^[a-z][a-z0-9-]*$/u;
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function outputBytes(value, streamName) {
  ensure(Buffer.isBuffer(value) || value instanceof Uint8Array,
    `Docker command ${streamName} must be returned as raw bytes`);
  return Buffer.from(value);
}

function debugLineCount(stdout, stderr) {
  const text = stripVTControlCharacters(Buffer.concat([stdout, Buffer.from("\n"), stderr]).toString("utf8"));
  return text.split(/\r?\n/u).filter((line) => /\bDEBUG\b/u.test(line)).length;
}

async function assertPrivateOutputDirectory(outputDir) {
  ensure(typeof outputDir === "string" && resolve(outputDir) === outputDir,
    "transport log outputDir must be an absolute canonical path");
  const info = await lstat(outputDir);
  ensure(info.isDirectory() && !info.isSymbolicLink(), "transport log outputDir must be a private ordinary directory");
  ensure((info.mode & 0o077) === 0, "transport log outputDir must not be accessible by group or other users");
  ensure(await realpath(outputDir) === outputDir, "transport log outputDir must not resolve through a symlink");
}

async function assertOutputPathsUnused(paths) {
  for (const path of paths) {
    try {
      await lstat(path);
      throw new Error(`refusing to reuse existing transport log evidence: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function writeVerified(path, bytes) {
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  const info = await lstat(path);
  ensure(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600,
    `transport log evidence file has unexpected type or permissions: ${path}`);
  const readback = await readFile(path);
  const digest = sha256(bytes);
  ensure(readback.length === bytes.length && sha256(readback) === digest,
    `transport log evidence readback mismatch: ${path}`);
  return { path, bytes: readback.length, sha256: digest };
}

function validateWitness({ witness, beforeIds, agentImage, agentImageId }) {
  ensure(beforeIds instanceof Set, "transport log capture requires the preexisting Docker ID set");
  ensure(Array.isArray(witness?.dockerContainers) && witness.dockerContainers.length === 1,
    "transport log capture requires one physical Docker witness");
  const expectedName = fixtureContainerName(witness, agentImage, agentImageId);
  const physical = witness.dockerContainers[0];
  ensure(physical && physicalIdPattern.test(physical.id ?? "") && !beforeIds.has(physical.id),
    "transport log capture refuses an invalid or preexisting physical Container ID");
  ensure(physical.name === expectedName && physical.imageId === agentImageId &&
    physical.imageReference === agentImage && physical.running === true,
  "transport log witness differs from its exact Run/DO/image identity");
  ensure(physical.pid === undefined || Number.isSafeInteger(physical.pid) && physical.pid > 0,
    "transport log witness has an invalid physical process ID");
  const candidate = { id: physical.id, name: physical.name, imageId: physical.imageId,
    imageReference: physical.imageReference, running: physical.running, pid: physical.pid ?? 0 };
  return { expectedName, physical, candidate };
}

function dockerOutput(result, label) {
  ensure(result && typeof result === "object", `${label} command returned no result object`);
  const stdout = outputBytes(result.stdout, `${label} stdout`);
  const stderr = outputBytes(result.stderr, `${label} stderr`);
  return { stdout, stderr };
}

export async function captureNativeContainerTransportLogs({
  witness, beforeIds, agentImage, agentImageId, outputDir, phase, since, command, requireDebug = false,
}) {
  ensure(phasePattern.test(phase ?? ""), "invalid transport log capture phase");
  ensure(typeof since === "string" && Number.isFinite(Date.parse(since)) &&
    new Date(since).toISOString() === since, "transport log capture since must be a canonical ISO timestamp");
  ensure(typeof command === "function", "transport log capture requires the parent Docker command helper");
  ensure(typeof requireDebug === "boolean", "requireDebug must be boolean");
  await assertPrivateOutputDirectory(outputDir);
  const { expectedName, physical, candidate } = validateWitness({ witness, beforeIds, agentImage, agentImageId });
  const stdoutPath = join(outputDir, `${phase}-agent.stdout.log`);
  const stderrPath = join(outputDir, `${phase}-agent.stderr.log`);
  const capturePath = join(outputDir, `${phase}-agent-log-capture.json`);
  await assertOutputPathsUnused([stdoutPath, stderrPath, capturePath]);

  const inspectionResult = await command("docker", ["container", "inspect", physical.id], 3_000, maxBytes);
  const inspectionStreams = dockerOutput(inspectionResult, "inspect");
  ensure(inspectionStreams.stdout.length <= maxBytes && inspectionStreams.stderr.length <= maxBytes,
    "exact Container inspect exceeded the 4 MiB command bound");
  const inspectionOutput = inspectionStreams.stdout;
  let inspections;
  try { inspections = JSON.parse(inspectionOutput.toString("utf8")); }
  catch { throw new Error("exact Container inspect did not return valid JSON"); }
  ensure(Array.isArray(inspections) && inspections.length === 1,
    "exact Container inspect did not return one physical witness");
  const state = assertFreshInspection(candidate, inspections[0]);
  ensure(state.Running === true && Number.isSafeInteger(state.Pid) && state.Pid > 0 &&
    (physical.pid === undefined || physical.pid === state.Pid),
  "fresh exact Container inspection no longer matches the running physical witness");

  const logsResult = await command("docker", ["container", "logs", "--since", since, "--timestamps", physical.id],
    5_000, maxBytes);
  const { stdout, stderr } = dockerOutput(logsResult, "logs");
  ensure(stdout.length <= maxBytes && stderr.length <= maxBytes,
    "Docker transport logs exceed the 4 MiB per-stream bound");
  const count = debugLineCount(stdout, stderr);
  const capturedAt = new Date().toISOString();
  const record = {
    physicalId: physical.id,
    runId: witness.runId,
    containerId: witness.containerId,
    durableObjectId: witness.durableObjectId,
    phase,
    since,
    expectedName,
    capturedAt,
    capturePath,
    stdout: await writeVerified(stdoutPath, stdout),
    stderr: await writeVerified(stderrPath, stderr),
    debugLines: count,
  };
  const captureBytes = Buffer.from(JSON.stringify(record, null, 2) + "\n");
  await writeVerified(capturePath, captureBytes);
  ensure(!requireDebug || count > 0,
    `transport log capture for ${phase} contained no DEBUG lines`);
  return record;
}
