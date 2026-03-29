import type { Context, Next } from 'hono';
import { logWarn } from './logger';

// ---------------------------------------------------------------------------
// Sliding Window
// ---------------------------------------------------------------------------

/**
 * Result of a sliding-window rate-limit check, indicating whether the
 * request is allowed and how many requests remain in the current window.
 */
export interface SlidingWindowResult {
  remaining: number;
  reset: number;
  total: number;
  allowed: boolean;
}

/**
 * Configuration for both sliding-window and token-bucket rate limiters.
 */
export interface SlidingWindowConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Evaluate a sliding-window rate limit against a list of request timestamps.
 *
 * Returns the (possibly updated) timestamp list and the rate-limit verdict.
 * When `dryRun` is true the timestamp list is not mutated.
 */
export function hitSlidingWindow(
  timestamps: number[],
  config: SlidingWindowConfig,
  now: number = Date.now(),
  dryRun: boolean = false
): { timestamps: number[]; result: SlidingWindowResult } {
  const windowStart = now - config.windowMs;
  const validTimestamps = timestamps.filter((t) => t > windowStart);

  const allowed = validTimestamps.length < config.maxRequests;

  if (allowed && !dryRun) {
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

/**
 * Remove entries whose timestamps have all expired outside the given window.
 * Entries with at least one valid timestamp are pruned to only valid ones.
 */
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

/** Extra entries to evict beyond the limit to avoid repeated evictions. */
const KEY_EVICTION_BUFFER = 100;

/**
 * Evict the oldest keys from a Map when its size exceeds `maxKeys`.
 * Returns the number of entries removed.
 */
export function enforceKeyLimit(entries: Map<string, number[]>, maxKeys: number): number {
  if (entries.size < maxKeys) {
    return 0;
  }

  const entriesToRemove = Math.max(
    0,
    Math.min(entries.size - maxKeys + KEY_EVICTION_BUFFER, entries.size)
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

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// In-Memory Rate Limiter
// ---------------------------------------------------------------------------

/** Milliseconds per second, used to convert ms timestamps to seconds for HTTP headers. */
const MS_PER_SECOND = 1000;

function getClientIpForRateLimit(c: Context): string | null {
  return c.req.header('CF-Connecting-IP') ?? null;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (c: Context) => string;
  message?: string;
  skip?: (c: Context) => boolean;
}

export interface RateLimitInfo {
  remaining: number;
  reset: number;
  total: number;
}

export class InMemoryRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: Required<RateLimitConfig>;
  private lastCleanup: number = Date.now();

  private static readonly MAX_KEYS = 100000;
  private static readonly CLEANUP_INTERVAL_MS = 60000;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      keyGenerator: config.keyGenerator || ((c) => getClientIpForRateLimit(c) || 'unknown'),
      message: config.message || 'Too many requests, please try again later',
      skip: config.skip || (() => false),
    };
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup > InMemoryRateLimiter.CLEANUP_INTERVAL_MS) {
      this.cleanup();
      this.lastCleanup = now;
    }
  }

  private checkKeyLimit(): void {
    if (this.requests.size >= InMemoryRateLimiter.MAX_KEYS) {
      this.cleanup();

      if (this.requests.size >= InMemoryRateLimiter.MAX_KEYS) {
        enforceKeyLimit(this.requests, InMemoryRateLimiter.MAX_KEYS);
      }
    }
  }

  check(key: string): RateLimitInfo {
    this.maybeCleanup();

    const timestamps = this.requests.get(key) || [];
    const { result } = hitSlidingWindow(timestamps, {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
    }, undefined, true);

    return {
      remaining: result.remaining,
      reset: result.reset,
      total: result.total,
    };
  }

  hit(key: string): RateLimitInfo {
    this.maybeCleanup();
    this.checkKeyLimit();

    const timestamps = this.requests.get(key) || [];
    const { timestamps: newTimestamps, result } = hitSlidingWindow(timestamps, {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
    });

    this.requests.set(key, newTimestamps);

    return {
      remaining: result.remaining,
      reset: result.reset,
      total: result.total,
    };
  }

  middleware() {
    return async (c: Context, next: Next) => {
      if (this.config.skip(c)) {
        return next();
      }

      const key = this.config.keyGenerator(c);
      const info = this.check(key);

      c.header('X-RateLimit-Limit', String(info.total));
      c.header('X-RateLimit-Remaining', String(info.remaining));
      c.header('X-RateLimit-Reset', String(Math.ceil(info.reset / MS_PER_SECOND)));

      if (info.remaining <= 0) {
        c.header('Retry-After', String(Math.ceil((info.reset - Date.now()) / MS_PER_SECOND)));
        return c.json(
          {
            error: this.config.message,
            retryAfter: Math.ceil((info.reset - Date.now()) / MS_PER_SECOND),
          },
          429
        );
      }

      this.hit(key);

      return next();
    };
  }

  cleanup(): void {
    cleanupExpiredEntries(this.requests, this.config.windowMs);
  }
}

/** Standard rate-limit window duration (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

export const RateLimiters = {
  auth: () => new InMemoryRateLimiter({ maxRequests: 100, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many authentication attempts.' }),
  sensitive: () => new InMemoryRateLimiter({ maxRequests: 100, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many requests.' }),
  oauthToken: () => new InMemoryRateLimiter({ maxRequests: 20, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many token requests.' }),
  oauthAuthorize: () => new InMemoryRateLimiter({ maxRequests: 30, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many authorization requests.' }),
  oauthRevoke: () => new InMemoryRateLimiter({ maxRequests: 10, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many revocation requests.' }),
  oauthRegister: () => new InMemoryRateLimiter({ maxRequests: 10, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many client registration requests.' }),
  oauthDeviceCode: () => new InMemoryRateLimiter({ maxRequests: 10, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many device authorization requests.' }),
  oauthDeviceVerify: () => new InMemoryRateLimiter({ maxRequests: 60, windowMs: RATE_LIMIT_WINDOW_MS, message: 'Too many device verification requests.' }),
};
