import { logWarn } from './logger';
export interface SlidingWindowResult {
  remaining: number;
  reset: number;
  total: number;
  allowed: boolean;
}

export interface SlidingWindowConfig {
  maxRequests: number;
  windowMs: number;
}

export function checkSlidingWindow(
  timestamps: number[],
  config: SlidingWindowConfig,
  now: number = Date.now()
): SlidingWindowResult {
  const windowStart = now - config.windowMs;
  const validTimestamps = timestamps.filter((t) => t > windowStart);

  const remaining = Math.max(0, config.maxRequests - validTimestamps.length);
  const reset = validTimestamps.length > 0 ? validTimestamps[0] + config.windowMs : now + config.windowMs;

  return {
    remaining,
    reset,
    total: config.maxRequests,
    allowed: remaining > 0,
  };
}

export function hitSlidingWindow(
  timestamps: number[],
  config: SlidingWindowConfig,
  now: number = Date.now()
): { timestamps: number[]; result: SlidingWindowResult } {
  const windowStart = now - config.windowMs;
  const validTimestamps = timestamps.filter((t) => t > windowStart);

  const allowed = validTimestamps.length < config.maxRequests;

  if (allowed) {
    validTimestamps.push(now);
  }

  const remaining = Math.max(0, config.maxRequests - validTimestamps.length);
  const reset = validTimestamps.length > 0 ? validTimestamps[0] + config.windowMs : now + config.windowMs;

  return {
    timestamps: validTimestamps,
    result: {
      remaining,
      reset,
      total: config.maxRequests,
      allowed,
    },
  };
}

export function cleanupExpiredEntries(
  entries: Map<string, number[]>,
  windowMs: number,
  now: number = Date.now()
): void {
  const windowStart = now - windowMs;

  for (const [key, timestamps] of entries.entries()) {
    const valid = timestamps.filter((t) => t > windowStart);
    if (valid.length === 0) {
      entries.delete(key);
    } else {
      entries.set(key, valid);
    }
  }
}

export function enforceKeyLimit(entries: Map<string, number[]>, maxKeys: number): number {
  if (entries.size < maxKeys) {
    return 0;
  }

  const entriesToRemove = Math.max(
    0,
    Math.min(entries.size - maxKeys + 100, entries.size)
  );

  let removed = 0;
  for (const key of entries.keys()) {
    if (removed >= entriesToRemove) break;
    entries.delete(key);
    removed++;
  }

  if (removed > 0) {
    logWarn(`Rate limiter: Force-removed ${removed} entries due to key limit`, { module: 'utils/sliding-window' });
  }

  return removed;
}
