import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  createSkill: vi.fn(),
  deleteSkillByName: vi.fn(),
  formatSkill: vi.fn((s: any) => s),
  getSkill: vi.fn(),
  getOfficialSkillCatalogEntry: vi.fn(),
  getSkillByName: vi.fn(),
  listOfficialSkillsCatalog: vi.fn(),
  listSkillContext: vi.fn(),
  listSkills: vi.fn(),
  SkillMetadataValidationError: class extends Error {
    details: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.details = details;
    }
  },
  updateSkill: vi.fn(),
  updateSkillEnabled: vi.fn(),
  updateSkillByName: vi.fn(),
  updateSkillEnabledByName: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  getDb: vi.fn(),
  getWorkspaceOperationPolicy: vi.fn(),
}));

vi.mock('@/services/source/skills', () => ({
  createSkill: mocks.createSkill,
  deleteSkillByName: mocks.deleteSkillByName,
  formatSkill: mocks.formatSkill,
  getSkill: mocks.getSkill,
  getOfficialSkillCatalogEntry: mocks.getOfficialSkillCatalogEntry,
  getSkillByName: mocks.getSkillByName,
  listOfficialSkillsCatalog: mocks.listOfficialSkillsCatalog,
  listSkillContext: mocks.listSkillContext,
  listSkills: mocks.listSkills,
  SkillMetadataValidationError: mocks.SkillMetadataValidationError,
  updateSkill: mocks.updateSkill,
  updateSkillEnabled: mocks.updateSkillEnabled,
  updateSkillByName: mocks.updateSkillByName,
  updateSkillEnabledByName: mocks.updateSkillEnabledByName,
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireWorkspaceAccess: mocks.requireWorkspaceAccess,
  };
});

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/tools/tool-policy', () => ({
  getWorkspaceOperationPolicy: () => ({
    allowed_roles: ['owner', 'admin', 'editor', 'viewer'],
  }),
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual };
});

vi.mock('@/db/schema', () => ({
  skills: { id: 'id', accountId: 'accountId', name: 'name' },
}));

import skillsRoute from '@/routes/skills';

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
  app.route('/api', skillsRoute);
  return app;
}

describe('skills routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceAccess.mockResolvedValue({ workspace: { id: 'ws-1' } });
  });

  describe('GET /api/spaces/:spaceId/skills', () => {
    it('returns skills list', async () => {
      const skillsList = [{ id: 'sk-1', name: 'test-skill' }];
      mocks.listSkills.mockResolvedValue(skillsList);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ skills: skillsList });
    });

    it('returns 404 when workspace access denied', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 }),
      );

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-bad/skills'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/spaces/:spaceId/skills', () => {
    it('creates a skill and returns 201', async () => {
      const dbChain: any = {
        select: vi.fn(() => dbChain),
        from: vi.fn(() => dbChain),
        where: vi.fn(() => dbChain),
        get: vi.fn().mockResolvedValue(undefined), // no existing skill
      };
      mocks.getDb.mockReturnValue(dbChain);
      mocks.createSkill.mockResolvedValue({ id: 'sk-new', name: 'new-skill' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'new-skill',
            instructions: 'Do something',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
    });

    it('rejects skill with missing name', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instructions: 'Do something',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });

    it('rejects skill with missing instructions', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'my-skill',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });

    it('returns 409 when skill name already exists', async () => {
      const dbChain: any = {
        select: vi.fn(() => dbChain),
        from: vi.fn(() => dbChain),
        where: vi.fn(() => dbChain),
        get: vi.fn().mockResolvedValue({ id: 'sk-existing' }),
      };
      mocks.getDb.mockReturnValue(dbChain);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'existing-skill',
            instructions: 'Do something',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/spaces/:spaceId/skills/:skillName', () => {
    it('returns skill by name', async () => {
      mocks.getSkillByName.mockResolvedValue({ id: 'sk-1', name: 'test-skill' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/test-skill'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('skill');
    });

    it('returns 404 when skill not found', async () => {
      mocks.getSkillByName.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/missing-skill'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/spaces/:spaceId/skills/:skillName', () => {
    it('deletes a skill', async () => {
      mocks.getSkillByName.mockResolvedValue({ id: 'sk-1', name: 'old-skill' });
      mocks.deleteSkillByName.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/old-skill', {
          method: 'DELETE',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true });
    });

    it('returns 404 when skill not found', async () => {
      mocks.getSkillByName.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/missing', {
          method: 'DELETE',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/spaces/:spaceId/skills-context', () => {
    it('returns skill context catalog', async () => {
      mocks.listSkillContext.mockResolvedValue({
        locale: 'en',
        available_skills: [{ name: 'test-skill' }],
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills-context'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('locale');
      expect(json).toHaveProperty('available_skills');
      expect(json).toHaveProperty('count', 1);
    });
  });

  describe('PUT /api/spaces/:spaceId/skills/:skillName', () => {
    it('updates a skill by name', async () => {
      const dbChain: any = {
        select: vi.fn(() => dbChain),
        from: vi.fn(() => dbChain),
        where: vi.fn(() => dbChain),
        get: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getDb.mockReturnValue(dbChain);
      mocks.getSkillByName.mockResolvedValue({ id: 'sk-1', name: 'old-skill' });
      mocks.updateSkillByName.mockResolvedValue({ id: 'sk-1', name: 'updated-skill', instructions: 'Updated' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/old-skill', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'updated-skill', instructions: 'Updated' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('skill');
    });

    it('returns 404 when skill not found', async () => {
      mocks.getSkillByName.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/missing', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: 'Updated' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 409 when renaming to an existing name', async () => {
      mocks.getSkillByName.mockResolvedValue({ id: 'sk-1', name: 'old-skill' });
      const dbChain: any = {
        select: vi.fn(() => dbChain),
        from: vi.fn(() => dbChain),
        where: vi.fn(() => dbChain),
        get: vi.fn().mockResolvedValue({ id: 'sk-other' }),
      };
      mocks.getDb.mockReturnValue(dbChain);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/old-skill', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'taken-name' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /api/spaces/:spaceId/skills/:skillName', () => {
    it('toggles skill enabled by name', async () => {
      mocks.getSkillByName.mockResolvedValue({ id: 'sk-1', name: 'test-skill', enabled: true });
      mocks.updateSkillEnabledByName.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/test-skill', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toEqual({ success: true, enabled: false });
    });

    it('returns 404 when skill not found', async () => {
      mocks.getSkillByName.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/missing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('keeps current enabled state when body omits enabled', async () => {
      mocks.getSkillByName.mockResolvedValue({ id: 'sk-1', name: 'test-skill', enabled: true });
      mocks.updateSkillEnabledByName.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/test-skill', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toEqual({ success: true, enabled: true });
    });
  });

  describe('GET /api/spaces/:spaceId/skills/id/:skillId', () => {
    it('returns skill by id', async () => {
      mocks.getSkill.mockResolvedValue({ id: 'sk-1', name: 'test-skill' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('skill');
    });

    it('returns 404 when skill id not found', async () => {
      mocks.getSkill.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-missing'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/spaces/:spaceId/skills/id/:skillId', () => {
    it('updates a skill by id', async () => {
      mocks.getSkill.mockResolvedValue({ id: 'sk-1', name: 'old-skill' });
      mocks.updateSkill.mockResolvedValue({ id: 'sk-1', name: 'updated-skill' });
      const dbChain: any = {
        select: vi.fn(() => dbChain),
        from: vi.fn(() => dbChain),
        where: vi.fn(() => dbChain),
        get: vi.fn().mockResolvedValue(undefined),
      };
      mocks.getDb.mockReturnValue(dbChain);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'updated-skill' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('skill');
    });

    it('returns 404 when skill id not found', async () => {
      mocks.getSkill.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-missing', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: 'Updated' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/spaces/:spaceId/skills/id/:skillId', () => {
    it('toggles skill enabled by id', async () => {
      mocks.getSkill.mockResolvedValue({ id: 'sk-1', name: 'test-skill', enabled: false });
      mocks.updateSkillEnabled.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toEqual({ success: true, enabled: true });
    });

    it('returns 404 when skill id not found', async () => {
      mocks.getSkill.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-missing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/spaces/:spaceId/skills/id/:skillId', () => {
    it('deletes a skill by id', async () => {
      mocks.getSkill.mockResolvedValue({ id: 'sk-1', name: 'old-skill' });
      mocks.deleteSkillByName.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-1', {
          method: 'DELETE',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true });
    });

    it('returns 404 when skill id not found', async () => {
      mocks.getSkill.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/skills/id/sk-missing', {
          method: 'DELETE',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/spaces/:spaceId/official-skills', () => {
    it('returns official skills catalog', async () => {
      mocks.listOfficialSkillsCatalog.mockResolvedValue({
        skills: [{ id: 'os-1', name: 'Official Skill' }],
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/official-skills'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });
});
