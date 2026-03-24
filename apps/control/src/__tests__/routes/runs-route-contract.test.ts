import { describe, expect, it } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';
import runsRouter from '@/routes/runs';

describe('runs route contract', () => {
  it('does not mount /runs/:id/emit', async () => {
    const response = await runsRouter.fetch(
      new Request('http://localhost/runs/run-1/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'progress', data: {} }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
  });
});
