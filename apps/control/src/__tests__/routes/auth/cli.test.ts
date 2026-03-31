import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup.ts';

import { assertEquals, assertNotEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

const mocks = ({
  createSession: ((..._args: any[]) => undefined) as any,
  storeOAuthState: ((..._args: any[]) => undefined) as any,
  validateOAuthState: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/session'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/auth-utils'
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


  Deno.test('auth cli callback transport - sets CSP with localhost form-action restrictions and sha256 hashes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateOAuthState = (async () => ({
      valid: true,
      cliCallback: 'http://localhost:3344/callback',
      returnTo: 'cli_state_1234567',
    })) as any;
  const response = await callCliCallback('http://localhost/cli/callback?state=oauth-state&error=access_denied');

    assertEquals(response.status, 200);
    const csp = response.headers.get('content-security-policy');
    assertStringIncludes(csp, "default-src 'none'");
    assertStringIncludes(csp, "base-uri 'none'");
    assertStringIncludes(csp, "frame-ancestors 'none'");
    assertStringIncludes(csp, "form-action 'self' http://127.0.0.1:* http://localhost:*");
    assert(/script-src 'sha256-[A-Za-z0-9+\/=]+'/.test(csp));
    assert(/style-src 'sha256-[A-Za-z0-9+\/=]+'/.test(csp));
    assert(!(csp).includes("'unsafe-inline'"));
    assertEquals(response.headers.get('cache-control'), 'no-store');
    assertEquals(response.headers.get('referrer-policy'), 'no-referrer');
})
  Deno.test('auth cli callback transport - renders callback transport HTML with POST form fields, style, and auto-submit script', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateOAuthState = (async () => ({
      valid: true,
      cliCallback: 'http://localhost:3344/callback',
      returnTo: 'cli_state_1234567',
    })) as any;
  const response = await callCliCallback('http://localhost/cli/callback?state=oauth-state&error=access_denied');

    assertEquals(response.status, 200);
    const html = await response.text();

    assertStringIncludes(html, '<form id="cli-callback-form" method="POST" action="http://localhost:3344/callback">');
    assertStringIncludes(html, '<input type="hidden" name="error" value="access_denied" />');
    assertStringIncludes(html, '<input type="hidden" name="state" value="cli_state_1234567" />');
    assertStringIncludes(html, '<noscript>');
    assertStringIncludes(html, '<style>');
    assertStringIncludes(html, 'body{font-family:system-ui,sans-serif;padding:24px;}');
    assertStringIncludes(html, '<script>');
    assertStringIncludes(html, "document.getElementById('cli-callback-form')?.submit();");
    assert(!(html).includes('<body style='));
})
  Deno.test('auth cli callback transport - matches CSP sha256 hashes with rendered style/script contents', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateOAuthState = (async () => ({
      valid: true,
      cliCallback: 'http://localhost:3344/callback',
      returnTo: 'cli_state_1234567',
    })) as any;
  const response = await callCliCallback('http://localhost/cli/callback?state=oauth-state&error=access_denied');

    assertEquals(response.status, 200);
    const csp = response.headers.get('content-security-policy');
    const html = await response.text();

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);

    assertNotEquals(scriptMatch, null);
    assertNotEquals(styleMatch, null);

    const scriptHash = await sha256Base64(scriptMatch![1]);
    const styleHash = await sha256Base64(styleMatch![1]);

    assertStringIncludes(csp, `script-src 'sha256-${scriptHash}'`);
    assertStringIncludes(csp, `style-src 'sha256-${styleHash}'`);
})