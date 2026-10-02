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
  if (!run?.id || run.id !== report.containerWitness?.runId || run.id !== report.recovery?.runId ||
      run.service_id !== report.recovery?.oldServiceId || run.lease_version !== 7 || run.status !== 'running')
    throw new Error('actual stale-window evidence is not joined to the witnessed old Run identity');
  if (!Number.isFinite(Date.parse(run.service_heartbeat)) || evidence.heartbeatAt !== run.service_heartbeat ||
      !Number.isFinite(Date.parse(evidence.baselineObservedAt)) ||
      Math.abs(Date.parse(evidence.baselineObservedAt) - Date.parse(run.service_heartbeat) - evidence.heartbeatAgeBefore) > 10)
    throw new Error('actual stale-window baseline heartbeat evidence is invalid or mutated');
  if (run.account_id !== baseline.workspace?.id || run.requester_account_id !== baseline.owner?.id ||
      baseline.owner?.status !== 'active' || baseline.owner?.type !== 'user' ||
      baseline.workspace?.status !== 'active' || baseline.workspace?.type !== 'team' ||
      baseline.workspace?.owner_account_id !== baseline.owner?.id ||
      baseline.checkpoint?.runId !== run.id || baseline.recovery?.nativeDestroyAcknowledged !== true ||
      baseline.recovery?.reclaimed !== false)
    throw new Error('actual stale-window baseline owner, checkpoint, or old Container death witness is invalid');
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
