import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { validateApiOpaqueRouteParams } from '@/middleware/param-validation';

type TestEnv = {
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

describe('validateApiOpaqueRouteParams (issue 183)', () => {
  it('allows valid opaque id params', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/repos/repo-123_abc'),
      mockEnv,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, repoId: 'repo-123_abc' });
  });

  it('rejects malformed opaque id params with 400', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/repos/repo.invalid'),
      mockEnv,
      {} as ExecutionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid route parameter: repoId',
      code: 'BAD_REQUEST',
    });
  });

  it('does not validate non-id params as opaque ids', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/users/alice.example'),
      mockEnv,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, username: 'alice.example' });
  });

  it('rejects malformed serviceId params with 400', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/resources/res-123/bind/service.invalid'),
      mockEnv,
      {} as ExecutionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid route parameter: serviceId',
      code: 'BAD_REQUEST',
    });
  });

  it('allows personal workspace alias for spaceId params', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/spaces/me'),
      mockEnv,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, spaceId: 'me' });
  });

  it('allows workspace slug values for spaceId params', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/spaces/team-alpha'),
      mockEnv,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, spaceId: 'team-alpha' });
  });
});
