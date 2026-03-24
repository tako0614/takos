import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { CliCommandExit } from '../src/lib/command-exit.js';

const loginMocks = vi.hoisted(() => {
  const saveTokenMock = vi.fn();
  const saveApiUrlMock = vi.fn();
  const clearCredentialsMock = vi.fn();
  const isContainerModeMock = vi.fn(() => false);
  const validateApiUrlMock = vi.fn(() => ({ valid: true }));
  const getConfigMock = vi.fn(() => ({ apiUrl: 'https://takos.jp' }));
  const getLoginTimeoutMsMock = vi.fn(() => 5 * 60 * 1000);
  const openMock = vi.fn().mockResolvedValue(undefined);

  let requestHandler: ((req: any, res: any) => Promise<void>) | undefined;

  const server = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'request') {
        requestHandler = handler as (req: any, res: any) => Promise<void>;
      }
    }),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      callback();
    }),
    address: vi.fn(() => ({ address: '127.0.0.1', port: 43123 })),
    close: vi.fn((callback: (err?: Error | null) => void) => {
      callback();
    }),
  };

  const createServerMock = vi.fn(() => {
    return server;
  });

  return {
    saveTokenMock,
    saveApiUrlMock,
    clearCredentialsMock,
    isContainerModeMock,
    validateApiUrlMock,
    getConfigMock,
    getLoginTimeoutMsMock,
    openMock,
    createServerMock,
    serverListenMock: server.listen,
    getRequestHandler: () => requestHandler,
    resetRequestHandler: () => {
      requestHandler = undefined;
    },
  };
});

vi.mock('../src/lib/config.js', () => ({
  saveToken: loginMocks.saveTokenMock,
  saveApiUrl: loginMocks.saveApiUrlMock,
  clearCredentials: loginMocks.clearCredentialsMock,
  isContainerMode: loginMocks.isContainerModeMock,
  validateApiUrl: loginMocks.validateApiUrlMock,
  getConfig: loginMocks.getConfigMock,
  getLoginTimeoutMs: loginMocks.getLoginTimeoutMsMock,
}));

vi.mock('http', () => ({
  createServer: loginMocks.createServerMock,
}));

vi.mock('open', () => ({
  default: loginMocks.openMock,
}));

import { registerLoginCommand } from '../src/commands/login.js';

function createJsonCallbackRequest(payload: Record<string, unknown>): any {
  const body = Buffer.from(JSON.stringify(payload));
  return {
    method: 'POST',
    url: '/callback',
    headers: {
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

function createGetCallbackRequest(url: string): any {
  return {
    method: 'GET',
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      // GET callback must not rely on request body.
    },
  };
}

describe('login command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loginMocks.saveTokenMock.mockReset();
    loginMocks.saveApiUrlMock.mockReset();
    loginMocks.clearCredentialsMock.mockReset();
    loginMocks.isContainerModeMock.mockReset();
    loginMocks.isContainerModeMock.mockReturnValue(false);
    loginMocks.validateApiUrlMock.mockReset();
    loginMocks.validateApiUrlMock.mockReturnValue({ valid: true });
    loginMocks.getConfigMock.mockReset();
    loginMocks.getConfigMock.mockReturnValue({ apiUrl: 'https://takos.jp' });
    loginMocks.getLoginTimeoutMsMock.mockReset();
    loginMocks.getLoginTimeoutMsMock.mockReturnValue(5 * 60 * 1000);
    loginMocks.openMock.mockReset();
    loginMocks.openMock.mockResolvedValue(undefined);
    loginMocks.createServerMock.mockClear();
    loginMocks.resetRequestHandler();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('persists apiUrl after successful login with --api-url', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync([
      'node',
      'takos',
      'login',
      '--api-url',
      'https://api.takos.dev',
    ]);

    await Promise.resolve();

    expect(loginMocks.serverListenMock).toHaveBeenCalledTimes(1);
    const [boundPort, bindAddress] = loginMocks.serverListenMock.mock.calls[0] as [number, string];
    expect(bindAddress).toBe('127.0.0.1');
    expect(boundPort).toBe(0);

    const authUrlLine = logSpy.mock.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    expect(authUrlLine).toBeDefined();
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackHandler = loginMocks.getRequestHandler();
    expect(callbackHandler).toBeDefined();

    const req = createJsonCallbackRequest({
      token: 'test-token',
      state,
    });
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    await callbackHandler!(req, res);
    await expect(parsePromise).resolves.toBe(program);

    expect(loginMocks.saveTokenMock).toHaveBeenCalledWith('test-token');
    expect(loginMocks.saveApiUrlMock).toHaveBeenCalledWith('https://api.takos.dev');
    expect(loginMocks.validateApiUrlMock).toHaveBeenCalledWith('https://api.takos.dev');

    logSpy.mockRestore();
  });

  it('uses configured endpoint when --api-url is omitted', async () => {
    const logSpy = vi.spyOn(console, 'log');
    loginMocks.getConfigMock.mockReturnValue({ apiUrl: 'https://test.takos.jp' });

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);

    await Promise.resolve();

    const authUrlLine = logSpy.mock.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    expect(authUrlLine).toBeDefined();
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    expect(authUrl.origin).toBe('https://test.takos.jp');
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackHandler = loginMocks.getRequestHandler();
    expect(callbackHandler).toBeDefined();

    const req = createJsonCallbackRequest({
      token: 'configured-endpoint-token',
      state,
    });
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    await callbackHandler!(req, res);
    await expect(parsePromise).resolves.toBe(program);
    expect(loginMocks.saveTokenMock).toHaveBeenCalledWith('configured-endpoint-token');
    expect(loginMocks.saveApiUrlMock).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('fails closed for GET callback query token and does not persist credentials', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);
    const handledParsePromise = parsePromise.catch((error) => error);

    await Promise.resolve();

    const authUrlLine = logSpy.mock.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    expect(authUrlLine).toBeDefined();
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackHandler = loginMocks.getRequestHandler();
    expect(callbackHandler).toBeDefined();

    const req = createGetCallbackRequest(`/callback?token=query-token&state=${state}`);
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    await callbackHandler!(req, res);
    await expect(handledParsePromise).resolves.toBeInstanceOf(CliCommandExit);

    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/html' });
    expect(String(res.end.mock.calls[0]?.[0] ?? '')).toContain('Invalid callback payload');
    expect(loginMocks.saveTokenMock).not.toHaveBeenCalled();

    const authFailureLine = logSpy.mock.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Authentication failed:'));
    expect(authFailureLine).toContain('Invalid callback payload');

    logSpy.mockRestore();
  });

  it('sanitizes callback error before rendering and logging', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);
    const handledParsePromise = parsePromise.catch((error) => error);

    await Promise.resolve();

    const authUrlLine = logSpy.mock.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    expect(authUrlLine).toBeDefined();
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    const state = authUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackHandler = loginMocks.getRequestHandler();
    expect(callbackHandler).toBeDefined();

    const maliciousError = '<img src=x onerror=alert(1)>';
    const req = createJsonCallbackRequest({
      state,
      error: maliciousError,
    });
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    await callbackHandler!(req, res);
    await expect(handledParsePromise).resolves.toBeInstanceOf(CliCommandExit);

    const html = String(res.end.mock.calls[0]?.[0] ?? '');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain(maliciousError);

    const authFailureLine = logSpy.mock.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Authentication failed:'));
    expect(authFailureLine).toBeDefined();
    expect(authFailureLine).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(authFailureLine).not.toContain(maliciousError);
    expect(loginMocks.saveTokenMock).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('uses shared login timeout configuration', async () => {
    loginMocks.getLoginTimeoutMsMock.mockReturnValue(123_456);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);
    const handledParsePromise = parsePromise.catch((error) => error);

    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 123_456)).toBe(true);
    await vi.advanceTimersByTimeAsync(123_456);
    await expect(handledParsePromise).resolves.toBeInstanceOf(CliCommandExit);
    expect(loginMocks.saveTokenMock).not.toHaveBeenCalled();
  });
});
