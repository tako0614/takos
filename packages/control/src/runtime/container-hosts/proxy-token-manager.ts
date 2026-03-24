/**
 * ProxyTokenManager — shared token lifecycle for container-host proxy authentication.
 *
 * Generates secure, per-run tokens with TTL and capability metadata.
 * Used by host workers (executor-host, runtime-host) to issue tokens
 * during dispatch and verify them on every /proxy/* call from the container.
 *
 * Tokens are opaque hex strings generated with crypto.getRandomValues.
 * Verification uses constant-time comparison to prevent timing attacks.
 */

import { constantTimeEqual } from '../../shared/utils/hash';

/**
 * Token entry stored in the internal map.
 * Generic `T` carries capability metadata (e.g. runId, workerId, capability scope).
 */
interface TokenEntry<T> {
  info: T;
  createdAt: number;
  ttlMs: number;
}

/**
 * Generic proxy token manager.
 *
 * @typeParam T - Token metadata type. Must be a plain object (Record-like).
 *
 * @example
 * ```ts
 * interface MyTokenInfo { runId: string; capability: 'bindings' | 'control'; }
 * const manager = new ProxyTokenManager<MyTokenInfo>(1000);
 * const token = manager.generate({ runId: 'r1', capability: 'bindings' }, 30 * 60_000);
 * const info = manager.verify(token); // MyTokenInfo | null
 * ```
 */
export class ProxyTokenManager<T extends Record<string, unknown>> {
  private tokens: Map<string, TokenEntry<T>> = new Map();
  private readonly maxTokens: number;

  /**
   * @param maxTokens - Maximum number of tokens to store. When exceeded, expired
   *   tokens are cleaned up first; if still over the limit, the oldest token is evicted.
   *   Defaults to 10_000.
   */
  constructor(maxTokens = 10_000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Generate a cryptographically secure token and associate it with metadata.
   *
   * @param info - Metadata to associate with this token.
   * @param ttlMs - Time-to-live in milliseconds. After this duration the token
   *   will be rejected by `verify()` and eventually cleaned up.
   * @returns The generated token string (64 hex characters / 32 bytes).
   */
  generate(info: T, ttlMs: number): string {
    // Cleanup expired tokens before generating to keep map bounded
    if (this.tokens.size >= this.maxTokens) {
      this.cleanup();
    }

    // If still over capacity after cleanup, evict oldest
    if (this.tokens.size >= this.maxTokens) {
      this.evictOldest();
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    this.tokens.set(token, {
      info,
      createdAt: Date.now(),
      ttlMs,
    });

    return token;
  }

  /**
   * Verify a token and return its associated metadata if valid and not expired.
   *
   * Uses constant-time string comparison to prevent timing side-channels.
   *
   * @returns The token metadata, or `null` if the token is invalid / expired.
   */
  verify(token: string): T | null {
    if (!token || typeof token !== 'string') return null;

    // Iterate all entries with constant-time comparison to prevent timing leaks.
    // This ensures an attacker cannot distinguish "token not found" from
    // "token found but expired" based on response timing.
    let matchedEntry: TokenEntry<T> | null = null;
    let matchedKey: string | null = null;

    for (const [storedToken, entry] of this.tokens) {
      if (constantTimeEqual(token, storedToken)) {
        matchedEntry = entry;
        matchedKey = storedToken;
        break;
      }
    }

    if (!matchedEntry || !matchedKey) return null;

    // Check expiration
    const elapsed = Date.now() - matchedEntry.createdAt;
    if (elapsed > matchedEntry.ttlMs) {
      // Expired — remove and return null
      this.tokens.delete(matchedKey);
      return null;
    }

    return matchedEntry.info;
  }

  /**
   * Revoke a specific token (e.g. when a run completes or is cancelled).
   *
   * @returns `true` if the token existed and was removed.
   */
  revoke(token: string): boolean {
    // Use constant-time lookup to find the matching key
    for (const [storedToken] of this.tokens) {
      if (constantTimeEqual(token, storedToken)) {
        this.tokens.delete(storedToken);
        return true;
      }
    }
    return false;
  }

  /**
   * Revoke all tokens whose metadata matches a predicate.
   * Useful for revoking all tokens for a specific runId.
   *
   * @returns The number of tokens revoked.
   */
  revokeWhere(predicate: (info: T) => boolean): number {
    let count = 0;
    for (const [token, entry] of this.tokens) {
      if (predicate(entry.info)) {
        this.tokens.delete(token);
        count++;
      }
    }
    return count;
  }

  /**
   * Remove all expired tokens from the internal store.
   * Called automatically when the store reaches capacity, but can also be
   * called manually (e.g. on a periodic schedule).
   */
  cleanup(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.tokens.delete(token);
      }
    }
  }

  /** Current number of stored tokens (including potentially expired ones). */
  get size(): number {
    return this.tokens.size;
  }

  /** Evict the oldest token to make room for a new one. */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [token, entry] of this.tokens) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = token;
      }
    }

    if (oldestKey) {
      this.tokens.delete(oldestKey);
    }
  }
}
