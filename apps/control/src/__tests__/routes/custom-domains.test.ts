import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  addCustomDomain: vi.fn(),
  deleteCustomDomain: vi.fn(),
  getCustomDomainDetails: vi.fn(),
  listCustomDomains: vi.fn(),
  refreshSslStatus: vi.fn(),
  verifyCustomDomain: vi.fn(),
  CustomDomainError: class extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

vi.mock('@/services/platform/custom-domains', () => ({
  addCustomDomain: mocks.addCustomDomain,
  CustomDomainError: mocks.CustomDomainError,
  deleteCustomDomain: mocks.deleteCustomDomain,
  getCustomDomainDetails: mocks.getCustomDomainDetails,
  listCustomDomains: mocks.listCustomDomains,
  refreshSslStatus: mocks.refreshSslStatus,
  verifyCustomDomain: mocks.verifyCustomDomain,
}));

vi.mock('@/shared/utils/logger', () => ({
  logError: vi.fn(),
}));

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

describe('custom-domains routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/services/:id/custom-domains', () => {
    it('returns list of custom domains', async () => {
      mocks.listCustomDomains.mockResolvedValue({
        domains: [{ id: 'd-1', domain: 'example.com' }],
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('domains');
    });

    it('returns error on CustomDomainError', async () => {
      mocks.listCustomDomains.mockRejectedValue(new mocks.CustomDomainError('Not found', 404));

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 500 on unexpected error', async () => {
      mocks.listCustomDomains.mockRejectedValue(new Error('Unexpected'));

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/services/:id/custom-domains', () => {
    it('adds a custom domain', async () => {
      mocks.addCustomDomain.mockResolvedValue({
        status: 201,
        body: { domain: 'new.example.com' },
      });

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

      expect(res.status).toBe(201);
    });

    it('rejects missing domain field', async () => {
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

      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/services/:id/custom-domains/:domainId/verify', () => {
    it('verifies a custom domain', async () => {
      mocks.verifyCustomDomain.mockResolvedValue({
        status: 200,
        body: { verified: true },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1/verify', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/services/:id/custom-domains/:domainId', () => {
    it('returns domain details', async () => {
      mocks.getCustomDomainDetails.mockResolvedValue({ id: 'd-1', domain: 'example.com' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/services/:id/custom-domains/:domainId', () => {
    it('deletes a custom domain', async () => {
      mocks.deleteCustomDomain.mockResolvedValue({ success: true });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1', {
          method: 'DELETE',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/services/:id/custom-domains/:domainId/refresh-ssl', () => {
    it('refreshes SSL status', async () => {
      mocks.refreshSslStatus.mockResolvedValue({ ssl_status: 'active' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/custom-domains/d-1/refresh-ssl', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });
});
