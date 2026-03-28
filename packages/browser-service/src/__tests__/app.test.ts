import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock playwright-core and @takoserver/common before importing app
vi.mock('playwright-core', () => ({
  chromium: {
    launchPersistentContext: vi.fn(),
  },
}));

vi.mock('@takoserver/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('@takoserver/common/validation', () => ({
  isPrivateIP: (ip: string) => ip.startsWith('10.') || ip.startsWith('192.168.'),
  isLocalhost: (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1',
}));

import { createBrowserServiceApp } from '../app.js';

describe('createBrowserServiceApp', () => {
  it('creates an app with browser and logger', () => {
    const { app, browser, logger } = createBrowserServiceApp();
    expect(app).toBeDefined();
    expect(browser).toBeDefined();
    expect(logger).toBeDefined();
  });

  it('uses custom service name', () => {
    const { app, browser, logger } = createBrowserServiceApp({ serviceName: 'custom-browser' });
    expect(app).toBeDefined();
    expect(browser).toBeDefined();
  });
});

describe('health endpoint', () => {
  it('GET /internal/healthz returns status ok', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/healthz');
    const res = await app.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('browserd');
    expect(body.browser_alive).toBe(false);
  });

  it('GET /internal/healthz uses custom service name', async () => {
    const { app } = createBrowserServiceApp({ serviceName: 'my-browser' });
    const req = new Request('http://localhost/internal/healthz');
    const res = await app.fetch(req);
    const body = await res.json();
    expect(body.service).toBe('my-browser');
  });
});

describe('URL validation in bootstrap', () => {
  it('POST /internal/bootstrap rejects localhost URL', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:3000/evil' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('localhost');
  });

  it('POST /internal/bootstrap rejects private IP URL', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://192.168.1.1/admin' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('private');
  });

  it('POST /internal/bootstrap rejects non-http URL', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'ftp://example.com/file' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('HTTP/HTTPS');
  });

  it('POST /internal/bootstrap rejects URL with credentials', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://user:pass@example.com' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('credentials');
  });

  it('POST /internal/bootstrap rejects invalid URL format', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Invalid URL');
  });
});

describe('URL validation in goto', () => {
  it('POST /internal/goto rejects localhost URL', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/goto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:8080/' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('localhost');
  });

  it('POST /internal/goto rejects private IP', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/goto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://10.0.0.1/' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('private');
  });
});

describe('action endpoint', () => {
  it('POST /internal/action returns 400 when type is missing', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing action type');
  });
});

describe('tab endpoints', () => {
  it('POST /internal/tab/close returns 400 when index is not a number', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/tab/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 'not-a-number' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing tab index');
  });

  it('POST /internal/tab/switch returns 400 when index is not a number', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/tab/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: null }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing tab index');
  });
});

describe('tab/new URL validation', () => {
  it('POST /internal/tab/new rejects private IP URL', async () => {
    const { app } = createBrowserServiceApp();
    const req = new Request('http://localhost/internal/tab/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://10.0.0.1/' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('private');
  });
});
