/**
 * Example Test File for takos-control
 *
 * Demonstrates testing patterns for:
 * - Unit tests with mocked dependencies
 * - Factory usage for test data
 * - API testing patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createUser,
  createWorkspace,
  createUserWithWorkspace,
  createThreadWithMessages,
  resetIdCounter,
} from './helpers/factories';
import { createMockEnv } from './setup';

type CanonicalSpaceLike = {
  id: string;
  name: string;
  principal_id?: string;
  kind?: string;
  is_personal?: boolean | number;
};

type CanonicalUserLike = {
  id: string;
  principal_id?: string;
};

function getSpacePrincipalId(space: CanonicalSpaceLike): string | undefined {
  return space.principal_id;
}

function isPersonalSpace(space: CanonicalSpaceLike): boolean {
  return space.is_personal === true || space.is_personal === 1 || space.kind === 'user';
}

function getUserPrincipalId(user: CanonicalUserLike): string {
  return user.principal_id ?? (() => {
    throw new Error('principal_id is required in canonical test fixtures');
  })();
}

// ============================================================================
// Factory Tests - Demonstrate factory usage
// ============================================================================

describe('Test Factories', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('createUser', () => {
    it('should create a user with default values', () => {
      const user = createUser();

      expect(user.id).toMatch(/^user-/);
      expect(user.email).toContain('@test.example.com');
      expect(user.name).toContain('Test User');
      expect(user.created_at).toBeDefined();
      expect(user.updated_at).toBeDefined();
    });

    it('should allow overriding user properties', () => {
      const user = createUser({
        name: 'Custom Name',
        email: 'custom@example.com',
        username: 'customuser',
      });

      expect(user.name).toBe('Custom Name');
      expect(user.email).toBe('custom@example.com');
      expect(user.username).toBe('customuser');
    });
  });

  describe('createWorkspace', () => {
    it('should create a space with default values', () => {
      const space = createWorkspace();

      expect(space.id).toMatch(/^ws-/);
      expect(space.name).toContain('Test Workspace');
      expect(getSpacePrincipalId(space)).toMatch(/^principal-/);
    });

    it('should create a personal space', () => {
      const space = createWorkspace({ kind: 'user' });

      expect(isPersonalSpace(space)).toBe(true);
    });
  });

  describe('createUserWithWorkspace', () => {
    it('should create a user with their personal space', () => {
      const { user, workspace: space, member } = createUserWithWorkspace();

      expect(isPersonalSpace(space)).toBe(true);
      expect(member.principal_id).toBe(getUserPrincipalId(user));
      expect(member.space_id).toBe(space.id);
      expect(member.role).toBe('owner');
    });
  });

  describe('createThreadWithMessages', () => {
    it('should create a thread with messages', () => {
      const { thread, messages } = createThreadWithMessages(
        { title: 'Test Conversation' },
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ]
      );

      expect(thread.title).toBe('Test Conversation');
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].sequence).toBe(2);
    });
  });
});

// ============================================================================
// Mock Environment Tests - Demonstrate mock usage
// ============================================================================

describe('Mock Environment', () => {
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    env = createMockEnv();
  });

  describe('MockD1Database', () => {
    it('should prepare and execute queries', async () => {
      const result = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
        .bind('test-id')
        .first();

      // Mock returns null by default
      expect(result).toBeNull();
    });

    it('should return success for run operations', async () => {
      const result = await env.DB.prepare('INSERT INTO users (id, name) VALUES (?, ?)')
        .bind('test-id', 'Test Name')
        .run();

      expect(result.success).toBe(true);
      expect(result.meta.changes).toBe(1);
    });
  });

  describe('MockR2Bucket', () => {
    it('should put and get objects', async () => {
      await env.TENANT_SOURCE.put('test-key', 'test-content');
      const obj = await env.TENANT_SOURCE.get('test-key');

      expect(obj).not.toBeNull();
      expect(await obj!.text()).toBe('test-content');
    });

    it('should return null for non-existent objects', async () => {
      const obj = await env.TENANT_SOURCE.get('non-existent');

      expect(obj).toBeNull();
    });

    it('should list objects with prefix', async () => {
      await env.TENANT_SOURCE.put('prefix/a', 'content a');
      await env.TENANT_SOURCE.put('prefix/b', 'content b');
      await env.TENANT_SOURCE.put('other/c', 'content c');

      const result = await env.TENANT_SOURCE.list({ prefix: 'prefix/' });

      expect(result.objects).toHaveLength(2);
      expect(result.objects.map((o) => o.key)).toContain('prefix/a');
      expect(result.objects.map((o) => o.key)).toContain('prefix/b');
    });
  });

  describe('MockKVNamespace', () => {
    it('should put and get values', async () => {
      await env.HOSTNAME_ROUTING.put('test-key', 'test-value');
      const value = await env.HOSTNAME_ROUTING.get('test-key');

      expect(value).toBe('test-value');
    });

    it('should support TTL', async () => {
      // Put with 1 second TTL
      await env.HOSTNAME_ROUTING.put('expiring-key', 'value', {
        expirationTtl: 1,
      });

      // Should be retrievable immediately
      const value = await env.HOSTNAME_ROUTING.get('expiring-key');
      expect(value).toBe('value');
    });

    it('should return null for non-existent keys', async () => {
      const value = await env.HOSTNAME_ROUTING.get('non-existent');

      expect(value).toBeNull();
    });
  });

  describe('MockQueue', () => {
    it('should send messages', async () => {
      await env.RUN_QUEUE.send({ runId: 'test-run', timestamp: Date.now() });

      const messages = (env.RUN_QUEUE as any).getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].body.runId).toBe('test-run');
    });

    it('should send batch messages', async () => {
      await env.RUN_QUEUE.sendBatch([
        { body: { runId: 'run-1', timestamp: Date.now() } },
        { body: { runId: 'run-2', timestamp: Date.now() } },
      ]);

      const messages = (env.RUN_QUEUE as any).getMessages();
      expect(messages).toHaveLength(2);
    });
  });
});

// ============================================================================
// Service Tests - Demonstrate testing services
// ============================================================================

describe('Service Layer Tests', () => {
  describe('Example Service', () => {
    it('should demonstrate mocking external calls', async () => {
      // Mock fetch for external API calls
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', mockFetch);

      // Your service code would call fetch here
      const response = await fetch('https://api.example.com/endpoint');
      const data = await response.json() as { success: boolean };

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/endpoint');
      expect(data.success).toBe(true);

      vi.unstubAllGlobals();
    });

    it('should demonstrate testing with spy', () => {
      const obj = {
        method: (x: number) => x * 2,
      };

      const spy = vi.spyOn(obj, 'method');

      const result = obj.method(5);

      expect(spy).toHaveBeenCalledWith(5);
      expect(result).toBe(10);
    });
  });
});

// ============================================================================
// Integration Test Pattern - Demonstrate full request flow
// ============================================================================

describe('Integration Test Pattern', () => {
  it('should demonstrate a complete test flow', async () => {
    // 1. Set up test data using factories
    const { user, workspace: space } = createUserWithWorkspace();
    const { thread, messages } = createThreadWithMessages(
      { space_id: space.id },
      [{ role: 'user', content: 'Test message' }]
    );

    // 2. Create mock environment
    const env = createMockEnv();

    // 3. Mock database responses (you would customize this for your needs)
    vi.spyOn(env.DB, 'prepare').mockImplementation((query: string) => {
      return {
        bind: () => ({
          first: async () => {
            if (query.includes('users')) return user;
            if (query.includes('spaces')) return space;
            if (query.includes('threads')) return thread;
            return null;
          },
          all: async () => ({
            results: messages,
            success: true,
            meta: {},
          }),
          run: async () => ({
            success: true,
            meta: { changes: 1, last_row_id: 1, duration: 0 },
          }),
        }),
      } as any;
    });

    // 4. Execute your code under test
    // In a real test, you would call your service or route handler here
    const userResult = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first();

    // 5. Assert results
    expect(userResult).toEqual(user);
  });
});
