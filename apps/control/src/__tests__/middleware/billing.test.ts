import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const billingServiceMocks = vi.hoisted(() => ({
  checkBillingQuota: vi.fn(),
}));

vi.mock('@/services/billing/billing', () => ({
  checkBillingQuota: billingServiceMocks.checkBillingQuota,
}));

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

describe('billingGate', () => {
  it('fails closed with 503 when quota check throws', async () => {
    billingServiceMocks.checkBillingQuota.mockRejectedValue(new Error('db unavailable'));

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

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'Billing unavailable',
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
