import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { requireTurnstile } from '@/middleware/turnstile';

function createApp(envOverrides: Partial<Record<string, unknown>> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireTurnstile());
  app.post('/auth/signup', (c) => c.json({ ok: true }));
  return { app, env: createMockEnv(envOverrides) };
}

describe('requireTurnstile middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('skips validation when TURNSTILE_SECRET_KEY is not configured', async () => {
    const { app, env } = createApp();
    // Default mock env does not have TURNSTILE_SECRET_KEY
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('rejects requests without turnstile token when secret is configured', async () => {
    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toContain('Turnstile token required');
  });

  it('accepts token from X-Turnstile-Token header and verifies with API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', {
        method: 'POST',
        headers: { 'X-Turnstile-Token': 'valid-token' },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCall = fetchSpy.mock.calls[0];
    expect(fetchCall[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('accepts token from turnstile_token query parameter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup?turnstile_token=query-token', {
        method: 'POST',
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('rejects when Turnstile API returns success: false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 }),
    );

    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const res = await app.fetch(
      new Request('http://localhost/auth/signup', {
        method: 'POST',
        headers: { 'X-Turnstile-Token': 'invalid-token' },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toContain('Turnstile verification failed');
  });

  it('passes CF-Connecting-IP to Turnstile verify API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

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

    const fetchCall = fetchSpy.mock.calls[0];
    const body = fetchCall[1]?.body as URLSearchParams;
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });
});
