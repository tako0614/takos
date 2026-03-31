import type { Env } from '@/types';
import { callRuntime } from '@/services/execution/runtime';


import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

  Deno.test('callRuntime - throws when RUNTIME_HOST binding is missing', async () => {
  try {
  await await assertRejects(async () => { await 
      callRuntime({} as Env, '/exec', {}, 1000)
    ; }, 'RUNTIME_HOST binding is required');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
  Deno.test('callRuntime - sets X-Takos-Internal header instead of JWT', async () => {
  try {
  const runtimeFetchMock = (async () => new Response(null, { status: 200 }));

    const env = {
      RUNTIME_HOST: { fetch: runtimeFetchMock },
    } as unknown as Env;

    await callRuntime(env, '/exec', { foo: 'bar' }, 1000);

    assertSpyCalls(runtimeFetchMock, 1);
    const request = runtimeFetchMock.calls[0]?.[0] as Request;
    assertEquals(request.method, 'POST');
    assertEquals(request.url, 'https://runtime-host/exec');
    assertEquals(request.headers.get('X-Takos-Internal'), '1');
    assertEquals(request.headers.get('Authorization'), null);
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
  Deno.test('callRuntime - passes space_id as X-Takos-Space-Id header', async () => {
  try {
  const runtimeFetchMock = (async () => new Response(null, { status: 200 }));

    const env = {
      RUNTIME_HOST: { fetch: runtimeFetchMock },
    } as unknown as Env;

    await callRuntime(env, '/exec', { space_id: 'space-123', foo: 'bar' }, 1000);

    assertSpyCalls(runtimeFetchMock, 1);
    const request = runtimeFetchMock.calls[0]?.[0] as Request;
    assertEquals(request.headers.get('X-Takos-Space-Id'), 'space-123');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})