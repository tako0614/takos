import { describe, expect, it, vi } from 'vitest';
import {
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
} from '@/container-hosts/executor-dispatch';
import type {
  AgentExecutorDispatchPayload,
  AgentExecutorControlConfig,
  AgentExecutorDispatchTarget,
  AgentExecutorDispatchStub,
} from '@/container-hosts/executor-dispatch';

describe('dispatchAgentExecutorStart', () => {
  it('starts container, waits for ports, then dispatches start', async () => {
    const startAndWaitForPorts = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"status":"started"}', { status: 200 }));

    const target: AgentExecutorDispatchTarget = {
      startAndWaitForPorts,
      fetch: fetchFn,
    };

    const body: AgentExecutorDispatchPayload = {
      runId: 'run-1',
      workerId: 'worker-1',
      model: 'gpt-4',
    };

    const controlConfig: AgentExecutorControlConfig = {
      controlRpcBaseUrl: 'https://control.internal',
      controlRpcToken: 'token-abc',
    };

    const result = await dispatchAgentExecutorStart(target, body, controlConfig);

    expect(startAndWaitForPorts).toHaveBeenCalledWith(8080);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Verify the request sent to the container
    const requestArg = fetchFn.mock.calls[0][0] as Request;
    expect(requestArg.url).toBe('https://executor/start');
    expect(requestArg.method).toBe('POST');

    const sentBody = JSON.parse(await requestArg.text());
    expect(sentBody.runId).toBe('run-1');
    expect(sentBody.workerId).toBe('worker-1');
    expect(sentBody.model).toBe('gpt-4');
    expect(sentBody.controlRpcBaseUrl).toBe('https://control.internal');
    expect(sentBody.controlRpcToken).toBe('token-abc');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"status":"started"}');
  });

  it('returns error result when container returns non-ok response', async () => {
    const target: AgentExecutorDispatchTarget = {
      startAndWaitForPorts: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue(
        new Response('{"error":"failed to start"}', { status: 500 }),
      ),
    };

    const result = await dispatchAgentExecutorStart(
      target,
      { runId: 'run-1', workerId: 'worker-1' },
      { controlRpcToken: 'token' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.body).toContain('failed to start');
  });

  it('includes leaseVersion when provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const target: AgentExecutorDispatchTarget = {
      startAndWaitForPorts: vi.fn().mockResolvedValue(undefined),
      fetch: fetchFn,
    };

    await dispatchAgentExecutorStart(
      target,
      { runId: 'run-1', workerId: 'worker-1', leaseVersion: 3 },
      { controlRpcToken: 'token' },
    );

    const sentBody = JSON.parse(await (fetchFn.mock.calls[0][0] as Request).text());
    expect(sentBody.leaseVersion).toBe(3);
  });
});

describe('forwardAgentExecutorDispatch', () => {
  it('forwards dispatch and returns response', async () => {
    const stub: AgentExecutorDispatchStub = {
      dispatchStart: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: '{"dispatched":true}',
      }),
    };

    const response = await forwardAgentExecutorDispatch(stub, {
      runId: 'run-1',
      workerId: 'worker-1',
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('{"dispatched":true}');
  });

  it('returns 500 response when dispatch throws', async () => {
    const stub: AgentExecutorDispatchStub = {
      dispatchStart: vi.fn().mockRejectedValue(new Error('Container startup failed')),
    };

    const response = await forwardAgentExecutorDispatch(stub, {
      runId: 'run-1',
      workerId: 'worker-1',
    });

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Failed to start container');
    expect(body.error).toContain('Container startup failed');
  });

  it('handles non-Error throw values', async () => {
    const stub: AgentExecutorDispatchStub = {
      dispatchStart: vi.fn().mockRejectedValue('string error'),
    };

    const response = await forwardAgentExecutorDispatch(stub, {
      runId: 'run-1',
      workerId: 'worker-1',
    });

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('string error');
  });
});
