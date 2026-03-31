import { MockDurableObjectNamespace } from '../../../../test/integration/setup.ts';
import type { Env } from '@/types';

import { emitRunUsageEvent } from '@/services/offload/usage-client';


import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('emitRunUsageEvent - is a no-op when TAKOS_OFFLOAD is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = { TAKOS_OFFLOAD: undefined } as unknown as Env;
    // Should not throw
    await emitRunUsageEvent(env, { runId: 'r1', meterType: 'llm_tokens_input', units: 10 });
})
  Deno.test('emitRunUsageEvent - is a no-op when RUN_NOTIFIER namespace is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
      TAKOS_OFFLOAD: {} as unknown,
      RUN_NOTIFIER: undefined,
    } as unknown as Env;

    await emitRunUsageEvent(env, { runId: 'r1', meterType: 'llm_tokens_input', units: 10 });
})
  Deno.test('emitRunUsageEvent - is a no-op when runId is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const ns = new MockDurableObjectNamespace();
    const fetchSpy = stub(ns.getByName('any'), 'fetch');

    const env = {
      TAKOS_OFFLOAD: {} as unknown,
      RUN_NOTIFIER: ns,
    } as unknown as Env;

    await emitRunUsageEvent(env, { runId: '', meterType: 'exec_seconds', units: 5 });
    assertSpyCalls(fetchSpy, 0);
})
  Deno.test('emitRunUsageEvent - sends a POST /usage request to the durable object stub', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const stubFetch = (async () => new Response('ok'));
    const fakeId = { toString: () => 'fake-id' };
    const ns = {
      idFromName: (() => fakeId),
      get: (() => ({ fetch: stubFetch })),
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

    assertSpyCallArgs(ns.idFromName, 0, ['run-123']);
    assertSpyCallArgs(ns.get, 0, [fakeId]);
    assertSpyCalls(stubFetch, 1);

    const req = stubFetch.calls[0][0] as Request;
    assertEquals(req.method, 'POST');
    assertStringIncludes(req.url, '/usage');
    assertEquals(req.headers.get('Content-Type'), 'application/json');
    assertEquals(req.headers.get('X-Takos-Internal'), '1');

    const body = await req.json() as Record<string, unknown>;
    assertEquals(body.runId, 'run-123');
    assertEquals(body.meter_type, 'llm_tokens_input');
    assertEquals(body.units, 1000);
    assertEquals(body.reference_type, 'completion');
    assertEquals(body.metadata, { model: 'gpt-4' });
})
  Deno.test('emitRunUsageEvent - sends optional fields as undefined when not provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const stubFetch = (async () => new Response('ok'));
    const fakeId = { toString: () => 'id' };
    const ns = {
      idFromName: (() => fakeId),
      get: (() => ({ fetch: stubFetch })),
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

    const req = stubFetch.calls[0][0] as Request;
    const body = await req.json() as Record<string, unknown>;
    assertEquals(body.reference_type, undefined);
    assertEquals(body.metadata, undefined);
})