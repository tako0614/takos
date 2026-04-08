import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { bodyLimit, generalApiBodyLimit, oauthBodyLimit, searchBodyLimit } from '@/middleware/body-size';

import { assertEquals } from 'jsr:@std/assert';

function createApp(middleware: ReturnType<typeof bodyLimit>) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', middleware);
  app.post('/api/data', async (c) => { await c.req.text(); return c.json({ ok: true }); });
  app.get('/api/data', (c) => c.json({ ok: true }));
  app.put('/api/data', async (c) => { await c.req.text(); return c.json({ ok: true }); });
  app.patch('/api/data', async (c) => { await c.req.text(); return c.json({ ok: true }); });
  return app;
}


  Deno.test('bodyLimit middleware - allows GET requests regardless of body size', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(bodyLimit({ maxSize: 10 }));
    const res = await app.fetch(
      new Request('http://localhost/api/data', { method: 'GET' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
})
  Deno.test('bodyLimit middleware - allows POST requests under the limit', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(res.status, 200);
})
  Deno.test('bodyLimit middleware - rejects POST requests over the limit with 413', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(res.status, 413);
    const json = await res.json() as { error: { code: string; message: string }; max_size: number };
    // Common error envelope: { error: { code, message } }
    assertEquals(json.error.code, 'PAYLOAD_TOO_LARGE');
    assertEquals(json.error.message, 'Too big');
    assertEquals(json.max_size, 10);
})
  Deno.test('bodyLimit middleware - rejects PUT requests over the limit', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(res.status, 413);
})
  Deno.test('bodyLimit middleware - rejects PATCH requests over the limit', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(res.status, 413);
})
  Deno.test('bodyLimit middleware - uses default error message when none is provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(res.status, 413);
    const json = await res.json() as { error: { code: string; message: string } };
    assertEquals(json.error.code, 'PAYLOAD_TOO_LARGE');
    assertEquals(json.error.message, 'Request body too large');
})
  Deno.test('bodyLimit middleware - skips enforcement when path matches skipPaths pattern', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(res.status, 200);
})

  Deno.test('pre-configured body limits - generalApiBodyLimit skips app-deployment paths', async () => {
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
    assertEquals(res.status, 200);
})
  Deno.test('pre-configured body limits - oauthBodyLimit rejects bodies over 64KB', async () => {
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
    assertEquals(res.status, 413);
})
  Deno.test('pre-configured body limits - searchBodyLimit rejects bodies over 256KB', async () => {
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
    assertEquals(res.status, 413);
})