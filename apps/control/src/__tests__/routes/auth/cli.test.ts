import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  storeOAuthState: vi.fn(),
  validateOAuthState: vi.fn(),
}));

vi.mock('@/services/identity/session', () => ({
  createSession: mocks.createSession,
}));

vi.mock('@/services/identity/auth-utils', () => ({
  storeOAuthState: mocks.storeOAuthState,
  validateOAuthState: mocks.validateOAuthState,
}));

import { authCliRouter } from '@/routes/auth/cli';

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    ADMIN_DOMAIN: 'admin.takos.test',
    ...overrides,
  }) as unknown as Env;
}

async function callCliCallback(url: string, env: Env = createEnv()): Promise<Response> {
  const app = authCliRouter;
  return app.fetch(new Request(url), env, {} as ExecutionContext);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64(new Uint8Array(digest));
}

describe('auth cli callback transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateOAuthState.mockResolvedValue({
      valid: true,
      cliCallback: 'http://localhost:3344/callback',
      returnTo: 'cli_state_1234567',
    });
  });

  it('sets CSP with localhost form-action restrictions and sha256 hashes', async () => {
    const response = await callCliCallback('http://localhost/cli/callback?state=oauth-state&error=access_denied');

    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' http://127.0.0.1:* http://localhost:*");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toMatch(/style-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('renders callback transport HTML with POST form fields, style, and auto-submit script', async () => {
    const response = await callCliCallback('http://localhost/cli/callback?state=oauth-state&error=access_denied');

    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('<form id="cli-callback-form" method="POST" action="http://localhost:3344/callback">');
    expect(html).toContain('<input type="hidden" name="error" value="access_denied" />');
    expect(html).toContain('<input type="hidden" name="state" value="cli_state_1234567" />');
    expect(html).toContain('<noscript>');
    expect(html).toContain('<style>');
    expect(html).toContain('body{font-family:system-ui,sans-serif;padding:24px;}');
    expect(html).toContain('<script>');
    expect(html).toContain("document.getElementById('cli-callback-form')?.submit();");
    expect(html).not.toContain('<body style=');
  });

  it('matches CSP sha256 hashes with rendered style/script contents', async () => {
    const response = await callCliCallback('http://localhost/cli/callback?state=oauth-state&error=access_denied');

    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy');
    const html = await response.text();

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);

    expect(scriptMatch).not.toBeNull();
    expect(styleMatch).not.toBeNull();

    const scriptHash = await sha256Base64(scriptMatch![1]);
    const styleHash = await sha256Base64(styleMatch![1]);

    expect(csp).toContain(`script-src 'sha256-${scriptHash}'`);
    expect(csp).toContain(`style-src 'sha256-${styleHash}'`);
  });
});
