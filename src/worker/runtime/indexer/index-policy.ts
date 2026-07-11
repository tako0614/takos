export const INDEX_JOB_CLAIM_STALE_MS = 15 * 60 * 1000;

/** Delay a same-delivery retry until its current running claim is reclaimable. */
export function indexClaimRetryDelaySeconds(
  startedAt: string,
  nowMs = Date.now(),
): number {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return 1;
  const remainingMs = startedAtMs + INDEX_JOB_CLAIM_STALE_MS - nowMs;
  return Math.max(1, Math.min(900, Math.ceil(remainingMs / 1000)));
}
