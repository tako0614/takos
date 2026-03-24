import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  listWorkspacesForUser: vi.fn(),
  getOrCreatePersonalWorkspace: vi.fn(),
  createWorkspaceWithDefaultRepo: vi.fn(),
  createWorkspaceMember: vi.fn(),
  deleteWorkspace: vi.fn(),
  getUserByEmail: vi.fn(),
  getWorkspaceMember: vi.fn(),
  getWorkspaceModelSettings: vi.fn(),
  getWorkspaceWithRepository: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  updateWorkspace: vi.fn(),
  updateWorkspaceModel: vi.fn(),
}));

vi.mock('@/services/identity/spaces', () => ({
  listWorkspacesForUser: mocks.listWorkspacesForUser,
  getOrCreatePersonalWorkspace: mocks.getOrCreatePersonalWorkspace,
  createWorkspaceWithDefaultRepo: mocks.createWorkspaceWithDefaultRepo,
  createWorkspaceMember: mocks.createWorkspaceMember,
  deleteWorkspace: mocks.deleteWorkspace,
  getUserByEmail: mocks.getUserByEmail,
  getWorkspaceMember: mocks.getWorkspaceMember,
  getWorkspaceModelSettings: mocks.getWorkspaceModelSettings,
  getWorkspaceWithRepository: mocks.getWorkspaceWithRepository,
  listWorkspaceMembers: mocks.listWorkspaceMembers,
  updateWorkspace: mocks.updateWorkspace,
  updateWorkspaceModel: mocks.updateWorkspaceModel,
}));

import spacesRoutes from '@/routes/workspaces/base';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/spaces', spacesRoutes);
  return app;
}

describe('spaces route surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspacesForUser.mockResolvedValue([{
      id: 'ws-1',
      kind: 'user',
      name: 'Personal',
      slug: 'personal',
      owner_principal_id: 'user-1',
      security_posture: 'standard',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      member_role: 'owner',
      repository: {
        id: 'repo-1',
        name: 'main',
        default_branch: 'main',
      },
    }]);
  });

  it('returns spaces key on /api/spaces', async () => {
    const response = await createApp(createUser()).fetch(
      new Request('http://localhost/api/spaces'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spaces: [{
        id: 'ws-1',
        slug: 'personal',
        name: 'Personal',
        description: null,
        kind: 'user',
        owner_principal_id: 'user-1',
        automation_principal_id: null,
        security_posture: 'standard',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }],
    });
  });

  it('does not expose a legacy workspaces key', async () => {
    const response = await createApp(createUser()).fetch(
      new Request('http://localhost/api/spaces'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toHaveProperty('spaces');
    expect(payload).not.toHaveProperty('workspaces');
  });
});
