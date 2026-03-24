import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { validateContentType } from '@/middleware/content-type';

function createApp(options?: Parameters<typeof validateContentType>[0]) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', validateContentType(options));
  app.get('/api/data', (c) => c.json({ ok: true }));
  app.post('/api/data', async (c) => c.json({ ok: true }));
  app.put('/api/data', async (c) => c.json({ ok: true }));
  app.patch('/api/data', async (c) => c.json({ ok: true }));
  app.delete('/api/data', (c) => c.json({ ok: true }));
  return app;
}

describe('validateContentType middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows GET requests without Content-Type', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', { method: 'GET' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('allows DELETE requests without Content-Type', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', { method: 'DELETE' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('allows POST with application/json Content-Type', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '2',
        },
        body: '{}',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('allows POST with application/json; charset=utf-8', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': '2',
        },
        body: '{}',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('rejects POST with unsupported Content-Type', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': '5',
        },
        body: 'hello',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(415);
    const json = await res.json() as Record<string, unknown>;
    expect(json.code).toBe('UNSUPPORTED_CONTENT_TYPE');
    expect(json.error).toContain('text/plain');
  });

  it('rejects POST with missing Content-Type when body is present', async () => {
    const app = createApp({ allowEmptyBody: false });
    // Node's Request constructor auto-sets Content-Type: text/plain when a string body
    // is provided. To truly test MISSING_CONTENT_TYPE, we must explicitly delete it.
    const req = new Request('http://localhost/api/data', {
      method: 'POST',
      headers: { 'Content-Length': '5' },
      body: 'hello',
    });
    req.headers.delete('Content-Type');
    const res = await app.fetch(
      req,
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(415);
    const json = await res.json() as Record<string, unknown>;
    expect(json.code).toBe('MISSING_CONTENT_TYPE');
  });

  it('allows POST with empty body and no Content-Type by default', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: { 'Content-Length': '0' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('allows custom allowed types', async () => {
    const app = createApp({
      allowedTypes: ['application/json', 'application/xml'],
    });
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': '4',
        },
        body: '<ok/>',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('supports wildcard type matching', async () => {
    const app = createApp({
      allowedTypes: ['application/*'],
    });
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': '4',
        },
        body: '<ok/>',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('rejects PUT with wrong Content-Type', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'PUT',
        headers: {
          'Content-Type': 'multipart/form-data',
          'Content-Length': '10',
        },
        body: 'form-data',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(415);
    const json = await res.json() as Record<string, unknown>;
    expect(json.allowed).toEqual(['application/json']);
  });

  it('rejects PATCH with wrong Content-Type', async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': '10',
        },
        body: '<html></html>',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(415);
  });
});
