import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MockDurableObjectNamespace } from '../../../../test/integration/setup';
import type { Env } from '@/types';

import { emitRunUsageEvent } from '@/services/offload/usage-client';

describe('emitRunUsageEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when TAKOS_OFFLOAD is not configured', async () => {
    const env = { TAKOS_OFFLOAD: undefined } as unknown as Env;
    // Should not throw
    await emitRunUsageEvent(env, { runId: 'r1', meterType: 'llm_tokens_input', units: 10 });
  });

  it('is a no-op when RUN_NOTIFIER namespace is not configured', async () => {
    const env = {
      TAKOS_OFFLOAD: {} as unknown,
      RUN_NOTIFIER: undefined,
    } as unknown as Env;

    await emitRunUsageEvent(env, { runId: 'r1', meterType: 'llm_tokens_input', units: 10 });
  });

  it('is a no-op when runId is empty', async () => {
    const ns = new MockDurableObjectNamespace();
    const fetchSpy = vi.spyOn(ns.getByName('any'), 'fetch');

    const env = {
      TAKOS_OFFLOAD: {} as unknown,
      RUN_NOTIFIER: ns,
    } as unknown as Env;

    await emitRunUsageEvent(env, { runId: '', meterType: 'exec_seconds', units: 5 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a POST /usage request to the durable object stub', async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
    const fakeId = { toString: () => 'fake-id' };
    const ns = {
      idFromName: vi.fn().mockReturnValue(fakeId),
      get: vi.fn().mockReturnValue({ fetch: stubFetch }),
    };

    const env = {
      TAKOS_OFFLOAD: {} as unknown,
      RUN_NOTIFIER: ns,
    } as unknown as Env;

    await emitRunUsageEvent(env, {
      runId: 'run-123',
      meterType: 'llm_tokens_input',
      units: 1000,
      referenceType: 'completion',
      metadata: { model: 'gpt-4' },
    });

    expect(ns.idFromName).toHaveBeenCalledWith('run-123');
    expect(ns.get).toHaveBeenCalledWith(fakeId);
    expect(stubFetch).toHaveBeenCalledTimes(1);

    const req = stubFetch.mock.calls[0][0] as Request;
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/usage');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(req.headers.get('X-Takos-Internal')).toBe('1');

    const body = await req.json() as Record<string, unknown>;
    expect(body.runId).toBe('run-123');
    expect(body.meter_type).toBe('llm_tokens_input');
    expect(body.units).toBe(1000);
    expect(body.reference_type).toBe('completion');
    expect(body.metadata).toEqual({ model: 'gpt-4' });
  });

  it('sends optional fields as undefined when not provided', async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
    const fakeId = { toString: () => 'id' };
    const ns = {
      idFromName: vi.fn().mockReturnValue(fakeId),
      get: vi.fn().mockReturnValue({ fetch: stubFetch }),
    };

    const env = {
      TAKOS_OFFLOAD: {} as unknown,
      RUN_NOTIFIER: ns,
    } as unknown as Env;

    await emitRunUsageEvent(env, {
      runId: 'run-456',
      meterType: 'exec_seconds',
      units: 30,
    });

    const req = stubFetch.mock.calls[0][0] as Request;
    const body = await req.json() as Record<string, unknown>;
    expect(body.reference_type).toBeUndefined();
    expect(body.metadata).toBeUndefined();
  });
});
