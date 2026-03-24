import { describe, expect, it, vi } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';
import { createApiRouter, type ApiVariables } from '@/routes/api';

type ApiRouteEnv = {
  Bindings: Env;
  Variables: ApiVariables;
};

describe('api router git auth guard (issue 025)', () => {
  it('requires auth for /api/git/* routes', async () => {
    const requireAuth: MiddlewareHandler<ApiRouteEnv> = vi.fn(async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    });
    const optionalAuth: MiddlewareHandler<ApiRouteEnv> = async (_c, next) => {
      await next();
    };

    const app = new Hono<ApiRouteEnv>();
    app.route('/api', createApiRouter({ requireAuth, optionalAuth }));

    const response = await app.fetch(
      new Request('http://localhost/api/git/repos/repo-1/refs'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(requireAuth).toHaveBeenCalledTimes(1);
  });

  it('does not mount /api/svcs/* routes', async () => {
    const requireAuth: MiddlewareHandler<ApiRouteEnv> = vi.fn(async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    });
    const optionalAuth: MiddlewareHandler<ApiRouteEnv> = async (_c, next) => {
      await next();
    };

    const app = new Hono<ApiRouteEnv>();
    app.route('/api', createApiRouter({ requireAuth, optionalAuth }));

    const response = await app.fetch(
      new Request('http://localhost/api/svcs/repos/repo-1/refs'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    expect(requireAuth).toHaveBeenCalledTimes(0);
  });

  it('keeps MCP OAuth callback public while protecting MCP servers', async () => {
    const requireAuth: MiddlewareHandler<ApiRouteEnv> = vi.fn(async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    });
    const optionalAuth: MiddlewareHandler<ApiRouteEnv> = async (_c, next) => {
      await next();
    };

    const app = new Hono<ApiRouteEnv>();
    app.route('/api', createApiRouter({ requireAuth, optionalAuth }));

    const callbackResponse = await app.fetch(
      new Request('http://localhost/api/mcp/oauth/callback'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(callbackResponse.status).toBe(400);

    const serversResponse = await app.fetch(
      new Request('http://localhost/api/mcp/servers?spaceId=ws-1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(serversResponse.status).toBe(401);
    expect(requireAuth).toHaveBeenCalledTimes(1);
  });

  it('does not expose internal OAuth proxy routes publicly', async () => {
    const requireAuth: MiddlewareHandler<ApiRouteEnv> = vi.fn(async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    });
    const optionalAuth: MiddlewareHandler<ApiRouteEnv> = async (_c, next) => {
      await next();
    };

    const app = new Hono<ApiRouteEnv>();
    app.route('/api', createApiRouter({ requireAuth, optionalAuth }));

    const response = await app.fetch(
      new Request('https://internal/api/internal/oauth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    expect(requireAuth).toHaveBeenCalledTimes(0);
  });

});
