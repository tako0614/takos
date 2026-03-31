import { Hono, type MiddlewareHandler } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';
import { createApiRouter, type ApiVariables } from '@/routes/api';

type ApiRouteEnv = {
import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

  Bindings: Env;
  Variables: ApiVariables;
};


  Deno.test('api router git auth guard (issue 025) - requires auth for /api/git/* routes', async () => {
  const requireAuth: MiddlewareHandler<ApiRouteEnv> = async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    };
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

    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: 'Unauthorized' });
    assertSpyCalls(requireAuth, 1);
})
  Deno.test('api router git auth guard (issue 025) - does not mount /api/svcs/* routes', async () => {
  const requireAuth: MiddlewareHandler<ApiRouteEnv> = async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    };
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

    assertEquals(response.status, 404);
    assertSpyCalls(requireAuth, 0);
})
  Deno.test('api router git auth guard (issue 025) - keeps MCP OAuth callback public while protecting MCP servers', async () => {
  const requireAuth: MiddlewareHandler<ApiRouteEnv> = async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    };
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
    assertEquals(callbackResponse.status, 400);

    const serversResponse = await app.fetch(
      new Request('http://localhost/api/mcp/servers?spaceId=ws-1'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(serversResponse.status, 401);
    assertSpyCalls(requireAuth, 1);
})
  Deno.test('api router git auth guard (issue 025) - does not expose internal OAuth proxy routes publicly', async () => {
  const requireAuth: MiddlewareHandler<ApiRouteEnv> = async (c) => {
      return c.json({ error: 'Unauthorized' }, 401);
    };
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

    assertEquals(response.status, 404);
    assertSpyCalls(requireAuth, 0);
})
