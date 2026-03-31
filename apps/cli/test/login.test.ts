import { Command } from 'commander';
import { CliCommandExit } from '../src/lib/command-exit.ts';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';
import { FakeTime } from 'jsr:@std/testing/time';

const loginMocks = {
  const saveTokenMock = ((..._args: any[]) => undefined) as any;
  const saveApiUrlMock = ((..._args: any[]) => undefined) as any;
  const clearCredentialsMock = ((..._args: any[]) => undefined) as any;
  const isContainerModeMock = () => false;
  const validateApiUrlMock = () => ({ valid: true });
  const getConfigMock = () => ({ apiUrl: 'https://takos.jp' });
  const getLoginTimeoutMsMock = () => 5 * 60 * 1000;
  const openMock = (async () => undefined);

  let requestHandler: ((req: any, res: any) => Promise<void>) | undefined;

  const server = {
    on: (event: string, handler: (...args: any[]) => void) => {
      if (event === 'request') {
        requestHandler = handler as (req: any, res: any) => Promise<void>;
      }
    },
    listen: (_port: number, _host: string, callback: () => void) => {
      callback();
    },
    address: () => ({ address: '127.0.0.1', port: 43123 }),
    close: (callback: (err?: Error | null) => void) => {
      callback();
    },
  };

  const createServerMock = () => {
    return server;
  };

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
};

// [Deno] vi.mock removed - manually stub imports from '../src/lib/config.ts'
// [Deno] vi.mock removed - manually stub imports from 'http'
// [Deno] vi.mock removed - manually stub imports from 'open'
import { registerLoginCommand } from '../src/commands/login.ts';

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


  Deno.test('login command - persists apiUrl after successful login with --api-url', async () => {
  new FakeTime();
    loginMocks.saveTokenMock;
    loginMocks.saveApiUrlMock;
    loginMocks.clearCredentialsMock;
    loginMocks.isContainerModeMock;
    loginMocks.isContainerModeMock = (() => false) as any;
    loginMocks.validateApiUrlMock;
    loginMocks.validateApiUrlMock = (() => ({ valid: true })) as any;
    loginMocks.getConfigMock;
    loginMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    loginMocks.getLoginTimeoutMsMock;
    loginMocks.getLoginTimeoutMsMock = (() => 5 * 60 * 1000) as any;
    loginMocks.openMock;
    loginMocks.openMock = (async () => undefined) as any;
    loginMocks.createServerMock;
    loginMocks.resetRequestHandler();
  try {
  const logSpy = stub(console, 'log');

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

    assertSpyCalls(loginMocks.serverListenMock, 1);
    const [boundPort, bindAddress] = loginMocks.serverListenMock.calls[0] as [number, string];
    assertEquals(bindAddress, '127.0.0.1');
    assertEquals(boundPort, 0);

    const authUrlLine = logSpy.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    assert(authUrlLine !== undefined);
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    const state = authUrl.searchParams.get('state');
    assert(state);

    const callbackHandler = loginMocks.getRequestHandler();
    assert(callbackHandler !== undefined);

    const req = createJsonCallbackRequest({
      token: 'test-token',
      state,
    });
    const res = {
      writeHead: ((..._args: any[]) => undefined) as any,
      end: ((..._args: any[]) => undefined) as any,
    } as any;

    await callbackHandler!(req, res);
    await assertEquals(await parsePromise, program);

    assertSpyCallArgs(loginMocks.saveTokenMock, 0, ['test-token']);
    assertSpyCallArgs(loginMocks.saveApiUrlMock, 0, ['https://api.takos.dev']);
    assertSpyCallArgs(loginMocks.validateApiUrlMock, 0, ['https://api.takos.dev']);

    logSpy.restore();
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('login command - uses configured endpoint when --api-url is omitted', async () => {
  new FakeTime();
    loginMocks.saveTokenMock;
    loginMocks.saveApiUrlMock;
    loginMocks.clearCredentialsMock;
    loginMocks.isContainerModeMock;
    loginMocks.isContainerModeMock = (() => false) as any;
    loginMocks.validateApiUrlMock;
    loginMocks.validateApiUrlMock = (() => ({ valid: true })) as any;
    loginMocks.getConfigMock;
    loginMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    loginMocks.getLoginTimeoutMsMock;
    loginMocks.getLoginTimeoutMsMock = (() => 5 * 60 * 1000) as any;
    loginMocks.openMock;
    loginMocks.openMock = (async () => undefined) as any;
    loginMocks.createServerMock;
    loginMocks.resetRequestHandler();
  try {
  const logSpy = stub(console, 'log');
    loginMocks.getConfigMock = (() => ({ apiUrl: 'https://test.takos.jp' })) as any;

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);

    await Promise.resolve();

    const authUrlLine = logSpy.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    assert(authUrlLine !== undefined);
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    assertEquals(authUrl.origin, 'https://test.takos.jp');
    const state = authUrl.searchParams.get('state');
    assert(state);

    const callbackHandler = loginMocks.getRequestHandler();
    assert(callbackHandler !== undefined);

    const req = createJsonCallbackRequest({
      token: 'configured-endpoint-token',
      state,
    });
    const res = {
      writeHead: ((..._args: any[]) => undefined) as any,
      end: ((..._args: any[]) => undefined) as any,
    } as any;

    await callbackHandler!(req, res);
    await assertEquals(await parsePromise, program);
    assertSpyCallArgs(loginMocks.saveTokenMock, 0, ['configured-endpoint-token']);
    assertSpyCalls(loginMocks.saveApiUrlMock, 0);

    logSpy.restore();
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('login command - fails closed for GET callback query token and does not persist credentials', async () => {
  new FakeTime();
    loginMocks.saveTokenMock;
    loginMocks.saveApiUrlMock;
    loginMocks.clearCredentialsMock;
    loginMocks.isContainerModeMock;
    loginMocks.isContainerModeMock = (() => false) as any;
    loginMocks.validateApiUrlMock;
    loginMocks.validateApiUrlMock = (() => ({ valid: true })) as any;
    loginMocks.getConfigMock;
    loginMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    loginMocks.getLoginTimeoutMsMock;
    loginMocks.getLoginTimeoutMsMock = (() => 5 * 60 * 1000) as any;
    loginMocks.openMock;
    loginMocks.openMock = (async () => undefined) as any;
    loginMocks.createServerMock;
    loginMocks.resetRequestHandler();
  try {
  const logSpy = stub(console, 'log');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);
    const handledParsePromise = parsePromise.catch((error) => error);

    await Promise.resolve();

    const authUrlLine = logSpy.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    assert(authUrlLine !== undefined);
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    const state = authUrl.searchParams.get('state');
    assert(state);

    const callbackHandler = loginMocks.getRequestHandler();
    assert(callbackHandler !== undefined);

    const req = createGetCallbackRequest(`/callback?token=query-token&state=${state}`);
    const res = {
      writeHead: ((..._args: any[]) => undefined) as any,
      end: ((..._args: any[]) => undefined) as any,
    } as any;

    await callbackHandler!(req, res);
    await assert((await handledParsePromise) instanceof CliCommandExit);

    assertSpyCallArgs(res.writeHead, 0, [400, { 'Content-Type': 'text/html' }]);
    assertStringIncludes(String(res.end.calls[0]?.[0] ?? ''), 'Invalid callback payload');
    assertSpyCalls(loginMocks.saveTokenMock, 0);

    const authFailureLine = logSpy.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Authentication failed:'));
    assertStringIncludes(authFailureLine, 'Invalid callback payload');

    logSpy.restore();
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('login command - sanitizes callback error before rendering and logging', async () => {
  new FakeTime();
    loginMocks.saveTokenMock;
    loginMocks.saveApiUrlMock;
    loginMocks.clearCredentialsMock;
    loginMocks.isContainerModeMock;
    loginMocks.isContainerModeMock = (() => false) as any;
    loginMocks.validateApiUrlMock;
    loginMocks.validateApiUrlMock = (() => ({ valid: true })) as any;
    loginMocks.getConfigMock;
    loginMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    loginMocks.getLoginTimeoutMsMock;
    loginMocks.getLoginTimeoutMsMock = (() => 5 * 60 * 1000) as any;
    loginMocks.openMock;
    loginMocks.openMock = (async () => undefined) as any;
    loginMocks.createServerMock;
    loginMocks.resetRequestHandler();
  try {
  const logSpy = stub(console, 'log');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);
    const handledParsePromise = parsePromise.catch((error) => error);

    await Promise.resolve();

    const authUrlLine = logSpy.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Auth URL:'));
    assert(authUrlLine !== undefined);
    const authUrl = new URL(authUrlLine!.split('Auth URL: ')[1]);
    const state = authUrl.searchParams.get('state');
    assert(state);

    const callbackHandler = loginMocks.getRequestHandler();
    assert(callbackHandler !== undefined);

    const maliciousError = '<img src=x onerror=alert(1)>';
    const req = createJsonCallbackRequest({
      state,
      error: maliciousError,
    });
    const res = {
      writeHead: ((..._args: any[]) => undefined) as any,
      end: ((..._args: any[]) => undefined) as any,
    } as any;

    await callbackHandler!(req, res);
    await assert((await handledParsePromise) instanceof CliCommandExit);

    const html = String(res.end.calls[0]?.[0] ?? '');
    assertStringIncludes(html, '&lt;img src=x onerror=alert(1)&gt;');
    assert(!(html).includes(maliciousError));

    const authFailureLine = logSpy.calls
      .map((args) => args.map((arg) => String(arg)).join(' '))
      .find((line) => line.includes('Authentication failed:'));
    assert(authFailureLine !== undefined);
    assertStringIncludes(authFailureLine, '&lt;img src=x onerror=alert(1)&gt;');
    assert(!(authFailureLine).includes(maliciousError));
    assertSpyCalls(loginMocks.saveTokenMock, 0);

    logSpy.restore();
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('login command - uses shared login timeout configuration', async () => {
  new FakeTime();
    loginMocks.saveTokenMock;
    loginMocks.saveApiUrlMock;
    loginMocks.clearCredentialsMock;
    loginMocks.isContainerModeMock;
    loginMocks.isContainerModeMock = (() => false) as any;
    loginMocks.validateApiUrlMock;
    loginMocks.validateApiUrlMock = (() => ({ valid: true })) as any;
    loginMocks.getConfigMock;
    loginMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    loginMocks.getLoginTimeoutMsMock;
    loginMocks.getLoginTimeoutMsMock = (() => 5 * 60 * 1000) as any;
    loginMocks.openMock;
    loginMocks.openMock = (async () => undefined) as any;
    loginMocks.createServerMock;
    loginMocks.resetRequestHandler();
  try {
  loginMocks.getLoginTimeoutMsMock = (() => 123_456) as any;
    const setTimeoutSpy = stub(globalThis, 'setTimeout');

    const program = new Command();
    registerLoginCommand(program);
    const parsePromise = program.parseAsync(['node', 'takos', 'login']);
    const handledParsePromise = parsePromise.catch((error) => error);

    assertEquals(setTimeoutSpy.calls.some((call) => call[1] === 123_456), true);
    await await fakeTime.tickAsync(123_456);
    await assert((await handledParsePromise) instanceof CliCommandExit);
    assertSpyCalls(loginMocks.saveTokenMock, 0);
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})