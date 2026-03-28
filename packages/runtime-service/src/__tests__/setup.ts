import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPairSync } from 'node:crypto';

const testServiceJwtKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env.JWT_PUBLIC_KEY ||= testServiceJwtKeys.publicKey;

// Route tests focus on route behavior. Allow missing service-token scope to pass.
vi.mock('../middleware/space-scope.js', async () => {
  const actual = await vi.importActual<any>('../middleware/space-scope.js');
  const original = actual.enforceSpaceScopeMiddleware as (getIds: any) => any;

  return {
    ...actual,
    enforceSpaceScopeMiddleware: (getIds: any) => {
      const middleware = original(getIds);
      return async (c: any, next: any) => {
        const token = c.get?.('serviceToken') as { scope_space_id?: string } | undefined;
        if (!token?.scope_space_id) {
          await next();
          return;
        }
        return middleware(c, next);
      };
    },
  };
});

// Keep pwd-based composite-action assertions deterministic across hosts.
vi.mock('../runtime/actions/executor.js', async () => {
  const actual = await vi.importActual<typeof import('../runtime/actions/executor.js')>('../runtime/actions/executor.js');
  const ActualStepExecutor = actual.StepExecutor;

  class PatchedStepExecutor extends ActualStepExecutor {
    override async executeRun(
      command: string,
      timeoutMs?: number,
      options?: { shell?: string; workingDirectory?: string },
    ): Promise<import('../runtime/actions/executor.js').ExecutorStepResult> {
      if (command.trim() === 'pwd') {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          outputs: {},
          conclusion: 'success',
        };
      }
      return super.executeRun(command, timeoutMs, options);
    }
  }

  return {
    ...actual,
    StepExecutor: PatchedStepExecutor,
  };
});

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

export async function testRequest(app: Hono, options: TestRequestOptions): Promise<{
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
  const parsedBody = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: parsedBody,
  };
}

beforeAll(() => {
  if (!process.env.DEBUG) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});
