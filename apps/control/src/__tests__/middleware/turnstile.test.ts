import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { requireTurnstile } from '@/middleware/turnstile';

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCalls } from 'jsr:@std/testing/mock';

function createApp(envOverrides: Partial<Record<string, unknown>> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireTurnstile());
  app.post('/auth/signup', (c) => c.json({ ok: true }));
  return { app, env: createMockEnv(envOverrides) };
}


  Deno.test('requireTurnstile middleware - skips validation when TURNSTILE_SECRET_KEY is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: restore mocks manually */ void 0;
  const { app, env } = createApp();
    // Default mock env does not have TURNSTILE_SECRET_KEY
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
})
  Deno.test('requireTurnstile middleware - rejects requests without turnstile token when secret is configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: restore mocks manually */ void 0;
  const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 403);
    const json = await res.json() as Record<string, unknown>;
    assertStringIncludes(json.error, 'Turnstile token required');
})
  Deno.test('requireTurnstile middleware - accepts token from X-Turnstile-Token header and verifies with API', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: restore mocks manually */ void 0;
  const fetchSpy = stub(globalThis, 'fetch') = (async () => new Response(JSON.stringify({ success: true }), { status: 200 }),) as any;

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', {
        method: 'POST',
        headers: { 'X-Turnstile-Token': 'valid-token' },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    assertSpyCalls(fetchSpy, 1);
    const fetchCall = fetchSpy.calls[0];
    assertEquals(fetchCall[0], 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
})
  Deno.test('requireTurnstile middleware - accepts token from turnstile_token query parameter', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: restore mocks manually */ void 0;
  stub(globalThis, 'fetch') = (async () => new Response(JSON.stringify({ success: true }), { status: 200 }),) as any;

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup?turnstile_token=query-token', {
        method: 'POST',
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
})
  Deno.test('requireTurnstile middleware - rejects when Turnstile API returns success: false', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: restore mocks manually */ void 0;
  stub(globalThis, 'fetch') = (async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 }),) as any;

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', {
        method: 'POST',
        headers: { 'X-Turnstile-Token': 'invalid-token' },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 403);
    const json = await res.json() as Record<string, unknown>;
    assertStringIncludes(json.error, 'Turnstile verification failed');
})
  Deno.test('requireTurnstile middleware - passes CF-Connecting-IP to Turnstile verify API', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: restore mocks manually */ void 0;
  const fetchSpy = stub(globalThis, 'fetch') = (async () => new Response(JSON.stringify({ success: true }), { status: 200 }),) as any;

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    await app.fetch(
      new Request('http://localhost/auth/signup', {
        method: 'POST',
        headers: {
          'X-Turnstile-Token': 'valid-token',
          'CF-Connecting-IP': '1.2.3.4',
        },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    const fetchCall = fetchSpy.calls[0];
    const body = fetchCall[1]?.body as URLSearchParams;
    assertEquals(body.get('remoteip'), '1.2.3.4');
})