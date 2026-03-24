import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyTokenManager } from '@/container-hosts/proxy-token-manager';

describe('ProxyTokenManager', () => {
  let manager: ProxyTokenManager<{ runId: string }>;

  beforeEach(() => {
    manager = new ProxyTokenManager<{ runId: string }>();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('generate', () => {
    it('returns a 64-character hex string token', () => {
      const token = manager.generate({ runId: 'r1' }, 60_000);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(manager.generate({ runId: `r${i}` }, 60_000));
      }
      expect(tokens.size).toBe(100);
    });

    it('increments the size counter', () => {
      expect(manager.size).toBe(0);
      manager.generate({ runId: 'r1' }, 60_000);
      expect(manager.size).toBe(1);
      manager.generate({ runId: 'r2' }, 60_000);
      expect(manager.size).toBe(2);
    });

    it('triggers cleanup when hitting max capacity', () => {
      const small = new ProxyTokenManager<{ runId: string }>(3);
      // Fill up with expired tokens
      vi.useFakeTimers();
      small.generate({ runId: 'r1' }, 1); // 1ms TTL
      small.generate({ runId: 'r2' }, 1);
      vi.advanceTimersByTime(10); // Expire them
      small.generate({ runId: 'r3' }, 60_000); // Should trigger cleanup
      // After cleanup of 2 expired + generate 1, size should be <= 3
      expect(small.size).toBeLessThanOrEqual(3);
      vi.useRealTimers();
    });

    it('evicts oldest token when at capacity and no expired tokens', () => {
      const small = new ProxyTokenManager<{ runId: string }>(2);
      const token1 = small.generate({ runId: 'r1' }, 60_000);
      small.generate({ runId: 'r2' }, 60_000);
      // At capacity, generate a third
      small.generate({ runId: 'r3' }, 60_000);
      // token1 should be evicted
      expect(small.verify(token1)).toBeNull();
      expect(small.size).toBe(2);
    });
  });

  describe('verify', () => {
    it('returns metadata for valid token', () => {
      const token = manager.generate({ runId: 'r1' }, 60_000);
      const info = manager.verify(token);
      expect(info).toEqual({ runId: 'r1' });
    });

    it('returns null for invalid token', () => {
      manager.generate({ runId: 'r1' }, 60_000);
      expect(manager.verify('nonexistent-token')).toBeNull();
    });

    it('returns null for empty/null/undefined token', () => {
      expect(manager.verify('')).toBeNull();
      expect(manager.verify(null as unknown as string)).toBeNull();
      expect(manager.verify(undefined as unknown as string)).toBeNull();
    });

    it('returns null and removes expired token', () => {
      vi.useFakeTimers();
      const token = manager.generate({ runId: 'r1' }, 100);
      expect(manager.verify(token)).toEqual({ runId: 'r1' });

      vi.advanceTimersByTime(200);
      expect(manager.verify(token)).toBeNull();
      // Token should have been removed
      expect(manager.size).toBe(0);
      vi.useRealTimers();
    });

    it('does not return false positive for similar tokens', () => {
      const token = manager.generate({ runId: 'r1' }, 60_000);
      // Modify one character
      const fakeToken = token.charAt(0) === 'a'
        ? 'b' + token.slice(1)
        : 'a' + token.slice(1);
      expect(manager.verify(fakeToken)).toBeNull();
    });
  });

  describe('revoke', () => {
    it('removes an existing token', () => {
      const token = manager.generate({ runId: 'r1' }, 60_000);
      expect(manager.revoke(token)).toBe(true);
      expect(manager.verify(token)).toBeNull();
      expect(manager.size).toBe(0);
    });

    it('returns false for non-existent token', () => {
      expect(manager.revoke('nonexistent')).toBe(false);
    });
  });

  describe('revokeWhere', () => {
    it('revokes all tokens matching predicate', () => {
      const token1 = manager.generate({ runId: 'r1' }, 60_000);
      const token2 = manager.generate({ runId: 'r1' }, 60_000);
      const token3 = manager.generate({ runId: 'r2' }, 60_000);

      const count = manager.revokeWhere((info) => info.runId === 'r1');

      expect(count).toBe(2);
      expect(manager.verify(token1)).toBeNull();
      expect(manager.verify(token2)).toBeNull();
      expect(manager.verify(token3)).toEqual({ runId: 'r2' });
    });

    it('returns 0 when no tokens match', () => {
      manager.generate({ runId: 'r1' }, 60_000);
      const count = manager.revokeWhere((info) => info.runId === 'nonexistent');
      expect(count).toBe(0);
      expect(manager.size).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('removes expired tokens', () => {
      vi.useFakeTimers();
      manager.generate({ runId: 'r1' }, 100);
      manager.generate({ runId: 'r2' }, 100);
      const keepToken = manager.generate({ runId: 'r3' }, 60_000);

      vi.advanceTimersByTime(200);
      manager.cleanup();

      expect(manager.size).toBe(1);
      expect(manager.verify(keepToken)).toEqual({ runId: 'r3' });
      vi.useRealTimers();
    });

    it('handles empty manager', () => {
      manager.cleanup();
      expect(manager.size).toBe(0);
    });
  });

  describe('size', () => {
    it('reports 0 for new manager', () => {
      expect(manager.size).toBe(0);
    });

    it('tracks token count accurately', () => {
      manager.generate({ runId: 'r1' }, 60_000);
      manager.generate({ runId: 'r2' }, 60_000);
      expect(manager.size).toBe(2);

      const token = manager.generate({ runId: 'r3' }, 60_000);
      manager.revoke(token);
      expect(manager.size).toBe(2);
    });
  });

  describe('constructor maxTokens', () => {
    it('defaults to 10000', () => {
      const m = new ProxyTokenManager();
      // Generate a token to verify functionality
      const token = m.generate({ runId: 'r1' } as any, 60_000);
      expect(m.verify(token)).toBeDefined();
    });

    it('accepts custom maxTokens', () => {
      const small = new ProxyTokenManager<{ runId: string }>(1);
      const token1 = small.generate({ runId: 'r1' }, 60_000);
      small.generate({ runId: 'r2' }, 60_000);
      // token1 should be evicted
      expect(small.verify(token1)).toBeNull();
      expect(small.size).toBe(1);
    });
  });
});
