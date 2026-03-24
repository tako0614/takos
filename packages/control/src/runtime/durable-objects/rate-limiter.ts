import {
  checkSlidingWindow,
  hitSlidingWindow,
  cleanupExpiredEntries,
  enforceKeyLimit,
} from '../../shared/utils/sliding-window';
import { checkTokenBucket, hitTokenBucket, type TokenBucketState } from '../../shared/utils/token-bucket';

import { jsonResponse } from './shared';
import { logWarn } from '../../shared/utils/logger';

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitStorage {
  entries: Record<string, RateLimitEntry>;
  tokenBuckets?: Record<string, TokenBucketState>;
}

type RateLimiterAlgorithm = 'sliding_window' | 'token_bucket' | 'shadow';

interface RateLimitRequest {
  key: string;
  maxRequests: number;
  windowMs: number;
  algorithm?: RateLimiterAlgorithm;
  /**
   * Only used in shadow mode to reduce log volume.
   * When omitted, a conservative default is used.
   */
  shadowSampleRate?: number;
}

export class RateLimiterDO implements DurableObject {
  private state: DurableObjectState;
  private entries: Map<string, number[]> = new Map();
  private tokenBuckets: Map<string, TokenBucketState> = new Map();
  private lastCleanup: number = Date.now();

  // Cleanup interval: 60 seconds
  private static readonly CLEANUP_INTERVAL_MS = 60000;
  // Conservative cap (per DO instance) to avoid memory exhaustion.
  private static readonly MAX_KEYS = 10_000;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<RateLimitStorage>('data');
      if (stored?.entries) {
        this.entries = new Map(Object.entries(stored.entries).map(([k, v]) => [k, v.timestamps]));
      }
      if (stored?.tokenBuckets) {
        this.tokenBuckets = new Map(Object.entries(stored.tokenBuckets));
      }
      // Schedule periodic cleanup alarm
      const existing = await this.state.storage.getAlarm();
      if (!existing) {
        await this.state.storage.setAlarm(Date.now() + RateLimiterDO.CLEANUP_INTERVAL_MS);
      }
    });
  }

  private async persist(): Promise<void> {
    const data: RateLimitStorage = {
      entries: Object.fromEntries(
        Array.from(this.entries.entries()).map(([k, v]) => [k, { timestamps: v }])
      ),
      tokenBuckets: Object.fromEntries(
        Array.from(this.tokenBuckets.entries()).map(([k, v]) => [k, v])
      ),
    };
    await this.state.storage.put('data', data);
  }

  private maybeCleanup(windowMs: number): void {
    const now = Date.now();
    if (now - this.lastCleanup > RateLimiterDO.CLEANUP_INTERVAL_MS) {
      cleanupExpiredEntries(this.entries, windowMs, now);
      this.lastCleanup = now;
    }
  }

  /**
   * Enforce the key limit on both entries and tokenBuckets maps.
   * Uses try/catch to ensure that a failure in enforceKeyLimit() never
   * silently allows maps to grow unbounded -- if enforcement throws,
   * we fall back to a brute-force eviction of the oldest keys.
   */
  private checkKeyLimit(): void {
    if (this.entries.size >= RateLimiterDO.MAX_KEYS) {
      try {
        enforceKeyLimit(this.entries, RateLimiterDO.MAX_KEYS);
      } catch (err) {
        // Fallback: brute-force evict oldest entries so the map cannot grow unbounded.
        const toRemove = Math.max(0, this.entries.size - RateLimiterDO.MAX_KEYS + 100);
        let removed = 0;
        for (const key of this.entries.keys()) {
          if (removed >= toRemove) break;
          this.entries.delete(key);
          removed++;
        }
        logWarn(`Rate limiter: enforceKeyLimit failed, force-removed ${removed} entries`, { module: 'durable-objects/rate-limiter', detail: err });
      }
    }
    if (this.tokenBuckets.size >= RateLimiterDO.MAX_KEYS) {
      const toRemove = Math.max(
        0,
        Math.min(this.tokenBuckets.size - RateLimiterDO.MAX_KEYS + 100, this.tokenBuckets.size)
      );
      let removed = 0;
      for (const key of this.tokenBuckets.keys()) {
        if (removed >= toRemove) break;
        this.tokenBuckets.delete(key);
        removed++;
      }
      if (removed > 0) {
        logWarn(`Rate limiter: Force-removed ${removed} token bucket entries due to key limit`, { module: 'durable-objects/rate-limiter' });
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // All mutating handlers are wrapped in blockConcurrencyWhile to
      // prevent concurrent fetch() calls from racing on this.entries
      // and this.tokenBuckets. Durable Objects may receive concurrent
      // requests; without serialization, maybeCleanup, checkKeyLimit,
      // and the read-modify-write cycles in handleCheck/handleHit can
      // interleave and corrupt state.
      if (path === '/check' && request.method === 'POST') {
        const data = await request.json() as RateLimitRequest;
        return this.state.blockConcurrencyWhile(() => this.handleCheck(data));
      }
      if (path === '/hit' && request.method === 'POST') {
        const data = await request.json() as RateLimitRequest;
        return this.state.blockConcurrencyWhile(() => this.handleHit(data));
      }
      if (path === '/reset' && request.method === 'POST') {
        const data = await request.json() as { key: string };
        return this.state.blockConcurrencyWhile(() => this.handleReset(data));
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  private async handleCheck(data: RateLimitRequest): Promise<Response> {
    const { key, maxRequests, windowMs } = data;
    const algorithm: RateLimiterAlgorithm = data.algorithm ?? 'sliding_window';
    this.maybeCleanup(windowMs);

    if (algorithm === 'token_bucket') {
      const state = this.tokenBuckets.get(key);
      const { state: next, result } = checkTokenBucket(state, { maxRequests, windowMs });
      this.tokenBuckets.set(key, next);
      this.entries.delete(key);

      return jsonResponse({ ...result, algorithm: 'token_bucket' });
    }

    const timestamps = this.entries.get(key) || [];
    const sliding = checkSlidingWindow(timestamps, { maxRequests, windowMs });

    if (algorithm === 'shadow') {
      const state = this.tokenBuckets.get(key);
      const { state: next, result: tokenBucket } = checkTokenBucket(state, { maxRequests, windowMs });
      this.tokenBuckets.set(key, next);

      return jsonResponse({
        ...sliding,
        algorithm: 'sliding_window',
        shadow: { token_bucket: tokenBucket },
      });
    }

    return jsonResponse({ ...sliding, algorithm: 'sliding_window' });
  }

  private async handleHit(data: RateLimitRequest): Promise<Response> {
    const { key, maxRequests, windowMs } = data;
    const algorithm: RateLimiterAlgorithm = data.algorithm ?? 'sliding_window';
    const shadowSampleRate = Number.isFinite(data.shadowSampleRate) ? Math.max(0, Math.min(1, data.shadowSampleRate!)) : 0.01;

    this.maybeCleanup(windowMs);
    this.checkKeyLimit();

    if (algorithm === 'token_bucket') {
      const state = this.tokenBuckets.get(key);
      const { state: next, result } = hitTokenBucket(state, { maxRequests, windowMs });
      this.tokenBuckets.set(key, next);
      this.entries.delete(key);

      if (result.allowed) {
        await this.persist();
      }

      return jsonResponse({ ...result, algorithm: 'token_bucket' });
    }

    const timestamps = this.entries.get(key) || [];
    const slidingOut = hitSlidingWindow(timestamps, { maxRequests, windowMs });
    const slidingAllowed = slidingOut.result.allowed;

    if (slidingAllowed) {
      this.entries.set(key, slidingOut.timestamps);
    }

    if (algorithm === 'shadow') {
      const bucketState = this.tokenBuckets.get(key);
      const tokenOut = hitTokenBucket(bucketState, { maxRequests, windowMs });
      this.tokenBuckets.set(key, tokenOut.state);
      const tokenAllowed = tokenOut.result.allowed;

      if (slidingAllowed || tokenAllowed) {
        await this.persist();
      }

      if (slidingAllowed !== tokenAllowed && Math.random() < shadowSampleRate) {
        logWarn('shadow mismatch', { module: 'ratelimiterdo', ...{
          key,
          maxRequests,
          windowMs,
          sliding_allowed: slidingAllowed,
          token_allowed: tokenAllowed,
          sliding_remaining: slidingOut.result.remaining,
          token_remaining: tokenOut.result.remaining,
        } });
      }

      return jsonResponse({
        ...slidingOut.result,
        algorithm: 'sliding_window',
        shadow: { token_bucket: tokenOut.result },
      });
    }

    if (slidingAllowed) {
      await this.persist();
    }

    return jsonResponse({ ...slidingOut.result, algorithm: 'sliding_window' });
  }

  async alarm(): Promise<void> {
    // Periodic cleanup of expired entries
    const windowMs = 60000; // Default window for cleanup
    cleanupExpiredEntries(this.entries, windowMs, Date.now());

    // Re-schedule if there are still entries
    if (this.entries.size > 0 || this.tokenBuckets.size > 0) {
      await this.persist();
      await this.state.storage.setAlarm(Date.now() + RateLimiterDO.CLEANUP_INTERVAL_MS);
    }
  }

  private async handleReset(data: { key: string }): Promise<Response> {
    this.entries.delete(data.key);
    this.tokenBuckets.delete(data.key);
    await this.persist();
    return jsonResponse({ success: true });
  }
}
