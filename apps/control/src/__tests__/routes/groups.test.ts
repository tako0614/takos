import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';

vi.mock('takos-common/errors', () => ({
  BadRequestError: class BadRequestError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));

vi.mock('@/services/source/app-manifest-parser', () => ({
  parseAppManifestYaml: vi.fn(),
}));

vi.mock('@/services/deployment/group-managed-desired-state', () => ({
  syncGroupManagedDesiredState: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/routes/route-auth', () => ({
  spaceAccess: () => async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('access', { space: { id: 'ws1' } });
    await next();
  },
}));

import groupsRouter from '@/routes/groups';

describe('groups routes', () => {
  it('does not expose the legacy /entities inventory endpoints', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/', groupsRouter);

    const res = await app.request('/spaces/ws1/groups/group-1/entities', { method: 'GET' });

    expect(res.status).toBe(404);
  });
});
