import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveActorPrincipalId: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/identity/principals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/identity/principals')>()),
  resolveActorPrincipalId: mocks.resolveActorPrincipalId,
}));

import { resolveAllowedCapabilities } from '@/services/platform/capabilities';

function createDrizzleMock() {
  const getMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: getMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock },
  };
}

describe('capabilities service', () => {
  it('derives restricted egress posture from the workspace record', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);
    mocks.resolveActorPrincipalId.mockResolvedValue('principal-1');

    drizzle._.get
      .mockResolvedValueOnce({ ownerAccountId: 'owner-2' })
      .mockResolvedValueOnce({ role: 'editor' })
      .mockResolvedValueOnce({ securityPosture: 'restricted_egress' });

    const result = await resolveAllowedCapabilities({
      db: {} as D1Database,
      spaceId: 'ws-1',
      userId: 'user-1',
    });

    expect(result.ctx.role).toBe('editor');
    expect(result.ctx.securityPosture).toBe('restricted_egress');
    expect(result.allowed.has('egress.http')).toBe(false);
  });

  it('applies an admin floor when requested for agent execution', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);
    mocks.resolveActorPrincipalId.mockResolvedValue('principal-1');

    drizzle._.get
      .mockResolvedValueOnce({ ownerAccountId: 'owner-2' })
      .mockResolvedValueOnce({ role: 'viewer' })
      .mockResolvedValueOnce({ securityPosture: 'standard' });

    const result = await resolveAllowedCapabilities({
      db: {} as D1Database,
      spaceId: 'ws-1',
      userId: 'user-1',
      minimumRole: 'admin',
    });

    expect(result.ctx.role).toBe('admin');
    expect(result.allowed.has('repo.write')).toBe(true);
    expect(result.allowed.has('storage.write')).toBe(true);
    expect(result.allowed.has('egress.http')).toBe(true);
  });

  it('preserves owner when the resolved role exceeds the admin floor', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);
    mocks.resolveActorPrincipalId.mockResolvedValue('principal-owner');

    drizzle._.get
      .mockResolvedValueOnce({ ownerAccountId: 'principal-owner' })
      .mockResolvedValueOnce({ securityPosture: 'standard' });

    const result = await resolveAllowedCapabilities({
      db: {} as D1Database,
      spaceId: 'ws-1',
      userId: 'user-owner',
      minimumRole: 'admin',
    });

    expect(result.ctx.role).toBe('owner');
  });
});
