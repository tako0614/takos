import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';

const billingServiceMocks = ({
  checkBillingQuota: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/billing/billing'
import { billingGate } from '@/middleware/billing';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User 1',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-02-11T00:00:00.000Z',
    updated_at: '2026-02-11T00:00:00.000Z',
  };
}


  Deno.test('billingGate - fails closed with 503 when quota check throws', async () => {
  billingServiceMocks.checkBillingQuota = (async () => { throw new Error('db unavailable'); }) as any;

    const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
    app.use('/metered', async (c, next) => {
      c.set('user', createUser());
      await next();
    });
    app.use('/metered', billingGate('llm_tokens_input', 1));
    app.post('/metered', (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request('http://localhost/metered', { method: 'POST' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(res.status, 503);
    await assertEquals(await res.json(), {
      error: 'Billing unavailable',
      code: 'SERVICE_UNAVAILABLE',
    });
})