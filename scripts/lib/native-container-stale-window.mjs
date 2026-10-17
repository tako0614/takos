import { createHash } from 'node:crypto';
import { MAX_CHECKPOINT_BYTES, MAX_INLINE_CHECKPOINT_BYTES } from './native-recovery-checkpoint-witness.mjs';

export const ACTUAL_STALE_WINDOW_MS = 300_000;
export const ACTUAL_STALE_WINDOW_WAIT_MAX_MS = 315_000;
export const DEFAULT_CHILD_TIMEOUT_MS = 320_000;
export const DEFAULT_OUTER_TIMEOUT_MS = 350_000;
export const STALE_WINDOW_PHASE_MS = 45_000;
export const COMPLETION_PHASE_MS = 90_000;

export function nativeContainerProofBudgets(actualStaleWindow) {
  if (typeof actualStaleWindow !== 'boolean') throw new Error('actualStaleWindow must be boolean');
  return {
    mode: actualStaleWindow ? 'actual-stale-window' : 'fixture-aged-heartbeat',
    childTimeoutMs: DEFAULT_CHILD_TIMEOUT_MS + (actualStaleWindow ? ACTUAL_STALE_WINDOW_WAIT_MAX_MS : 0),
    outerTimeoutMs: DEFAULT_OUTER_TIMEOUT_MS + (actualStaleWindow ? ACTUAL_STALE_WINDOW_WAIT_MAX_MS : 0),
    admissionPhaseMs: STALE_WINDOW_PHASE_MS,
    oldToolAckLossPhaseMs: STALE_WINDOW_PHASE_MS,
    staleRecoveryPhaseMs: STALE_WINDOW_PHASE_MS,
    completionPhaseMs: COMPLETION_PHASE_MS,
    actualStaleWindowMs: actualStaleWindow ? ACTUAL_STALE_WINDOW_MS : 0,
    actualStaleWindowWaitMaxMs: actualStaleWindow ? ACTUAL_STALE_WINDOW_WAIT_MAX_MS : 0,
  };
}

export function assertActualHeartbeatRecent(snapshot, now = Date.now()) {
  const heartbeat = snapshot?.run?.service_heartbeat;
  const at = typeof heartbeat === 'string' ? Date.parse(heartbeat) : Number.NaN;
  if (!Number.isFinite(at) || at > now || now - at >= ACTUAL_STALE_WINDOW_MS)
    throw new Error('actual stale-window proof requires a valid heartbeat less than 300 seconds old');
  return at;
}

export function assertRunSnapshotUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('actual stale-window SQL snapshot changed before the real stale threshold');
}

export function assertNoEarlyRecovery(evidence, runId) {
  const emitted = (evidence?.emitted ?? []).filter((item) => item?.body?.runId === runId);
  const hostDispatches = (evidence?.hostDispatches ?? []).filter((item) => item?.request?.runId === runId);
  const acknowledgements = (evidence?.acknowledgements ?? []).filter((item) => item?.runId === runId);
  if (emitted.length || hostDispatches.length || acknowledgements.length || evidence?.state?.run?.service_id !== evidence?.expectedOldServiceId ||
      evidence?.state?.run?.lease_version !== 7 || evidence?.recovery?.reclaimed === true)
    throw new Error('canonical scheduled recovery claimed or dispatched the Run before its real stale threshold');
}

export function remainingActualStaleWindowMs(heartbeatAt, now = Date.now()) {
  if (!Number.isFinite(heartbeatAt) || heartbeatAt > now || now - heartbeatAt >= ACTUAL_STALE_WINDOW_MS)
    throw new Error('actual stale-window wait requires a valid recent heartbeat');
  const remaining = heartbeatAt + ACTUAL_STALE_WINDOW_MS + 1 - now;
  if (remaining < 0 || remaining > ACTUAL_STALE_WINDOW_WAIT_MAX_MS)
    throw new Error('actual stale-window wait exceeds its 315-second bound');
  return remaining;
}

export function assertHeartbeatActuallyStale(heartbeatAt, now = Date.now()) {
  if (!Number.isFinite(heartbeatAt) || now - heartbeatAt <= ACTUAL_STALE_WINDOW_MS)
    throw new Error('actual heartbeat has not exceeded the 300-second stale threshold');
}

export function assertMonotonicHeartbeatAge(heartbeatAgeAtSnapshotMs, monotonicElapsedMs, shouldBeStale) {
  if (!Number.isFinite(heartbeatAgeAtSnapshotMs) || heartbeatAgeAtSnapshotMs < 0 ||
      !Number.isFinite(monotonicElapsedMs) || monotonicElapsedMs < 0)
    throw new Error('actual stale-window proof has invalid monotonic timing evidence');
  const age = heartbeatAgeAtSnapshotMs + monotonicElapsedMs;
  if (shouldBeStale ? age <= ACTUAL_STALE_WINDOW_MS : age >= ACTUAL_STALE_WINDOW_MS)
    throw new Error(shouldBeStale
      ? 'monotonic elapsed time does not prove the 300-second heartbeat threshold'
      : 'early scheduled invocation did not finish before the 300-second heartbeat threshold');
  return age;
}

function safeString(value, maxLength = 256) {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

export function actualStaleCheckpointBindingDiagnostics(baseline) {
  const run = baseline?.state?.run;
  const checkpoint = baseline?.checkpoint;
  const pending = Array.isArray(checkpoint?.pendingToolCallIds)
    ? checkpoint.pendingToolCallIds.slice(0, 2).map((value) => safeString(value)) : null;
  const stored = run?.engine_checkpoint;
  const storedString = typeof stored === 'string' ? stored : null;
  const storedBytes = storedString === null ? null : Buffer.byteLength(storedString, 'utf8');
  const computedStoredSha256 = storedString === null || storedBytes > MAX_CHECKPOINT_BYTES ? null
    : createHash('sha256').update(Buffer.from(storedString, 'utf8')).digest('hex');
  const usage = checkpoint?.usage;
  const serializedBytes = Number.isSafeInteger(checkpoint?.serializedBytes) ? checkpoint.serializedBytes : null;
  const storageMatchesPrefix = checkpoint?.storage === 'r2'
    ? storedString?.startsWith('r2:') === true
    : checkpoint?.storage === 'inline' && storedString !== null && !storedString.startsWith('r2:');
  const serializedBytesWithinStorageLimits = serializedBytes !== null && serializedBytes > 0 &&
    serializedBytes <= MAX_CHECKPOINT_BYTES &&
    (checkpoint?.storage === 'inline' ? serializedBytes <= MAX_INLINE_CHECKPOINT_BYTES
      : checkpoint?.storage === 'r2' && serializedBytes > MAX_INLINE_CHECKPOINT_BYTES);
  return {
    run: { id: safeString(run?.id), status: safeString(run?.status), serviceId: safeString(run?.service_id),
      leaseVersion: Number.isSafeInteger(run?.lease_version) ? run.lease_version : null,
      engineCheckpointPresent: storedString !== null && storedString.length > 0,
      engineCheckpointUtf8Bytes: storedBytes,
      engineCheckpointSha256: computedStoredSha256 },
    recovery: { runId: safeString(baseline?.recovery?.runId), oldContainerId: safeString(baseline?.recovery?.oldContainerId),
      nativeDestroyAcknowledged: baseline?.recovery?.nativeDestroyAcknowledged === true,
      reclaimed: baseline?.recovery?.reclaimed === true },
    witness: { storage: safeString(checkpoint?.storage), storedSha256: safeString(checkpoint?.storedSha256),
      storedShaMatches: typeof checkpoint?.storedSha256 === 'string' && checkpoint.storedSha256 === computedStoredSha256,
      serializedSha256: safeString(checkpoint?.serializedSha256),
      serializedSha256FormatValid: typeof checkpoint?.serializedSha256 === 'string' && /^[0-9a-f]{64}$/u.test(checkpoint.serializedSha256),
      serializedBytes,
      serializedBytesWithinStorageLimits,
      storageMatchesPrefix,
      graphId: safeString(checkpoint?.graphId), node: safeString(checkpoint?.node), status: safeString(checkpoint?.status),
      loopId: safeString(checkpoint?.loopId), sessionId: safeString(checkpoint?.sessionId), pendingToolCallIds: pending,
      pendingToolCallMatches: pending?.length === 1 && pending[0] === 'call-recovery-1',
      usage: { inputTokens: Number.isSafeInteger(usage?.inputTokens) ? usage.inputTokens : null,
        outputTokens: Number.isSafeInteger(usage?.outputTokens) ? usage.outputTokens : null,
        cachedInputTokens: Number.isSafeInteger(usage?.cachedInputTokens) ? usage.cachedInputTokens : null,
        matchesExpected: usage?.inputTokens === 11 && usage?.outputTokens === 3 && usage?.cachedInputTokens === 2 } },
  };
}

export function assertActualStaleCheckpointBinding({ baseline, runId, oldServiceId, oldContainerId }) {
  const run = baseline?.state?.run;
  const witness = baseline?.checkpoint;
  const stored = run?.engine_checkpoint;
  const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (!validId(runId) || !validId(oldServiceId) || !validId(oldContainerId) ||
      run?.id !== runId || run?.status !== 'running' || run?.service_id !== oldServiceId ||
      run?.lease_version !== 7 || typeof stored !== 'string' || stored.length === 0 ||
      baseline?.recovery?.runId !== runId || baseline?.recovery?.oldContainerId !== oldContainerId ||
      baseline?.recovery?.nativeDestroyAcknowledged !== true || baseline?.recovery?.reclaimed !== false ||
      JSON.stringify(witness) !== JSON.stringify(baseline?.recovery?.checkpoint))
    throw new Error('actual stale-window Run and checkpoint witness identity is invalid');

  const storedBytes = Buffer.byteLength(stored, 'utf8');
  if (storedBytes > MAX_CHECKPOINT_BYTES ||
      (stored.startsWith('r2:') ? witness?.storage !== 'r2' : witness?.storage !== 'inline' || storedBytes > MAX_INLINE_CHECKPOINT_BYTES))
    throw new Error('actual stale-window checkpoint stored value exceeds native size or storage limits');
  if (stored.startsWith('r2:')) {
    const key = stored.slice(3);
    const expectedPrefix = `agent-checkpoints/${encodeURIComponent(runId)}/${encodeURIComponent(oldServiceId)}/7/`;
    if (!key.startsWith(expectedPrefix) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/u.test(key.slice(expectedPrefix.length)))
      throw new Error('actual stale-window checkpoint R2 pointer does not match the old Run lease');
  }
  const storedSha256 = createHash('sha256').update(Buffer.from(stored, 'utf8')).digest('hex');
  const validDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
  const validSize = Number.isSafeInteger(witness?.serializedBytes) && witness.serializedBytes > 0 &&
    witness.serializedBytes <= MAX_CHECKPOINT_BYTES &&
    (witness.storage === 'inline' && !stored.startsWith('r2:') && witness.serializedBytes <= MAX_INLINE_CHECKPOINT_BYTES ||
      witness.storage === 'r2' && stored.startsWith('r2:') && witness.serializedBytes > MAX_INLINE_CHECKPOINT_BYTES);
  const usage = witness?.usage;
  if (witness?.storedSha256 !== storedSha256 || !validDigest(witness?.storedSha256) ||
      !validDigest(witness?.serializedSha256) || !validSize ||
      (witness.storage === 'inline' &&
        (witness.serializedBytes !== storedBytes || witness.serializedSha256 !== storedSha256)) ||
      witness?.graphId !== 'external-context-v1' || witness?.node !== 'execute_tools' || witness?.status !== 'running' ||
      !validId(witness?.loopId) || !validId(witness?.sessionId) ||
      !Array.isArray(witness?.pendingToolCallIds) || witness.pendingToolCallIds.length !== 1 ||
      witness.pendingToolCallIds[0] !== 'call-recovery-1' ||
      usage?.inputTokens !== 11 || usage?.outputTokens !== 3 || usage?.cachedInputTokens !== 2)
    throw new Error('actual stale-window checkpoint digest, storage, size, selectors, or usage is invalid');
  return true;
}

export function assertNativeStaleWindowQualification({ actualStaleWindow, budgets, report, evidence }) {
  const expectedBudgets = nativeContainerProofBudgets(actualStaleWindow);
  if (typeof actualStaleWindow !== 'boolean' || !budgets || !report ||
      JSON.stringify(budgets) !== JSON.stringify(expectedBudgets) ||
      report.proofMode !== expectedBudgets.mode || JSON.stringify(report.budgets) !== JSON.stringify(expectedBudgets))
    throw new Error('native proof mode or budgets differ from the supervisor options');
  if (report.sourceState?.proofMode !== expectedBudgets.mode || report.sourceState?.actualStaleWindow !== actualStaleWindow)
    throw new Error('native child source-state mode differs from the supervisor option');
  if (!actualStaleWindow) return true;

  const stale = report.recovery?.staleEligibility;
  if (!evidence || JSON.stringify(evidence) !== JSON.stringify(stale))
    throw new Error('actual stale-window early evidence file differs from the child report');
  const baseline = evidence.baseline;
  const run = baseline?.state?.run;
  const oldContainerWitness = report.containerWitness;
  const oldPhysicalDeath = report.recovery?.oldPhysicalDeath;
  if (!run?.id || run.id !== report.containerWitness?.runId || run.id !== report.recovery?.runId ||
      run.service_id !== report.recovery?.oldServiceId ||
      report.containerWitness?.containerId !== report.recovery?.oldContainerId ||
      run.lease_version !== 7 || run.status !== 'running')
    throw new Error('actual stale-window evidence is not joined to the witnessed old Run identity');
  const physicalAgentIds = Array.isArray(oldContainerWitness?.dockerContainers)
    ? oldContainerWitness.dockerContainers.map((container) => container?.id) : [];
  const deathAt = Date.parse(oldPhysicalDeath?.at);
  const markerAt = Date.parse(oldPhysicalDeath?.marker?.at);
  if (oldPhysicalDeath?.acknowledged !== true || !Array.isArray(oldPhysicalDeath.agentIdsAbsent) ||
      physicalAgentIds.length === 0 || physicalAgentIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id)) ||
      new Set(physicalAgentIds).size !== physicalAgentIds.length ||
      [...physicalAgentIds].sort().join(',') !== [...oldPhysicalDeath.agentIdsAbsent].sort().join(',') ||
      !Number.isFinite(deathAt) || !Number.isFinite(markerAt) || markerAt > deathAt ||
      oldPhysicalDeath.marker?.kind !== 'stage' || oldPhysicalDeath.marker?.runId !== run.id ||
      oldPhysicalDeath.marker?.containerId !== oldContainerWitness.containerId ||
      oldPhysicalDeath.marker?.stage !== 'old-container-destroyed-before-tool-ack' ||
      oldPhysicalDeath.marker?.productionToolStatus !== 200 ||
      oldPhysicalDeath.marker?.nativeDestroyAcknowledged !== true ||
      oldPhysicalDeath.marker?.successResponseForwarded !== false)
    throw new Error('actual stale-window old physical Container death does not join the exact native witness');
  if (!Number.isFinite(Date.parse(run.service_heartbeat)) || evidence.heartbeatAt !== run.service_heartbeat ||
      !Number.isFinite(Date.parse(evidence.baselineObservedAt)) ||
      Math.abs(Date.parse(evidence.baselineObservedAt) - Date.parse(run.service_heartbeat) - evidence.heartbeatAgeBefore) > 10)
    throw new Error('actual stale-window baseline heartbeat evidence is invalid or mutated');
  if (run.account_id !== baseline.workspace?.id || run.requester_account_id !== baseline.owner?.id ||
      baseline.owner?.status !== 'active' || baseline.owner?.type !== 'user' ||
      baseline.workspace?.status !== 'active' || baseline.workspace?.type !== 'team' ||
      baseline.workspace?.owner_account_id !== baseline.owner?.id ||
      baseline.recovery?.nativeDestroyAcknowledged !== true ||
      baseline.recovery?.reclaimed !== false)
    throw new Error('actual stale-window baseline owner, checkpoint, or old Container death witness is invalid');
  assertActualStaleCheckpointBinding({ baseline, runId: run.id, oldServiceId: run.service_id,
    oldContainerId: report.containerWitness.containerId });
  assertRunSnapshotUnchanged(baseline, evidence.afterManualAgeSnapshot);
  assertRunSnapshotUnchanged(baseline, evidence.afterEarlyScheduledSnapshot);
  assertRunSnapshotUnchanged(baseline, evidence.afterWaitSnapshot);
  if (evidence.manualAgeRejected?.rejected !== true || evidence.manualAgeRejected.attempts !== 1 ||
      evidence.manualAgeRejected.status !== 409 ||
      evidence.manualAgeRejected.code !== 'actual_stale_window_manual_age_forbidden' ||
      evidence.manualAgeRejected.sqlSnapshotUnchanged !== true)
    throw new Error('actual stale-window fixture did not prove the manual age route refused without SQL mutation');
  if (evidence.earlyScheduledOutcome?.outcome !== 'ok' || evidence.earlyCanonical?.backgroundErrors !== 0 ||
      evidence.afterEarlyScheduledSnapshot?.recovery?.reclaimed !== false)
    throw new Error('actual stale-window early scheduled invocation did not finish without a claim');
  assertNoEarlyRecovery({ ...evidence.earlyCanonical, state: evidence.afterEarlyScheduledSnapshot.state,
    expectedOldServiceId: run.service_id, recovery: evidence.afterEarlyScheduledSnapshot.recovery }, run.id);
  assertMonotonicHeartbeatAge(evidence.heartbeatAgeBefore, evidence.earlyStartElapsedMs, false);
  assertMonotonicHeartbeatAge(evidence.heartbeatAgeBefore, evidence.earlyFinishElapsedMs, false);

  const heartbeatAt = Date.parse(run.service_heartbeat);
  const staleAt = Date.parse(evidence.staleObservedAt);
  const positiveAt = Date.parse(evidence.positiveInvocationAt);
  const finiteTimings = ['heartbeatAgeBefore', 'heartbeatAgeAfter', 'earlyStartElapsedMs', 'earlyFinishElapsedMs',
    'actualWaitElapsedMs', 'monotonicElapsedMs', 'monotonicHeartbeatAgeAfter',
    'positiveInvocationElapsedMs', 'monotonicHeartbeatAgeAtPositiveInvocation'];
  if (finiteTimings.some((name) => !Number.isFinite(evidence[name])) ||
      !Number.isFinite(staleAt) || staleAt - heartbeatAt <= expectedBudgets.actualStaleWindowMs ||
      evidence.heartbeatAgeAfter <= expectedBudgets.actualStaleWindowMs ||
      evidence.heartbeatAgeBefore < 0 ||
      !Number.isFinite(evidence.actualWaitElapsedMs) || evidence.actualWaitElapsedMs < 0 ||
      evidence.actualWaitElapsedMs > expectedBudgets.actualStaleWindowWaitMaxMs ||
      !Number.isFinite(evidence.monotonicElapsedMs) ||
      evidence.monotonicHeartbeatAgeAfter <= expectedBudgets.actualStaleWindowMs ||
      evidence.heartbeatAgeBefore >= expectedBudgets.actualStaleWindowMs ||
      Math.abs(evidence.heartbeatAgeAfter - (staleAt - heartbeatAt)) > 10 ||
      evidence.earlyFinishElapsedMs < evidence.earlyStartElapsedMs ||
      evidence.monotonicElapsedMs < evidence.actualWaitElapsedMs ||
      evidence.positiveInvocationElapsedMs < evidence.monotonicElapsedMs ||
      Math.abs(evidence.monotonicHeartbeatAgeAfter - (evidence.heartbeatAgeBefore + evidence.monotonicElapsedMs)) > 1 ||
      Math.abs(evidence.monotonicHeartbeatAgeAtPositiveInvocation -
        (evidence.heartbeatAgeBefore + evidence.positiveInvocationElapsedMs)) > 1)
    throw new Error('actual stale-window wall or monotonic timing does not exceed 300 seconds within its wait bound');
  assertMonotonicHeartbeatAge(evidence.heartbeatAgeBefore, evidence.monotonicElapsedMs, true);
  if (!Number.isFinite(positiveAt) || positiveAt - heartbeatAt <= expectedBudgets.actualStaleWindowMs ||
      !Number.isFinite(evidence.positiveInvocationElapsedMs) ||
      evidence.monotonicHeartbeatAgeAtPositiveInvocation <= expectedBudgets.actualStaleWindowMs)
    throw new Error('positive scheduled invocation lacks wall and monotonic stale-window proof');
  assertMonotonicHeartbeatAge(evidence.heartbeatAgeBefore, evidence.positiveInvocationElapsedMs, true);
  if (evidence.claimScope !== 'proves the unchanged Run heartbeat exceeded 300 seconds; it does not claim the old physical Container was absent for 300 seconds')
    throw new Error('actual stale-window report makes an unsupported physical Container absence duration claim');
  if (typeof report.limitation !== 'string' ||
      !report.limitation.includes('whole workerd restart is not proven') ||
      !report.limitation.includes('Run heartbeat was observed recent, remained unchanged, and crossed its 300-second stale threshold'))
    throw new Error('actual stale-window limitation omits the heartbeat-only proof boundary');
  return true;
}
