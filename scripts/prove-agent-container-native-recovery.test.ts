import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { createNativeProofEvidenceDirectory, parseNativeContainerProofArgs } from "./lib/native-container-proof-options.ts";
import { assertActualHeartbeatRecent, assertHeartbeatActuallyStale, assertNoEarlyRecovery,
  assertMonotonicHeartbeatAge, assertNativeStaleWindowQualification, assertRunSnapshotUnchanged, nativeContainerProofBudgets,
  remainingActualStaleWindowMs } from "./lib/native-container-stale-window.mjs";
import { createNativeContainerWorkerFixture } from "./lib/native-container-worker-fixture.mjs";
import { assertFreshInspection, assertNativeRecoveryWitnesses, fixtureContainerName, nativeRecoveryPoolContainerId, selectOwnedStops, type DockerCandidate, type NativeContainerWitness } from "./lib/native-container-proof-ownership.ts";
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

test("diagnostic transport logging is opt-in and refuses duplicate or valued toggles", () => {
  const args = argv(values(root));
  assert.equal(parseNativeContainerProofArgs(args, root).diagnosticContainerTransport, false);
  assert.equal(parseNativeContainerProofArgs(["--diagnostic-container-transport", ...args], root).diagnosticContainerTransport, true);
  assert.throws(() => parseNativeContainerProofArgs([...args, "--diagnostic-container-transport", "--diagnostic-container-transport"], root));
  assert.throws(() => parseNativeContainerProofArgs([...args, "--diagnostic-container-transport", "false"], root));
});

test("actual stale-window option is opt-in, boolean, and rejects duplicates", () => {
  const args = argv(values(root));
  assert.equal(parseNativeContainerProofArgs(args, root).actualStaleWindow, false);
  assert.equal(parseNativeContainerProofArgs(["--actual-stale-window", ...args], root).actualStaleWindow, true);
  assert.throws(() => parseNativeContainerProofArgs(["--actual-stale-window", "--actual-stale-window", ...args], root));
  assert.throws(() => parseNativeContainerProofArgs([...args, "--actual-stale-window", "false"], root));
});

test("stale-window budgets preserve default phases and add only the bounded real wait", () => {
  assert.deepEqual(nativeContainerProofBudgets(false), {
    mode: "fixture-aged-heartbeat", childTimeoutMs: 320_000, outerTimeoutMs: 350_000,
    admissionPhaseMs: 45_000, oldToolAckLossPhaseMs: 45_000, staleRecoveryPhaseMs: 45_000,
    completionPhaseMs: 90_000, actualStaleWindowMs: 0, actualStaleWindowWaitMaxMs: 0,
  });
  assert.deepEqual(nativeContainerProofBudgets(true), {
    mode: "actual-stale-window", childTimeoutMs: 635_000, outerTimeoutMs: 665_000,
    admissionPhaseMs: 45_000, oldToolAckLossPhaseMs: 45_000, staleRecoveryPhaseMs: 45_000,
    completionPhaseMs: 90_000, actualStaleWindowMs: 300_000, actualStaleWindowWaitMaxMs: 315_000,
  });
});

test("actual stale-window validation rejects invalid or mutated heartbeats and Run snapshots", () => {
  const now = 1_800_000_000_000;
  const snapshot = { run: { id: "run-1", service_heartbeat: new Date(now - 10_000).toISOString(), service_id: "service-old", lease_version: 7 } };
  const heartbeatAt = assertActualHeartbeatRecent(snapshot, now);
  assert.equal(remainingActualStaleWindowMs(heartbeatAt, now), 290_001);
  assert.throws(() => assertActualHeartbeatRecent({ run: { service_heartbeat: "invalid" } }, now), /valid heartbeat/u);
  assert.throws(() => assertActualHeartbeatRecent({ run: { service_heartbeat: new Date(now - 300_000).toISOString() } }, now), /less than 300 seconds/u);
  assert.throws(() => assertActualHeartbeatRecent({ run: { service_heartbeat: new Date(now + 1).toISOString() } }, now), /valid heartbeat/u);
  assert.throws(() => remainingActualStaleWindowMs(heartbeatAt, now + 300_001), /valid recent heartbeat/u);
  assertHeartbeatActuallyStale(heartbeatAt, heartbeatAt + 300_001);
  assert.throws(() => assertHeartbeatActuallyStale(heartbeatAt, heartbeatAt + 300_000), /has not exceeded/u);
  assert.equal(assertMonotonicHeartbeatAge(10_000, 290_001, true), 300_001);
  assert.throws(() => assertMonotonicHeartbeatAge(10_000, 290_000, true), /does not prove/u);
  assert.equal(assertMonotonicHeartbeatAge(10_000, 289_999, false), 299_999);
  assert.throws(() => assertMonotonicHeartbeatAge(10_000, 290_000, false), /did not finish before/u);
  assertRunSnapshotUnchanged(snapshot, structuredClone(snapshot));
  const mutated = structuredClone(snapshot); mutated.run.service_id = "service-new";
  assert.throws(() => assertRunSnapshotUnchanged(snapshot, mutated), /snapshot changed/u);
  const heartbeatMutated = structuredClone(snapshot); heartbeatMutated.run.service_heartbeat = new Date(now - 20_000).toISOString();
  assert.throws(() => assertRunSnapshotUnchanged(snapshot, heartbeatMutated), /snapshot changed/u);
  const fullSnapshot = { state: { run: snapshot.run, operations: [{ id: "op-1", status: "completed" }],
    receipts: [{ event_key: "receipt-1" }], artifacts: [{ id: "artifact-1", name: "result" }] },
  owner: { id: "owner-1", status: "active" }, workspace: { id: "workspace-1", owner_account_id: "owner-1" },
  checkpoint: { runId: "run-1", digest: "checkpoint-1" } };
  for (const mutate of [
    (value: typeof fullSnapshot) => { value.owner.status = "disabled"; },
    (value: typeof fullSnapshot) => { value.workspace.owner_account_id = "foreign-owner"; },
    (value: typeof fullSnapshot) => { value.checkpoint.digest = "changed"; },
    (value: typeof fullSnapshot) => { value.state.operations[0]!.status = "pending"; },
    (value: typeof fullSnapshot) => { value.state.receipts[0]!.event_key = "changed"; },
    (value: typeof fullSnapshot) => { value.state.artifacts[0]!.name = "changed"; },
  ]) {
    const changed = structuredClone(fullSnapshot); mutate(changed);
    assert.throws(() => assertRunSnapshotUnchanged(fullSnapshot, changed), /snapshot changed/u);
  }
});

test("early scheduled evidence rejects a claim and actual fixture age route refuses before SQL", async () => {
  const runId = "run-1";
  const evidence = { expectedOldServiceId: "service-old", state: { run: { service_id: "service-old", lease_version: 7 } },
    emitted: [], hostDispatches: [], acknowledgements: [], recovery: { reclaimed: false } };
  assertNoEarlyRecovery(evidence, runId);
  assert.throws(() => assertNoEarlyRecovery({ ...evidence, emitted: [{ body: { runId } }] }, runId), /before its real stale threshold/u);
  assert.throws(() => assertNoEarlyRecovery({ ...evidence, hostDispatches: [{ request: { runId } }] }, runId), /before its real stale threshold/u);
  assert.throws(() => assertNoEarlyRecovery({ ...evidence, acknowledgements: [{ runId }] }, runId), /before its real stale threshold/u);
  assert.throws(() => assertNoEarlyRecovery({ ...evidence, recovery: { reclaimed: true } }, runId), /before its real stale threshold/u);
  assert.throws(() => assertNoEarlyRecovery({ ...evidence, state: { run: { service_id: "service-new", lease_version: 8 } } }, runId), /before its real stale threshold/u);
  const fixture = createNativeContainerWorkerFixture({ root, run: { runId, containerId: "container-old",
    newContainerId: "container-new", serviceId: "service-old", ownerId: "owner-1", workspaceId: "workspace-1", threadId: "thread-1" },
  controllerToken: "controller", observerNonce: "nonce", actualStaleWindow: true });
  const start = fixture.indexOf("if (path === '/__probe/age-recovery' && request.method === 'POST') {");
  const end = fixture.indexOf("if (path === '/__probe/duplicate-recovery'", start);
  assert(start >= 0 && end > start, "generated manual-age route is missing");
  let sqlCalls = 0;
  const response: Response = await runInNewContext(`(async () => { ${fixture.slice(start, end)} })()`, {
    path: "/__probe/age-recovery", request: { method: "POST" }, actualStaleWindow: true,
    Response,
    requireValue(value: unknown, message: string) { if (!value) throw new Error(message); },
    env: { DB: { prepare() { sqlCalls++; throw new Error("SQL must not run"); } } },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: "actual_stale_window_manual_age_forbidden" });
  assert.equal(sqlCalls, 0, "refused actual-mode manual ageing accessed SQL");
});

test("supervisor rejects mismatched, incomplete, early or mutated actual stale-window evidence", () => {
  const heartbeatMs = 1_800_000_000_000;
  const heartbeat = new Date(heartbeatMs).toISOString();
  const baseline = {
    state: { run: { id: "run-1", status: "running", service_id: "old-service", lease_version: 7,
      account_id: "workspace-1", requester_account_id: "owner-1", service_heartbeat: heartbeat },
    operations: [{ id: "operation-1", status: "completed" }], receipts: [], artifacts: [{ id: "artifact-1" }] },
    owner: { id: "owner-1", type: "user", status: "active", owner_account_id: "owner-1" },
    workspace: { id: "workspace-1", type: "team", status: "active", owner_account_id: "owner-1" },
    checkpoint: { runId: "run-1" },
    recovery: { nativeDestroyAcknowledged: true, reclaimed: false },
  };
  const evidence = {
    baseline, afterManualAgeSnapshot: structuredClone(baseline), afterEarlyScheduledSnapshot: structuredClone(baseline),
    afterWaitSnapshot: structuredClone(baseline), heartbeatAt: heartbeat,
    baselineObservedAt: new Date(heartbeatMs + 10_000).toISOString(), heartbeatAgeBefore: 10_000,
    earlyStartElapsedMs: 100, earlyFinishElapsedMs: 1_000,
    manualAgeRejected: { rejected: true, attempts: 1, status: 409, code: "actual_stale_window_manual_age_forbidden", sqlSnapshotUnchanged: true },
    earlyScheduledOutcome: { outcome: "ok" },
    earlyCanonical: { backgroundErrors: 0, emitted: [], hostDispatches: [], acknowledgements: [] },
    actualWaitElapsedMs: 289_020, monotonicElapsedMs: 290_020,
    heartbeatAgeAfter: 300_020, monotonicHeartbeatAgeAfter: 300_020,
    staleObservedAt: new Date(heartbeatMs + 300_020).toISOString(),
    positiveInvocationAt: new Date(heartbeatMs + 300_030).toISOString(),
    positiveInvocationElapsedMs: 290_030, monotonicHeartbeatAgeAtPositiveInvocation: 300_030,
    claimScope: "proves the unchanged Run heartbeat exceeded 300 seconds; it does not claim the old physical Container was absent for 300 seconds",
  };
  const budgets = nativeContainerProofBudgets(true);
  const report = { proofMode: budgets.mode, budgets, sourceState: { proofMode: budgets.mode, actualStaleWindow: true },
    limitation: "Run heartbeat was observed recent, remained unchanged, and crossed its 300-second stale threshold; whole workerd restart is not proven",
    containerWitness: { runId: "run-1" },
    recovery: { runId: "run-1", oldServiceId: "old-service", staleEligibility: evidence } };
  assert.equal(assertNativeStaleWindowQualification({ actualStaleWindow: true, budgets, report, evidence }), true);
  const check = (changedEvidence: typeof evidence) => assertNativeStaleWindowQualification({ actualStaleWindow: true,
    budgets, report: { ...report, recovery: { ...report.recovery, staleEligibility: changedEvidence } }, evidence: changedEvidence });
  for (const field of ["heartbeatAgeAfter", "monotonicHeartbeatAgeAfter", "monotonicHeartbeatAgeAtPositiveInvocation"]) {
    const changed = structuredClone(evidence); Reflect.deleteProperty(changed, field);
    assert.throws(() => check(changed), `missing ${field} must not qualify`);
  }
  for (const mutate of [
    (value: typeof evidence) => { value.afterWaitSnapshot.state.run.service_heartbeat = new Date(heartbeatMs - 1).toISOString(); },
    (value: typeof evidence) => { value.afterEarlyScheduledSnapshot.recovery.reclaimed = true; },
    (value: typeof evidence) => { value.manualAgeRejected.status = 500; },
    (value: typeof evidence) => { value.manualAgeRejected.code = "unrelated-error"; },
    (value: typeof evidence) => { value.monotonicElapsedMs = 289_999; },
    (value: typeof evidence) => { value.monotonicHeartbeatAgeAfter = 999_999; },
    (value: typeof evidence) => { value.monotonicHeartbeatAgeAtPositiveInvocation = 999_999; },
    (value: typeof evidence) => { value.earlyFinishElapsedMs = 99; },
    (value: typeof evidence) => { value.positiveInvocationElapsedMs = 290_010; },
    (value: typeof evidence) => { value.staleObservedAt = new Date(heartbeatMs + 300_000).toISOString(); },
    (value: typeof evidence) => { value.claimScope = "proves whole-workerd restart and 300-second physical absence"; },
  ]) {
    const changed = structuredClone(evidence); mutate(changed);
    assert.throws(() => check(changed));
  }
  const wrongFile = structuredClone(evidence); wrongFile.manualAgeRejected.rejected = false;
  assert.throws(() => assertNativeStaleWindowQualification({ actualStaleWindow: true, budgets, report, evidence: wrongFile }));
  assert.throws(() => assertNativeStaleWindowQualification({ actualStaleWindow: true, budgets,
    report: { ...report, containerWitness: { runId: "another-run" } }, evidence }));
  const forgedBudgets = { ...budgets, childTimeoutMs: 999_999 };
  assert.throws(() => assertNativeStaleWindowQualification({ actualStaleWindow: true, budgets: forgedBudgets,
    report: { ...report, budgets: forgedBudgets }, evidence }));
  const defaults = nativeContainerProofBudgets(false);
  assert.equal(assertNativeStaleWindowQualification({ actualStaleWindow: false, budgets: defaults,
    report: { proofMode: defaults.mode, budgets: defaults, sourceState: { proofMode: defaults.mode, actualStaleWindow: false } } }), true);
  assert.throws(() => assertNativeStaleWindowQualification({ actualStaleWindow: false, budgets: defaults, report, evidence }));
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

test("pool cleanup accepts only the isolated revision for the witnessed Run", () => {
  const containerId = nativeRecoveryPoolContainerId(witness.runId);
  const pooled = { ...witness, containerId };
  assert.equal(containerId, "tier1-warm-0-11111111-2222-3333-4444-555555555555");
  assert.equal(fixtureContainerName(pooled, ownership.agentImage, ownership.agentImageId), name);
  assert.deepEqual(select([agent, proxy], { witness: pooled }).map((value) => value.id), [agent.id, proxy.id]);
  for (const foreignId of ["tier1-warm-0", "tier1-warm-1-11111111-2222-3333-4444-555555555555",
    "tier1-warm-0-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]) {
    assert.throws(() => select([agent, proxy], { witness: { ...witness, containerId: foreignId } }), /physical-slot identity/u);
  }
  assert.throws(() => nativeRecoveryPoolContainerId("run_foreign"), /Run identity/u);
});

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
      sourceHashesBefore: { "package.json": "0".repeat(64) }, containersBefore: [] };
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
