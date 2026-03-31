import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  addCustomDomain: ((..._args: any[]) => undefined) as any,
  deleteCustomDomain: ((..._args: any[]) => undefined) as any,
  getCustomDomainDetails: ((..._args: any[]) => undefined) as any,
  listCustomDomains: ((..._args: any[]) => undefined) as any,
  refreshSslStatus: ((..._args: any[]) => undefined) as any,
  verifyCustomDomain: ((..._args: any[]) => undefined) as any,
  CustomDomainError: class extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
});

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/custom-domains'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import customDomainsRoute from '@/routes/custom-domains';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api', customDomainsRoute);
  return app;
}


  const env = createMockEnv();
  
    Deno.test('custom-domains routes - GET /api/services/:id/custom-domains - returns list of custom domains', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listCustomDomains = (async () => ({
        domains: [{ id: 'd-1', domain: 'example.com' }],
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert('domains' in json);
})
    Deno.test('custom-domains routes - GET /api/services/:id/custom-domains - returns error on CustomDomainError', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listCustomDomains = (async () => { throw new mocks.CustomDomainError('Not found', 404); }) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('custom-domains routes - GET /api/services/:id/custom-domains - returns 500 on unexpected error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listCustomDomains = (async () => { throw new Error('Unexpected'); }) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 500);
})  
  
    Deno.test('custom-domains routes - POST /api/services/:id/custom-domains - adds a custom domain', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.addCustomDomain = (async () => ({
        status: 201,
        body: { domain: 'new.example.com' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'new.example.com' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
})
    Deno.test('custom-domains routes - POST /api/services/:id/custom-domains - rejects missing domain field', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 422);
})  
  
    Deno.test('custom-domains routes - POST /api/services/:id/custom-domains/:domainId/verify - verifies a custom domain', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyCustomDomain = (async () => ({
        status: 200,
        body: { verified: true },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1/verify', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
})  
  
    Deno.test('custom-domains routes - GET /api/services/:id/custom-domains/:domainId - returns domain details', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getCustomDomainDetails = (async () => ({ id: 'd-1', domain: 'example.com' })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
})  
  
    Deno.test('custom-domains routes - DELETE /api/services/:id/custom-domains/:domainId - deletes a custom domain', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.deleteCustomDomain = (async () => ({ success: true })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1', {
          method: 'DELETE',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
})  
  
    Deno.test('custom-domains routes - POST /api/services/:id/custom-domains/:domainId/refresh-ssl - refreshes SSL status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.refreshSslStatus = (async () => ({ ssl_status: 'active' })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1/refresh-ssl', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
})  