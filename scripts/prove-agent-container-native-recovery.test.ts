import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createNativeProofEvidenceDirectory, parseNativeContainerProofArgs } from "./lib/native-container-proof-options.ts";
import { assertFreshInspection, assertNativeRecoveryWitnesses, fixtureContainerName, selectOwnedStops, type DockerCandidate, type NativeContainerWitness } from "./lib/native-container-proof-ownership.ts";
import { qualifyOwnedProcessGroup, type ProcessWitness } from "./lib/native-container-proof-process.ts";

const root = resolve(import.meta.dir, "..");
const execFile = promisify(execFileCallback);
const values = (repositoryRoot: string): Record<string, string> => ({
  "--layout": "/tmp/explicit-oci-layout", "--reference": "local-agent", "--source-commit": "a".repeat(40),
  "--expected-manifest-digest": "sha256:" + "b".repeat(64), "--image": "owned-agent:local",
  "--sidecar-image": "egress@sha256:" + "c".repeat(64), "--bun": "/explicit/pinned/bun",
  "--output-dir": join(repositoryRoot, "tmp/native-container-recovery-proof/fresh"),
  "--callback-host": "172.17.0.1", "--listen-host": "172.17.0.1", "--port": "40123",
});
const argv = (flags: Record<string, string>) => Object.entries(flags).flat();

test("requires explicit image/source/manifest/sidecar identity and refuses malformed or repeated arguments", () => {
  const args = argv(values(root));
  assert.equal(parseNativeContainerProofArgs(args, root).expectedManifestDigest, values(root)["--expected-manifest-digest"]);
  for (const flag of ["--layout", "--expected-manifest-digest", "--source-commit", "--sidecar-image"]) {
    const incomplete = { ...values(root) }; delete incomplete[flag];
    assert.throws(() => parseNativeContainerProofArgs(argv(incomplete), root), /missing/u);
  }
  assert.throws(() => parseNativeContainerProofArgs([...args, "--image", "other:tag"], root), /node scripts/u);
  assert.throws(() => parseNativeContainerProofArgs([...args, "--deploy", "true"], root), /node scripts/u);
  const malformed: Array<Record<string, string>> = [{ "--source-commit": "short" }, { "--expected-manifest-digest": "sha256:bad" }, { "--sidecar-image": "unpinned:latest" }, { "--image": "tag with whitespace" }];
  for (const change of malformed) {
    assert.throws(() => parseNativeContainerProofArgs(argv({ ...values(root), ...change }), root));
  }
});

test("refuses another checkout/output root, relative paths and ambiguous callback authority", () => {
  const refused: Array<Record<string, string>> = [
    { "--output-dir": "/another-checkout/tmp/native-container-recovery-proof/fresh" },
    { "--output-dir": join(root, "tmp/native-container-recovery-proof") },
    { "--layout": "relative-layout" }, { "--bun": "bun" },
    { "--callback-host": "127.0.0.2" }, { "--callback-host": "localhost" },
    { "--callback-host": "0.0.0.0" }, { "--callback-host": "user@host" },
    { "--callback-host": "host/path" }, { "--port": "1e4" }, { "--port": "80" },
  ];
  for (const change of refused) assert.throws(() => parseNativeContainerProofArgs(argv({ ...values(root), ...change }), root));
});

async function temporaryRoots(work: (first: string, second: string) => Promise<void>): Promise<void> {
  const base = join(root, "tmp/native-container-proof-unit-tests");
  await mkdir(base, { recursive: true });
  const first = await mkdtemp(join(base, "checkout-"));
  const second = await mkdtemp(join(base, "foreign-"));
  try { await work(first, second); }
  finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
}

test("fresh output creation refuses reuse and preserves existing success/failure artifacts", async () => {
  await temporaryRoots(async (repositoryRoot) => {
    const options = parseNativeContainerProofArgs(argv(values(repositoryRoot)), repositoryRoot);
    await createNativeProofEvidenceDirectory(options);
    const artifact = join(options.outputDir, "failure.json");
    await writeFile(artifact, "original failure bytes\n");
    await assert.rejects(createNativeProofEvidenceDirectory(options), { code: "EEXIST" });
    assert.equal(await readFile(artifact, "utf8"), "original failure bytes\n");
  });
});

test("a symlinked tmp cannot write proof state into another checkout", async () => {
  await temporaryRoots(async (repositoryRoot, foreignRoot) => {
    await symlink(foreignRoot, join(repositoryRoot, "tmp"));
    const options = parseNativeContainerProofArgs(argv(values(repositoryRoot)), repositoryRoot);
    await assert.rejects(createNativeProofEvidenceDirectory(options), /outside the owning checkout/u);
    await assert.rejects(stat(join(foreignRoot, "native-container-recovery-proof")), { code: "ENOENT" });
  });
});

const witness: NativeContainerWitness = {
  runId: "run_11111111-2222-3333-4444-555555555555", containerId: "container_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  durableObjectId: "d".repeat(64), imageTag: "owned-agent:local", dockerImageId: "sha256:" + "a".repeat(64),
};
const ownership = { witness, beforeIds: new Set<string>(), agentImage: witness.imageTag, agentImageId: witness.dockerImageId,
  sidecarImage: "egress@sha256:" + "c".repeat(64), sidecarImageId: "sha256:" + "b".repeat(64) };
const name = fixtureContainerName(witness, ownership.agentImage, ownership.agentImageId);
const agent: DockerCandidate = { id: "1".repeat(64), name, imageId: ownership.agentImageId, imageReference: ownership.agentImage, running: true, pid: 123 };
const proxy: DockerCandidate = { id: "2".repeat(64), name: name + "-proxy", imageId: ownership.sidecarImageId, imageReference: ownership.sidecarImage, running: true, pid: 124 };
const select = (candidates: DockerCandidate[], changes: Partial<typeof ownership> = {}) => selectOwnedStops({ ...ownership, candidates, ...changes });
const inspection = (value: DockerCandidate) => ({ Id: value.id, Name: value.name, Image: value.imageId, Config: { Image: value.imageReference }, State: { Running: true, Pid: value.pid } });

test("selects only a fresh agent and exact pinned proxy while another Run is untouched", () => {
  const unrelated = { ...proxy, id: "3".repeat(64), name: "/another-DO-proxy" };
  assert.deepEqual(select([agent, proxy, unrelated]).map(({ id, cleanupRole }) => ({ id, cleanupRole })), [
    { id: agent.id, cleanupRole: "agent" }, { id: proxy.id, cleanupRole: "proxy" },
  ]);
});

test("same-image preexisting proxy is untouched and exact preexisting IDs are refused", () => {
  const other = { ...proxy, name: "/other-run-proxy" };
  assert.deepEqual(select([other], { beforeIds: new Set([other.id]) }), []);
  assert.throws(() => select([proxy], { beforeIds: new Set([proxy.id]) }), /preexisting/u);
});

test("wrong DO/image witness and duplicate/malformed physical candidates grant no cleanup authority", () => {
  assert.throws(() => select([agent], { witness: { ...witness, durableObjectId: "../foreign" } }), /native DO/u);
  assert.throws(() => select([agent], { witness: { ...witness, imageTag: "foreign:tag" } }), /image witness/u);
  assert.throws(() => select([{ ...proxy, imageReference: "foreign@sha256:" + "c".repeat(64) }]), /mismatched image/u);
  assert.throws(() => select([agent, agent]), /duplicate/u);
  assert.throws(() => select([{ ...agent, pid: 0 }]), /physical process/u);
  assert.throws(() => select([{ ...agent, id: "foreign" }]), /invalid Container/u);
});

test("changed ID/name/image/reference is refused immediately before stop", () => {
  const expected = select([agent])[0]!;
  for (const raw of [
    { ...inspection(agent), Id: "3".repeat(64) }, { ...inspection(agent), Name: "/foreign" },
    { ...inspection(agent), Image: ownership.sidecarImageId }, { ...inspection(agent), Config: { Image: ownership.sidecarImage } },
  ]) assert.throws(() => assertFreshInspection(expected, raw), /identity changed/u);
});

test("stopped owned ID has explicit state and malformed state remains red", () => {
  const expected = select([proxy])[0]!;
  const raw = { ...inspection(proxy), State: { Running: false, Pid: 0 } };
  assert.deepEqual(assertFreshInspection(expected, raw), raw.State);
  assert.throws(() => assertFreshInspection(expected, { ...raw, State: { Running: false } }), /process state/u);
  assert.deepEqual(select([{ ...proxy, running: false, pid: 0 }]), []);
});

test("physical success requires the exact two fresh Run/DO/image identities and corresponding native destroy ACKs", () => {
  const replacement = { ...witness, containerId: "container_bbbbbbbb-cccc-dddd-eeee-ffffffffffff", durableObjectId: "e".repeat(64) };
  const first = { ...witness, dockerContainers: [agent] };
  const second = { ...replacement, dockerContainers: [{ ...agent, id: "4".repeat(64), name: fixtureContainerName(replacement, ownership.agentImage, ownership.agentImageId) }] };
  const options = { witnesses: [first, second], beforeIds: new Set<string>(),
    agentImage: ownership.agentImage, agentImageId: ownership.agentImageId,
    acknowledgements: [{ status: 200, containerId: witness.containerId }, { status: 200, containerId: replacement.containerId }] };
  assertNativeRecoveryWitnesses(options);
  assert.throws(() => assertNativeRecoveryWitnesses({ ...options, acknowledgements: [options.acknowledgements[0]!, options.acknowledgements[0]!] }), /acknowledgement/u);
  assert.throws(() => assertNativeRecoveryWitnesses({ ...options, beforeIds: new Set([agent.id]) }), /physical witness/u);
  for (const change of [{ name: "/foreign-run" }, { id: agent.id }, { imageId: ownership.sidecarImageId }, { running: false }]) {
    assert.throws(() => assertNativeRecoveryWitnesses({ ...options, witnesses: [first,
      { ...second, dockerContainers: [{ ...second.dockerContainers[0]!, ...change }] }] }), /physical witness/u);
  }
  assert.throws(() => assertNativeRecoveryWitnesses({ ...options, acknowledgements: [
    options.acknowledgements[0]!, { status: 200, containerId: "foreign" }] }), /acknowledgement/u);
});

test("process cleanup rejects a reused leader, a reused descendant and an unseen orphan", () => {
  const leader: ProcessWitness = { pid: 1200, pgid: 1200, sessionId: 1200, startTicks: "100", state: "S" };
  const member: ProcessWitness = { ...leader, pid: 1201, startTicks: "101" };
  const observed = qualifyOwnedProcessGroup(1200, "100", leader, { "1200": leader, "1201": member }, {});
  assert.deepEqual(qualifyOwnedProcessGroup(1200, "100", undefined, { "1201": member }, observed), observed);
  assert.throws(() => qualifyOwnedProcessGroup(1200, "100", { ...leader, startTicks: "200" },
    { "1200": { ...leader, startTicks: "200" } }, observed), /refusing group signal/u);
  assert.throws(() => qualifyOwnedProcessGroup(1200, "100", undefined,
    { "1201": { ...member, startTicks: "201" } }, observed), /refusing group signal/u);
  assert.throws(() => qualifyOwnedProcessGroup(1200, "100", undefined, { "1202": { ...member, pid: 1202 } }, observed), /refusing group signal/u);
  assert.throws(() => qualifyOwnedProcessGroup(1200, "100", leader,
    { "1201": { ...member, sessionId: 999 } }, observed), /refusing group signal/u);
  assert.throws(() => qualifyOwnedProcessGroup(1200, "100", leader,
    { "1203": member }, observed), /refusing group signal/u);
});

test("kernel pidfd cleanup refuses a stale real process witness before stopping the exact owned child", async () => {
  const node = Bun.which("node");
  assert(node, "Linux native proof needs the pinned Node runtime");
  const child = spawn(node, ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
    { detached: true, stdio: ["pipe", "ignore", "ignore"] });
  const exited = once(child, "exit");
  try {
    await once(child, "spawn");
    assert(child.pid);
    const raw = await readFile(`/proc/${child.pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/u);
    const witness: ProcessWitness = { pid: child.pid, state: fields[0]!, pgid: Number(fields[2]),
      sessionId: Number(fields[3]), startTicks: fields[19]! };
    assert.equal(witness.pgid, child.pid);
    assert.equal(witness.sessionId, child.pid);
    const helper = join(root, "scripts/lib/native-container-proof-stop.py");
    const args = (member: ProcessWitness) => [helper, JSON.stringify({ pgid: child.pid, members: { [String(child.pid)]: member } })];
    await assert.rejects(execFile("python3", args({ ...witness, startTicks: "0" }), { timeout: 2_000 }), /identity changed/u);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    const stopped = JSON.parse((await execFile("python3", args(witness), { timeout: 2_000 })).stdout);
    assert.deepEqual(stopped, { mechanism: "pidfd", signaled: [child.pid], alreadyExited: [] });
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, "SIGKILL");
  } finally {
    // Closing this test-owned pipe lets the child exit normally on an assertion failure.
    child.stdin!.end();
    await exited;
  }
}, 5_000);

test("the real native child rejects a different parent source snapshot before building or starting a fixture", async () => {
  await temporaryRoots(async (temporaryRoot) => {
    const node = Bun.which("node");
    assert(node);
    const options = parseNativeContainerProofArgs(argv(values(root)), root);
    const digest = "sha256:" + "a".repeat(64);
    const nativeDirectory = join(temporaryRoot, "native");
    const config = { ...options, outputDir: nativeDirectory, dockerImageId: digest, sidecarImageId: "sha256:" + "c".repeat(64),
      imageIdentity: { sourceCommit: options.sourceCommit, sourceCommitEvidence: "test operator identity",
        manifestDigest: options.expectedManifestDigest, configDigest: digest, platform: "linux/amd64",
        imageUser: "takos", imageWorkdir: "/app", imageCmd: ["/usr/local/bin/takos-agent"],
        layerDigests: [digest], rootfsDiffIds: [digest] },
      sourceHashesBefore: { "package.json": "0".repeat(64) } };
    const configPath = join(temporaryRoot, "controller-config.json");
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(execFile(node, [join(root, "scripts/lib/native-container-recovery-controller.mjs"), configPath],
      { cwd: root, timeout: 3_000 }), /parent source hash differs at package.json/u);
    const failure = JSON.parse(await readFile(join(nativeDirectory, "failure.json"), "utf8"));
    assert.match(failure.error.message, /parent source hash differs at package.json/u);
    assert.deepEqual(failure.stages.map((stage: { stage: string }) => stage.stage), ["preflight-start"]);
    await assert.rejects(stat(join(nativeDirectory, "fixture-worker.ts")), { code: "ENOENT" });
    await assert.rejects(stat(join(nativeDirectory, "native-state")), { code: "ENOENT" });
    await assert.rejects(stat(join(nativeDirectory, "result.json")), { code: "ENOENT" });
  });
}, 5_000);
