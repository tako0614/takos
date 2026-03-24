import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { bodyLimit, generalApiBodyLimit, oauthBodyLimit, searchBodyLimit } from '@/middleware/body-size';

function createApp(middleware: ReturnType<typeof bodyLimit>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', middleware);
  app.post('/api/data', async (c) => { await c.req.text(); return c.json({ ok: true }); });
  app.get('/api/data', (c) => c.json({ ok: true }));
  app.put('/api/data', async (c) => { await c.req.text(); return c.json({ ok: true }); });
  app.patch('/api/data', async (c) => { await c.req.text(); return c.json({ ok: true }); });
  return app;
}

describe('bodyLimit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows GET requests regardless of body size', async () => {
    const app = createApp(bodyLimit({ maxSize: 10 }));
    const res = await app.fetch(
      new Request('http://localhost/api/data', { method: 'GET' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('allows POST requests under the limit', async () => {
    const app = createApp(bodyLimit({ maxSize: 1024 }));
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ small: true }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('rejects POST requests over the limit with 413', async () => {
    const app = createApp(bodyLimit({ maxSize: 10, message: 'Too big' }));
    const largeBody = 'x'.repeat(100);
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: largeBody,
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(413);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Too big');
    expect(json.code).toBe('PAYLOAD_TOO_LARGE');
    expect(json.max_size).toBe(10);
  });

  it('rejects PUT requests over the limit', async () => {
    const app = createApp(bodyLimit({ maxSize: 10 }));
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(100),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(413);
  });

  it('rejects PATCH requests over the limit', async () => {
    const app = createApp(bodyLimit({ maxSize: 10 }));
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(100),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(413);
  });

  it('uses default error message when none is provided', async () => {
    const app = createApp(bodyLimit({ maxSize: 10 }));
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(100),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(413);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe('Request body too large');
  });

  it('skips enforcement when path matches skipPaths pattern', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', bodyLimit({
      maxSize: 10,
      skipPaths: [/\/api\/upload/],
    }));
    app.post('/api/upload', async (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '100',
        },
        body: 'x'.repeat(100),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });
});

describe('pre-configured body limits', () => {
  it('generalApiBodyLimit skips app-deployment paths', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', generalApiBodyLimit);
    app.post('/api/spaces/sp-1/app-deployments', async (c) => c.json({ ok: true }));

    const largeBody = 'x'.repeat(2 * 1024 * 1024);
    const res = await app.fetch(
      new Request('http://localhost/api/spaces/sp-1/app-deployments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(largeBody.length),
        },
        body: largeBody,
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    // Should not be 413 because app-deployments is skipped
    expect(res.status).toBe(200);
  });

  it('oauthBodyLimit rejects bodies over 64KB', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', oauthBodyLimit);
    app.post('/oauth/token', async (c) => { await c.req.text(); return c.json({ ok: true }); });

    const largeBody = 'x'.repeat(128 * 1024);
    const res = await app.fetch(
      new Request('http://localhost/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: largeBody,
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(413);
  });

  it('searchBodyLimit rejects bodies over 256KB', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', searchBodyLimit);
    app.post('/api/search', async (c) => { await c.req.text(); return c.json({ ok: true }); });

    const largeBody = 'x'.repeat(512 * 1024);
    const res = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: largeBody,
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(413);
  });
});
