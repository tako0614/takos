import { Hono } from 'hono';
import { generateKeyPairSync } from 'node:crypto';

const testServiceJwtKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Set JWT_PUBLIC_KEY for tests if not already set
if (!Deno.env.get('JWT_PUBLIC_KEY')) {
  Deno.env.set('JWT_PUBLIC_KEY', testServiceJwtKeys.publicKey);
}

// [Deno] vi.mock for space-scope and executor removed — tests should use manual stubs

export function createTestApp(): Hono {
  return new Hono();
}

export type TestRequestOptions = {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
};

export async function testRequest(
  app: Hono,
  options: TestRequestOptions,
): Promise<{
  status: number;
  headers: Headers;
  body: unknown;
}> {
  const url = (() => {
    if (!options.query) return options.path;
    const qs = new URLSearchParams(options.query).toString();
    return qs ? `${options.path}?${qs}` : options.path;
  })();

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] ||= 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await app.request(url, {
    method: options.method,
    headers,
    body,
  });

  const contentType = response.headers.get('content-type') || '';
  const parsedBody = contentType.includes('application/json') ? await response.json() : await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: parsedBody,
  };
}
