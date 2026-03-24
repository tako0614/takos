import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '@/types';
import { callRuntime } from '@/services/execution/runtime';

describe('callRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when RUNTIME_HOST binding is missing', async () => {
    await expect(
      callRuntime({} as Env, '/exec', {}, 1000)
    ).rejects.toThrow('RUNTIME_HOST binding is required');
  });

  it('sets X-Takos-Internal header instead of JWT', async () => {
    const runtimeFetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const env = {
      RUNTIME_HOST: { fetch: runtimeFetchMock },
    } as unknown as Env;

    await callRuntime(env, '/exec', { foo: 'bar' }, 1000);

    expect(runtimeFetchMock).toHaveBeenCalledTimes(1);
    const request = runtimeFetchMock.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://runtime-host/exec');
    expect(request.headers.get('X-Takos-Internal')).toBe('1');
    expect(request.headers.get('Authorization')).toBeNull();
  });

  it('passes space_id as X-Takos-Space-Id header', async () => {
    const runtimeFetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const env = {
      RUNTIME_HOST: { fetch: runtimeFetchMock },
    } as unknown as Env;

    await callRuntime(env, '/exec', { space_id: 'space-123', foo: 'bar' }, 1000);

    expect(runtimeFetchMock).toHaveBeenCalledTimes(1);
    const request = runtimeFetchMock.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('X-Takos-Space-Id')).toBe('space-123');
  });
});
