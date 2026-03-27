import { describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import { getPersonalWorkspace } from '@/services/identity/spaces';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

describe('personal space (user account as workspace)', () => {
  it('returns the user account itself as the personal workspace with kind=user', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    // Call sequence:
    // 1. getPersonalWorkspace: select().from(accounts).where(id=userId, type='user').limit(1).get() -> user account
    // 2. ensureSelfMembership: resolveUserPrincipalId -> select().from(accounts).where(id).get() -> {id: 'user-1'}
    // 3. ensureSelfMembership: select({id}).from(accountMemberships).where(...).limit(1).get() -> existing membership
    // 4. findLatestRepositoryBySpaceId: select().from(repositories).where(...).orderBy(...).limit(1).get() -> null
    drizzle._.get
      .mockResolvedValueOnce({ id: 'user-1', type: 'user', name: 'User One', slug: 'user1', headSnapshotId: null, createdAt: '2026-03-01', updatedAt: '2026-03-01' }) // user account
      .mockResolvedValueOnce({ id: 'user-1' }) // resolveUserPrincipalId
      .mockResolvedValueOnce({ id: 'membership-1' }) // existing self-membership
      .mockResolvedValueOnce(undefined); // no repo

    const result = await getPersonalWorkspace({ DB: {} } as unknown as Env, 'user-1');

    expect(result).toMatchObject({
      id: 'user-1',
      kind: 'user',
      owner_principal_id: 'user-1',
    });
  });
});
