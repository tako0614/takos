/**
 * Example Test File for takos-control
 *
 * Demonstrates testing patterns for:
 * - Unit tests with mocked dependencies
 * - Factory usage for test data
 * - API testing patterns
 */

import {
  createUser,
  createWorkspace,
  createUserWithWorkspace,
  createThreadWithMessages,
  resetIdCounter,
} from './helpers/factories.ts';
import { createMockEnv } from './setup.ts';

type CanonicalSpaceLike = {
import { assertEquals, assertNotEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCallArgs } from 'jsr:@std/testing/mock';

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



  
    Deno.test('Test Factories - createUser - should create a user with default values', () => {
  resetIdCounter();
  const user = createUser();

      assert(/^user-/.test(user.id));
      assertStringIncludes(user.email, '@test.example.com');
      assertStringIncludes(user.name, 'Test User');
      assert(user.created_at !== undefined);
      assert(user.updated_at !== undefined);
})

    Deno.test('Test Factories - createUser - should allow overriding user properties', () => {
  resetIdCounter();
  const user = createUser({
        name: 'Custom Name',
        email: 'custom@example.com',
        username: 'customuser',
      });

      assertEquals(user.name, 'Custom Name');
      assertEquals(user.email, 'custom@example.com');
      assertEquals(user.username, 'customuser');
})
  

  
    Deno.test('Test Factories - createWorkspace - should create a space with default values', () => {
  resetIdCounter();
  const space = createWorkspace();

      assert(/^ws-/.test(space.id));
      assertStringIncludes(space.name, 'Test Workspace');
      assert(/^principal-/.test(getSpacePrincipalId(space)));
})

    Deno.test('Test Factories - createWorkspace - should create a personal space', () => {
  resetIdCounter();
  const space = createWorkspace({ kind: 'user' });

      assertEquals(isPersonalSpace(space), true);
})
  

  
    Deno.test('Test Factories - createUserWithWorkspace - should create a user with their personal space', () => {
  resetIdCounter();
  const { user, workspace: space, member } = createUserWithWorkspace();

      assertEquals(isPersonalSpace(space), true);
      assertEquals(member.principal_id, getUserPrincipalId(user));
      assertEquals(member.space_id, space.id);
      assertEquals(member.role, 'owner');
})
  

  
    Deno.test('Test Factories - createThreadWithMessages - should create a thread with messages', () => {
  resetIdCounter();
  const { thread, messages } = createThreadWithMessages(
        { title: 'Test Conversation' },
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ]
      );

      assertEquals(thread.title, 'Test Conversation');
      assertEquals(messages.length, 3);
      assertEquals(messages[0].role, 'user');
      assertEquals(messages[0].content, 'Hello');
      assertEquals(messages[1].role, 'assistant');
      assertEquals(messages[2].sequence, 2);
})
  


// ============================================================================
// Mock Environment Tests - Demonstrate mock usage
// ============================================================================


  let env: ReturnType<typeof createMockEnv>;

  
    Deno.test('Mock Environment - MockD1Database - should prepare and execute queries', async () => {
  env = createMockEnv();
  const result = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
        .bind('test-id')
        .first();

      // Mock returns null by default
      assertEquals(result, null);
})

    Deno.test('Mock Environment - MockD1Database - should return success for run operations', async () => {
  env = createMockEnv();
  const result = await env.DB.prepare('INSERT INTO users (id, name) VALUES (?, ?)')
        .bind('test-id', 'Test Name')
        .run();

      assertEquals(result.success, true);
      assertEquals(result.meta.changes, 1);
})
  

  
    Deno.test('Mock Environment - MockR2Bucket - should put and get objects', async () => {
  env = createMockEnv();
  await env.TENANT_SOURCE.put('test-key', 'test-content');
      const obj = await env.TENANT_SOURCE.get('test-key');

      assertNotEquals(obj, null);
      assertEquals(await obj!.text(), 'test-content');
})

    Deno.test('Mock Environment - MockR2Bucket - should return null for non-existent objects', async () => {
  env = createMockEnv();
  const obj = await env.TENANT_SOURCE.get('non-existent');

      assertEquals(obj, null);
})

    Deno.test('Mock Environment - MockR2Bucket - should list objects with prefix', async () => {
  env = createMockEnv();
  await env.TENANT_SOURCE.put('prefix/a', 'content a');
      await env.TENANT_SOURCE.put('prefix/b', 'content b');
      await env.TENANT_SOURCE.put('other/c', 'content c');

      const result = await env.TENANT_SOURCE.list({ prefix: 'prefix/' });

      assertEquals(result.objects.length, 2);
      assertStringIncludes(result.objects.map((o) => o.key), 'prefix/a');
      assertStringIncludes(result.objects.map((o) => o.key), 'prefix/b');
})
  

  
    Deno.test('Mock Environment - MockKVNamespace - should put and get values', async () => {
  env = createMockEnv();
  await env.HOSTNAME_ROUTING.put('test-key', 'test-value');
      const value = await env.HOSTNAME_ROUTING.get('test-key');

      assertEquals(value, 'test-value');
})

    Deno.test('Mock Environment - MockKVNamespace - should support TTL', async () => {
  env = createMockEnv();
  // Put with 1 second TTL
      await env.HOSTNAME_ROUTING.put('expiring-key', 'value', {
        expirationTtl: 1,
      });

      // Should be retrievable immediately
      const value = await env.HOSTNAME_ROUTING.get('expiring-key');
      assertEquals(value, 'value');
})

    Deno.test('Mock Environment - MockKVNamespace - should return null for non-existent keys', async () => {
  env = createMockEnv();
  const value = await env.HOSTNAME_ROUTING.get('non-existent');

      assertEquals(value, null);
})
  

  
    Deno.test('Mock Environment - MockQueue - should send messages', async () => {
  env = createMockEnv();
  await env.RUN_QUEUE.send({ runId: 'test-run', timestamp: Date.now() });

      const messages = (env.RUN_QUEUE as any).getMessages();
      assertEquals(messages.length, 1);
      assertEquals(messages[0].body.runId, 'test-run');
})

    Deno.test('Mock Environment - MockQueue - should send batch messages', async () => {
  env = createMockEnv();
  await env.RUN_QUEUE.sendBatch([
        { body: { runId: 'run-1', timestamp: Date.now() } },
        { body: { runId: 'run-2', timestamp: Date.now() } },
      ]);

      const messages = (env.RUN_QUEUE as any).getMessages();
      assertEquals(messages.length, 2);
})
  


// ============================================================================
// Service Tests - Demonstrate testing services
// ============================================================================


  
    Deno.test('Service Layer Tests - Example Service - should demonstrate mocking external calls', async () => {
  // Mock fetch for external API calls
      const mockFetch = (async () => new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      (globalThis as any).fetch = mockFetch;

      // Your service code would call fetch here
      const response = await fetch('https://api.example.com/endpoint');
      const data = await response.json() as { success: boolean };

      assertSpyCallArgs(mockFetch, 0, ['https://api.example.com/endpoint']);
      assertEquals(data.success, true);

      /* TODO: restore stubbed globals manually */ void 0;
})

    Deno.test('Service Layer Tests - Example Service - should demonstrate testing with spy', () => {
  const obj = {
        method: (x: number) => x * 2,
      };

      const spy = stub(obj, 'method');

      const result = obj.method(5);

      assertSpyCallArgs(spy, 0, [5]);
      assertEquals(result, 10);
})
  


// ============================================================================
// Integration Test Pattern - Demonstrate full request flow
// ============================================================================


  Deno.test('Integration Test Pattern - should demonstrate a complete test flow', async () => {
  // 1. Set up test data using factories
    const { user, workspace: space } = createUserWithWorkspace();
    const { thread, messages } = createThreadWithMessages(
      { space_id: space.id },
      [{ role: 'user', content: 'Test message' }]
    );

    // 2. Create mock environment
    const env = createMockEnv();

    // 3. Mock database responses (you would customize this for your needs)
    stub(env.DB, 'prepare') = (query: string) => {
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
    } as any;

    // 4. Execute your code under test
    // In a real test, you would call your service or route handler here
    const userResult = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first();

    // 5. Assert results
    assertEquals(userResult, user);
})

