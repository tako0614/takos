import type { Context, Next } from 'hono';
import {
  hitSlidingWindow,
  cleanupExpiredEntries,
  enforceKeyLimit,
  type SlidingWindowResult,
} from './sliding-window';

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
