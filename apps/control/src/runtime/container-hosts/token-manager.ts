/**
 * Durable Object Token Manager.
 *
 * Generic token generation, storage, and verification for
 * Durable Objects that need request authentication.
 * Extracted from executor-host.ts and runtime-host.ts.
 *
 * Both executor-host and runtime-host follow the same pattern:
 * 1. Generate a random token via `crypto.getRandomValues` (32 bytes)
 * 2. Store the token alongside metadata in DO storage (`ctx.storage.put`)
 * 3. Verify tokens using constant-time comparison
 * 4. Cache tokens in a `Map` to avoid repeated storage reads
 *
 * This class consolidates that pattern into a single reusable component.
 */

import { constantTimeEqual } from '@/shared/utils/hash';

/**
 * Abstraction over Durable Object storage for token persistence.
 * Matches the subset of `DurableObjectStorage` that token management requires.
 */
export interface TokenManagerStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Generic Durable Object token manager.
 *
 * Manages generation, storage, verification, and revocation of
 * cryptographically random tokens backed by DO storage.
 *
 * Tokens are persisted as a `Record<string, T>` under a configurable
 * storage key prefix. An in-memory cache avoids repeated storage reads
 * (same pattern used by `TakosAgentExecutorContainer.cachedTokens` and
 * `TakosRuntimeContainer.cachedTokens`).
 *
 * @typeParam T - Token metadata type (e.g. `ProxyTokenInfo`, `RuntimeProxyTokenInfo`).
 *
 * @example
 * ```ts
 * interface MyTokenInfo { runId: string; capability: 'bindings' | 'control'; }
 * const manager = new DOTokenManager<MyTokenInfo>(ctx.storage, 'proxyTokens');
 * const token = await manager.generateToken('run-1', { runId: 'run-1', capability: 'bindings' });
 * const info = await manager.verifyToken(token); // MyTokenInfo | null
 * await manager.revokeToken(token);
 * ```
 */
export class DOTokenManager<T extends Record<string, unknown>> {
  private storage: TokenManagerStorage;
  private storageKey: string;

  /** In-memory cache, lazily loaded from storage on first access. */
  private cachedTokens: Map<string, T> | null = null;

  /**
   * @param storage - Durable Object storage handle.
   * @param storageKey - Key under which the token map is persisted.
   *   Defaults to `'proxyTokens'` to match the existing convention.
   */
  constructor(storage: TokenManagerStorage, storageKey: string = 'proxyTokens') {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  /**
   * Generate a cryptographically random token (32 bytes, base64url-encoded).
   *
   * Uses the same algorithm as `generateProxyToken()` in executor-proxy-config.ts:
   * `crypto.getRandomValues` with 32 random bytes, base64url-encoded without padding.
   */
  private generateRandomToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Ensure the in-memory cache is populated from storage.
   * Returns the cached map (never null after this call).
   */
  private async ensureCache(): Promise<Map<string, T>> {
    if (this.cachedTokens) return this.cachedTokens;
    const stored = await this.storage.get<Record<string, T>>(this.storageKey);
    this.cachedTokens = stored ? new Map(Object.entries(stored)) : new Map();
    return this.cachedTokens;
  }

  /** Persist the in-memory cache back to DO storage. */
  private async persist(): Promise<void> {
    if (!this.cachedTokens) return;
    await this.storage.put(this.storageKey, Object.fromEntries(this.cachedTokens));
  }

  /**
   * Generate a cryptographically random token and store it with associated metadata.
   *
   * @param id - Logical identifier for the token (for logging/debugging; not used as storage key).
   * @param info - Metadata to associate with this token.
   * @returns The generated token string.
   */
  async generateToken(id: string, info: T): Promise<string> {
    const tokens = await this.ensureCache();
    const token = this.generateRandomToken();
    tokens.set(token, info);
    await this.persist();
    return token;
  }

  /**
   * Store an externally generated token with associated metadata.
   *
   * @param token - The token string to store.
   * @param info - Metadata to associate with this token.
   */
  async storeToken(token: string, info: T): Promise<void> {
    const tokens = await this.ensureCache();
    tokens.set(token, info);
    await this.persist();
  }

  /**
   * Verify a token using constant-time comparison.
   *
   * Iterates all stored tokens with `constantTimeEqual` to prevent
   * timing side-channels — the same approach used by both
   * `TakosAgentExecutorContainer.verifyProxyToken` and
   * `TakosRuntimeContainer.verifyProxyToken`.
   *
   * @param candidateToken - The token to verify.
   * @returns The token metadata if valid, or `null` if not found.
   */
  async verifyToken(candidateToken: string): Promise<T | null> {
    if (!candidateToken || typeof candidateToken !== 'string') return null;

    const tokens = await this.ensureCache();
    for (const [storedToken, info] of tokens) {
      if (constantTimeEqual(candidateToken, storedToken)) return info;
    }
    return null;
  }

  /**
   * Revoke a specific token.
   *
   * Uses constant-time comparison to find the matching token.
   *
   * @param token - The token to revoke.
   * @returns `true` if the token existed and was removed.
   */
  async revokeToken(token: string): Promise<boolean> {
    const tokens = await this.ensureCache();
    for (const [storedToken] of tokens) {
      if (constantTimeEqual(token, storedToken)) {
        tokens.delete(storedToken);
        await this.persist();
        return true;
      }
    }
    return false;
  }

  /**
   * Revoke all tokens whose metadata matches a predicate.
   *
   * Useful for revoking all tokens for a specific runId or sessionId.
   *
   * @returns The number of tokens revoked.
   */
  async revokeWhere(predicate: (info: T) => boolean): Promise<number> {
    const tokens = await this.ensureCache();
    let count = 0;
    for (const [token, entry] of tokens) {
      if (predicate(entry)) {
        tokens.delete(token);
        count++;
      }
    }
    if (count > 0) {
      await this.persist();
    }
    return count;
  }

  /**
   * Revoke all tokens managed by this instance.
   *
   * Clears both the in-memory cache and the persisted storage entry.
   */
  async revokeAll(): Promise<void> {
    this.cachedTokens = new Map();
    await this.storage.delete(this.storageKey);
  }

  /** Current number of stored tokens. */
  get size(): number {
    return this.cachedTokens?.size ?? 0;
  }
}
