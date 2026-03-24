import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ControlRpcClient,
  createStaticControlRpcTokenSource,
  isControlRpcPath,
  getRequiredControlRpcCapability,
} from '../control-rpc.js';

// ---------------------------------------------------------------------------
// createStaticControlRpcTokenSource
// ---------------------------------------------------------------------------

describe('createStaticControlRpcTokenSource', () => {
  it('returns the same token for any path', () => {
    const source = createStaticControlRpcTokenSource('my-token');
    expect(source.tokenForPath('/rpc/control/heartbeat')).toBe('my-token');
    expect(source.tokenForPath('/rpc/control/run-status')).toBe('my-token');
    expect(source.tokenForPath('/anything')).toBe('my-token');
  });
});

// ---------------------------------------------------------------------------
// isControlRpcPath
// ---------------------------------------------------------------------------

describe('isControlRpcPath', () => {
  const validPaths = [
    '/rpc/control/heartbeat',
    '/rpc/control/run-status',
    '/rpc/control/run-record',
    '/rpc/control/run-bootstrap',
    '/rpc/control/run-fail',
    '/rpc/control/run-reset',
    '/rpc/control/api-keys',
    '/rpc/control/billing-run-usage',
    '/rpc/control/run-context',
    '/rpc/control/no-llm-complete',
    '/rpc/control/conversation-history',
    '/rpc/control/skill-plan',
    '/rpc/control/memory-activation',
    '/rpc/control/memory-finalize',
    '/rpc/control/add-message',
    '/rpc/control/update-run-status',
    '/rpc/control/current-session',
    '/rpc/control/is-cancelled',
    '/rpc/control/tool-catalog',
    '/rpc/control/tool-execute',
    '/rpc/control/tool-cleanup',
    '/rpc/control/run-event',
  ];

  for (const path of validPaths) {
    it(`recognizes ${path}`, () => {
      expect(isControlRpcPath(path)).toBe(true);
    });
  }

  it('rejects unknown paths', () => {
    expect(isControlRpcPath('/rpc/control/unknown')).toBe(false);
    expect(isControlRpcPath('/health')).toBe(false);
    expect(isControlRpcPath('')).toBe(false);
    expect(isControlRpcPath('/rpc/control/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRequiredControlRpcCapability
// ---------------------------------------------------------------------------

describe('getRequiredControlRpcCapability', () => {
  it('returns "control" for valid RPC paths', () => {
    expect(getRequiredControlRpcCapability('/rpc/control/heartbeat')).toBe('control');
    expect(getRequiredControlRpcCapability('/rpc/control/run-event')).toBe('control');
  });

  it('returns null for non-RPC paths', () => {
    expect(getRequiredControlRpcCapability('/health')).toBeNull();
    expect(getRequiredControlRpcCapability('/unknown')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ControlRpcClient constructor
// ---------------------------------------------------------------------------

describe('ControlRpcClient', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createClient(baseUrl = 'https://control.example.com', runId = 'run-1') {
    return new ControlRpcClient(
      baseUrl,
      runId,
      createStaticControlRpcTokenSource('test-token'),
    );
  }

  it('strips trailing slash from baseUrl', async () => {
    const client = createClient('https://control.example.com/');
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running' }), { status: 200 }));

    await client.getRunStatus('run-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl).toBe('https://control.example.com/rpc/control/run-status');
  });

  it('sends correct authorization headers', async () => {
    const client = createClient();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running' }), { status: 200 }));

    await client.getRunStatus('run-1');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'X-Takos-Run-Id': 'run-1',
      'Content-Type': 'application/json',
    });
  });

  it('sends POST with JSON body', async () => {
    const client = createClient();
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running' }), { status: 200 }));

    await client.getRunStatus('run-42');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ runId: 'run-42' });
  });

  describe('getRunStatus', () => {
    it('returns the status from the response', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running' }), { status: 200 }));

      const status = await client.getRunStatus('run-1');
      expect(status).toBe('running');
    });

    it('returns null when status is not present', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      const status = await client.getRunStatus('run-1');
      expect(status).toBeNull();
    });
  });

  describe('heartbeat', () => {
    it('posts heartbeat payload', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      await client.heartbeat({ runId: 'run-1', workerId: 'w-1', leaseVersion: 2 });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ runId: 'run-1', serviceId: 'w-1', workerId: 'w-1', leaseVersion: 2 });
    });
  });

  describe('failRun', () => {
    it('posts fail payload', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      await client.failRun({ runId: 'run-1', workerId: 'w-1', error: 'oops' });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/rpc/control/run-fail');
    });
  });

  describe('resetRun', () => {
    it('posts reset payload', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      await client.resetRun({ runId: 'run-1', workerId: 'w-1' });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/rpc/control/run-reset');
    });
  });

  describe('fetchApiKeys', () => {
    it('returns available keys', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ openai: 'sk-abc', anthropic: null, google: 'gcp-123' }),
        { status: 200 },
      ));

      const keys = await client.fetchApiKeys();
      expect(keys.openai).toBe('sk-abc');
      expect(keys.anthropic).toBeUndefined();
      expect(keys.google).toBe('gcp-123');
    });

    it('returns undefined for null keys', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ openai: null, anthropic: null, google: null }),
        { status: 200 },
      ));

      const keys = await client.fetchApiKeys();
      expect(keys.openai).toBeUndefined();
      expect(keys.anthropic).toBeUndefined();
      expect(keys.google).toBeUndefined();
    });
  });

  describe('getConversationHistory', () => {
    it('returns history array', async () => {
      const client = createClient();
      const messages = [{ role: 'user', content: 'Hello' }];
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ history: messages }),
        { status: 200 },
      ));

      const result = await client.getConversationHistory({
        runId: 'r', threadId: 't', spaceId: 's', aiModel: 'gpt-4',
      });
      expect(result).toEqual(messages);
    });

    it('returns empty array when history is not an array', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ history: 'not-an-array' }),
        { status: 200 },
      ));

      const result = await client.getConversationHistory({
        runId: 'r', threadId: 't', spaceId: 's', aiModel: 'gpt-4',
      });
      expect(result).toEqual([]);
    });
  });

  describe('isCancelled', () => {
    it('returns true when cancelled', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ cancelled: true }),
        { status: 200 },
      ));

      expect(await client.isCancelled('run-1')).toBe(true);
    });

    it('returns false when not cancelled', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ cancelled: false }),
        { status: 200 },
      ));

      expect(await client.isCancelled('run-1')).toBe(false);
    });

    it('returns false for non-boolean values', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ cancelled: 'yes' }),
        { status: 200 },
      ));

      expect(await client.isCancelled('run-1')).toBe(false);
    });
  });

  describe('getCurrentSessionId', () => {
    it('returns sessionId when present', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({ sessionId: 'sess-1' }),
        { status: 200 },
      ));

      expect(await client.getCurrentSessionId({ runId: 'r', spaceId: 's' })).toBe('sess-1');
    });

    it('returns null when sessionId is absent', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(
        JSON.stringify({}),
        { status: 200 },
      ));

      expect(await client.getCurrentSessionId({ runId: 'r', spaceId: 's' })).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

      await expect(client.getRunStatus('run-1')).rejects.toThrow('Control RPC /rpc/control/run-status failed with 500');
    });

    it('throws on malformed JSON response', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response('not-json', { status: 200 }));

      await expect(client.getRunStatus('run-1')).rejects.toThrow('malformed JSON');
    });
  });

  describe('executeTool', () => {
    it('sends tool execution request', async () => {
      const client = createClient();
      const toolResult = { tool_call_id: 'tc-1', output: 'result' };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(toolResult), { status: 200 }));

      const result = await client.executeTool({
        runId: 'run-1',
        toolCall: { id: 'tc-1', name: 'read_file', arguments: { path: '/foo' } },
      });

      expect(result).toEqual(toolResult);
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/rpc/control/tool-execute');
    });
  });

  describe('emitRunEvent', () => {
    it('sends run event', async () => {
      const client = createClient();
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      await client.emitRunEvent({
        runId: 'run-1',
        type: 'started',
        data: { model: 'gpt-4' },
        sequence: 1,
      });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/rpc/control/run-event');
    });
  });
});
