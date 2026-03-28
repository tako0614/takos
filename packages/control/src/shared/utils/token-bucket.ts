import type { SlidingWindowConfig, SlidingWindowResult } from './sliding-window';

export interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

function getCapacity(config: SlidingWindowConfig): number {
  return Math.max(0, Math.floor(config.maxRequests));
}

function getRatePerMs(config: SlidingWindowConfig): number {
  if (!Number.isFinite(config.windowMs) || config.windowMs <= 0) return 0;
  const capacity = getCapacity(config);
  return capacity / config.windowMs;
}

function refill(
  state: TokenBucketState | undefined,
  config: SlidingWindowConfig,
  now: number
): TokenBucketState {
  const capacity = getCapacity(config);
  const ratePerMs = getRatePerMs(config);

  const lastRefillMs = state?.lastRefillMs ?? now;
  let tokens = state?.tokens ?? capacity;

  if (capacity === 0 || ratePerMs === 0) {
    return { tokens: 0, lastRefillMs: now };
  }

  const deltaMs = Math.max(0, now - lastRefillMs);
  tokens = Math.min(capacity, tokens + deltaMs * ratePerMs);

  return { tokens, lastRefillMs: now };
}

function computeResetMs(
  tokens: number,
  config: SlidingWindowConfig,
  now: number
): number {
  const capacity = getCapacity(config);
  const ratePerMs = getRatePerMs(config);

  if (capacity === 0 || ratePerMs === 0) {
    return now + Math.max(0, config.windowMs);
  }

  if (tokens < 1) {
    const msUntilNext = Math.ceil((1 - tokens) / ratePerMs);
    return now + Math.max(0, msUntilNext);
  }

  const msUntilFull = Math.ceil((capacity - tokens) / ratePerMs);
  return now + Math.max(0, msUntilFull);
}

export function hitTokenBucket(
  state: TokenBucketState | undefined,
  config: SlidingWindowConfig,
  now: number = Date.now(),
  dryRun: boolean = false
): { state: TokenBucketState; result: SlidingWindowResult } {
  const next = refill(state, config, now);

  const capacity = getCapacity(config);
  const allowed = capacity > 0 && next.tokens >= 1;
  if (allowed && !dryRun) {
    next.tokens = Math.max(0, next.tokens - 1);
  }

  const remaining = Math.max(0, Math.floor(next.tokens));
  const reset = computeResetMs(next.tokens, config, now);

  return {
    state: next,
    result: {
      remaining,
      reset,
      total: capacity,
      allowed,
    },
  };
}

