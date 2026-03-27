import { describe, expect, it, vi } from 'vitest';

import {
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
  type AgentExecutorControlConfig,
  type AgentExecutorDispatchStub,
  type AgentExecutorDispatchTarget,
} from '@/runtime/container-hosts/executor-dispatch';
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
  generateProxyToken,
} from '@/runtime/container-hosts/executor-proxy-config';

describe('dispatchAgentExecutorStart', () => {
  it('keeps only CONTROL_RPC_BASE_URL in container env vars', () => {
    expect(buildAgentExecutorContainerEnvVars({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    })).toEqual({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    });
  });

  it('allows an empty CONTROL_RPC_BASE_URL for adapter-owned resolution', () => {
    expect(buildAgentExecutorContainerEnvVars({
      CONTROL_RPC_BASE_URL: undefined,
    })).toEqual({
      CONTROL_RPC_BASE_URL: '',
    });
  });

  it('generates a random control RPC token (not JWT)', () => {
    const controlConfig = buildAgentExecutorProxyConfig({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    }, {
      runId: 'run-secret',
      serviceId: 'worker-secret',
    });

    expect(controlConfig.controlRpcToken).toBeTruthy();
    expect(controlConfig.controlRpcBaseUrl).toBe('https://control-rpc.example.internal');
    expect(controlConfig.controlRpcToken.length).toBeGreaterThan(20);
  });

  it('generateProxyToken returns base64url without padding', () => {
    const token = generateProxyToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(20);
  });

  it('forwards only canonical control RPC fields through the /start payload', async () => {
    const startAndWaitForPorts = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue(new Response('{"status":"accepted","runId":"run-secret"}', { status: 202 }));
    const controlConfig = buildAgentExecutorProxyConfig({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    }, {
      runId: 'run-secret',
      serviceId: 'worker-secret',
    });

    await dispatchAgentExecutorStart(
      { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
      {
        runId: 'run-secret',
        workerId: 'worker-secret',
      },
      controlConfig,
    );

    const request = fetch.mock.calls[0][0] as Request;
    const payload = await request.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      controlRpcBaseUrl: 'https://control-rpc.example.internal',
    });
    expect(payload.controlRpcToken).toBeTruthy();
  });

  it('waits for port 8080 and posts the start payload inside the container DO', async () => {
    const startAndWaitForPorts = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue(new Response('{"status":"accepted","runId":"run-1"}', { status: 202 }));
    const controlConfig: AgentExecutorControlConfig = {
      controlRpcBaseUrl: 'https://control-rpc.example.internal',
      controlRpcToken: 'control-rpc-token',
    };
    const payload = {
      runId: 'run-1',
      workerId: 'worker-1',
      model: 'gpt-5-mini',
    };

    const result = await dispatchAgentExecutorStart(
      { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
      payload,
      controlConfig,
    );

    expect(startAndWaitForPorts).toHaveBeenCalledWith(8080);
    expect(fetch).toHaveBeenCalledTimes(1);

    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://executor/start');
    expect(request.method).toBe('POST');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    await expect(request.json()).resolves.toEqual({
      ...payload,
      serviceId: 'worker-1',
      ...controlConfig,
    });

    expect(result).toEqual({
      ok: true,
      status: 202,
      body: '{"status":"accepted","runId":"run-1"}',
    });
  });

  it('preserves non-2xx start failures for host-side logging', async () => {
    const startAndWaitForPorts = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue(new Response('Proxy not configured', { status: 503 }));
    const controlConfig: AgentExecutorControlConfig = {
      controlRpcBaseUrl: 'https://control-rpc.example.internal',
      controlRpcToken: 'control-rpc-token',
    };
    const payload = {
      runId: 'run-2',
      workerId: 'worker-2',
    };

    const result = await dispatchAgentExecutorStart(
      { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
      payload,
      controlConfig,
    );

    expect(startAndWaitForPorts).toHaveBeenCalledWith(8080);
    expect(result).toEqual({
      ok: false,
      status: 503,
      body: 'Proxy not configured',
    });
  });

  it('returns the container acceptance response to the caller', async () => {
    const dispatchStart = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      body: '{"status":"accepted","runId":"run-3"}',
    });

    const response = await forwardAgentExecutorDispatch(
      { dispatchStart } as AgentExecutorDispatchStub,
      {
        runId: 'run-3',
        workerId: 'worker-3',
      },
    );

    expect(dispatchStart).toHaveBeenCalledWith({
      runId: 'run-3',
      workerId: 'worker-3',
    });
    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe('{"status":"accepted","runId":"run-3"}');
  });

  it('turns startup exceptions into dispatch failures so the runner can retry', async () => {
    const dispatchStart = vi.fn().mockRejectedValue(new Error('boom'));

    const response = await forwardAgentExecutorDispatch(
      { dispatchStart } as AgentExecutorDispatchStub,
      {
        runId: 'run-4',
        workerId: 'worker-4',
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to start container: boom',
    });
  });
});
