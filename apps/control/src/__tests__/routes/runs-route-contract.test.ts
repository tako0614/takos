import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';
import runsRouter from '@/routes/runs/routes';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('runs route contract - does not mount /runs/:id/emit', async () => {
  const response = await runsRouter.fetch(
      new Request('http://localhost/runs/run-1/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'progress', data: {} }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
})