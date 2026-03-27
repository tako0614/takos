import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import { getWorkspaceModelSettings, listWorkspacesForUser } from '@/services/identity/spaces';

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

describe('spaces service queries', () => {
  it('lists spaces for a human principal from the canonical tables', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    // Call sequence:
    // 1. resolveUserPrincipalId: select({id}).from(accounts).where().get() -> {id: 'user-1'}
    // 2. listWorkspacesForUser main query: select({...}).from(accountMemberships).innerJoin().where().orderBy().all() -> memberships
    // 3. findLatestRepositoryBySpaceId: select({...}).from(repositories).where().orderBy().limit().get() -> repo
    drizzle._.get
      .mockResolvedValueOnce({ id: 'user-1' }) // resolveUserPrincipalId
      .mockResolvedValueOnce({ id: 'repo-1', name: 'main', default_branch: 'main' }); // findLatestRepositoryBySpaceId

    drizzle._.all.mockResolvedValueOnce([
      {
        memberRole: 'owner',
        spaceId: 'ws-1',
        spaceType: 'user',
        spaceName: 'User One',
        spaceSlug: 'user1',
        spaceOwnerAccountId: 'user-1',
        spaceHeadSnapshotId: null,
        spaceSecurityPosture: 'restricted_egress',
        spaceCreatedAt: '2026-02-13T00:00:00.000Z',
        spaceUpdatedAt: '2026-02-13T00:00:00.000Z',
      },
    ]);

    const result = await listWorkspacesForUser({ DB: {} as D1Database } as unknown as Env, 'user-1');

    expect(result).toEqual([{
      id: 'ws-1',
      kind: 'user',
      name: 'User One',
      slug: 'user1',
      owner_principal_id: 'user-1',
      automation_principal_id: null,
      head_snapshot_id: null,
      security_posture: 'restricted_egress',
      created_at: '2026-02-13T00:00:00.000Z',
      updated_at: '2026-02-13T00:00:00.000Z',
      member_role: 'owner',
      repository: {
        id: 'repo-1',
        name: 'main',
        default_branch: 'main',
      },
    }]);
    expect(drizzle.select).toHaveBeenCalled();
  });

  it('reads model settings from spaces', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    drizzle._.get.mockResolvedValueOnce({
      ai_model: 'gpt-5.4-nano',
      ai_provider: 'openai',
      security_posture: 'standard',
    });

    const result = await getWorkspaceModelSettings({} as D1Database, 'ws-1');

    expect(result).toEqual({
      ai_model: 'gpt-5.4-nano',
      ai_provider: 'openai',
      security_posture: 'standard',
    });
    expect(drizzle.select).toHaveBeenCalled();
  });
});
