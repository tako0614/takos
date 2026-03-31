import { Hono } from 'hono';
import type { Env } from '@/types';
import { validateApiOpaqueRouteParams } from '@/middleware/param-validation';

type TestEnv = {
import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

  Bindings: Env;
  Variables: { user?: { id: string } };
};

function createApp() {
  const app = new Hono<TestEnv>();
  app.use('/repos/:repoId', validateApiOpaqueRouteParams);
  app.use('/repos/:repoId/*', validateApiOpaqueRouteParams);
  app.use('/resources/:id/bind/:serviceId', validateApiOpaqueRouteParams);
  app.use('/spaces/:spaceId', validateApiOpaqueRouteParams);
  app.use('/spaces/:spaceId/*', validateApiOpaqueRouteParams);
  app.use('/users/:username', validateApiOpaqueRouteParams);
  app.use('/users/:username/*', validateApiOpaqueRouteParams);
  app.get('/repos/:repoId', (c) => c.json({ ok: true, repoId: c.req.param('repoId') }));
  app.get('/resources/:id/bind/:serviceId', (c) => c.json({
    ok: true,
    id: c.req.param('id'),
    serviceId: c.req.param('serviceId'),
  }));
  app.get('/spaces/:spaceId', (c) => c.json({ ok: true, spaceId: c.req.param('spaceId') }));
  app.get('/users/:username', (c) => c.json({ ok: true, username: c.req.param('username') }));
  return app;
}

const mockEnv = {} as unknown as Env;


  Deno.test('validateApiOpaqueRouteParams (issue 183) - allows valid opaque id params', async () => {
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/repos/repo-123_abc'),
      mockEnv,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, repoId: 'repo-123_abc' });
})
  Deno.test('validateApiOpaqueRouteParams (issue 183) - rejects malformed opaque id params with 400', async () => {
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/repos/repo.invalid'),
      mockEnv,
      {} as ExecutionContext
    );

    assertEquals(response.status, 400);
    await assertObjectMatch(await response.json(), {
      error: 'Invalid route parameter: repoId',
      code: 'BAD_REQUEST',
    });
})
  Deno.test('validateApiOpaqueRouteParams (issue 183) - does not validate non-id params as opaque ids', async () => {
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/users/alice.example'),
      mockEnv,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, username: 'alice.example' });
})
  Deno.test('validateApiOpaqueRouteParams (issue 183) - rejects malformed serviceId params with 400', async () => {
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/resources/res-123/bind/service.invalid'),
      mockEnv,
      {} as ExecutionContext
    );

    assertEquals(response.status, 400);
    await assertObjectMatch(await response.json(), {
      error: 'Invalid route parameter: serviceId',
      code: 'BAD_REQUEST',
    });
})
  Deno.test('validateApiOpaqueRouteParams (issue 183) - allows personal workspace alias for spaceId params', async () => {
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/spaces/me'),
      mockEnv,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, spaceId: 'me' });
})
  Deno.test('validateApiOpaqueRouteParams (issue 183) - allows workspace slug values for spaceId params', async () => {
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/spaces/team-alpha'),
      mockEnv,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, spaceId: 'team-alpha' });
})