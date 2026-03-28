import { Hono } from 'hono';
import { z } from 'zod';
import { requireSpaceAccess, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  createWorkspaceWithDefaultRepo,
  deleteWorkspace,
  getOrCreatePersonalWorkspace,
  getWorkspaceModelSettings,
  getWorkspaceWithRepository,
  listWorkspacesForUser,
  updateWorkspace,
  updateWorkspaceModel,
} from '../../../application/services/identity/spaces';
import {
  DEFAULT_MODEL_ID,
  getModelProvider,
  normalizeModelId,
  resolveHistoryTokenBudget,
  VALID_PROVIDERS,
  type ModelProvider,
} from '../../../application/services/agent';
import { getUISidebarItems } from '../../../application/services/platform/ui-extensions';
import { toWorkspaceResponse } from '../../../application/services/identity/response-formatters';
import { getDb } from '../../../infra/db';
import { eq, ne, and, or, desc, inArray } from 'drizzle-orm';
import { repositories, threads, resources, resourceAccess } from '../../../infra/db/schema';
import { BadRequestError, NotFoundError } from 'takos-common/errors';

const VALID_SECURITY_POSTURES = ['standard', 'restricted_egress'] as const;

function normalizeProviderInput(provider?: string | null): ModelProvider | null {
  if (!provider) return null;
  const normalized = provider.toLowerCase().trim() as ModelProvider;
  return VALID_PROVIDERS.includes(normalized) ? normalized : null;
}

export default new Hono<AuthenticatedRouteEnv>()
  .get('/', async (c) => {
    const user = c.get('user');

    let workspaces = await listWorkspacesForUser(c.env, user.id);

    if (!workspaces.some((workspace) => workspace.kind === 'user')) {
      const personalWorkspace = await getOrCreatePersonalWorkspace(c.env, user.id);
      if (personalWorkspace) {
        workspaces = [personalWorkspace, ...workspaces.filter((workspace) => workspace.id !== personalWorkspace.id)];
      }
    }

    return c.json({ spaces: workspaces.map(toWorkspaceResponse) });
  })
  .post('/',
    zValidator('json', z.object({ name: z.string(), id: z.string().optional(), description: z.string().optional() })),
    async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    if (!body.name || body.name.trim().length === 0) {
      throw new BadRequestError('Name is required');
    }

    try {
      const { workspace, repository } = await createWorkspaceWithDefaultRepo(
        c.env,
        user.id,
        body.name.trim(),
        { id: body.id }
      );

      return c.json({ space: toWorkspaceResponse(workspace), repository }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create space';
      throw new BadRequestError(message);
    }
  })
  .get('/me', async (c) => {
    const user = c.get('user');
    if (!await getOrCreatePersonalWorkspace(c.env, user.id)) {
      throw new NotFoundError('Personal space');
    }

    const access = await requireSpaceAccess(c, 'me', user.id);

    const { workspace, repository } = await getWorkspaceWithRepository(c.env, access.space);

    return c.json({
      space: toWorkspaceResponse(workspace),
      role: access.membership.role,
      repository,
    });
  })
  .get('/:spaceId', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const { workspace, repository } = await getWorkspaceWithRepository(
      c.env,
      access.space
    );

    return c.json({
      space: toWorkspaceResponse(workspace),
      role: access.membership.role,
      repository,
    });
  })
  .get('/:spaceId/export', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const db = getDb(c.env.DB);

    // Fetch accessible resource IDs via resourceAccess for this workspace
    const accessibleResourceIds = await db.select({ resourceId: resourceAccess.resourceId, permission: resourceAccess.permission })
      .from(resourceAccess)
      .where(eq(resourceAccess.accountId, access.space.id))
      .all();
    const accessibleIdSet = new Set(accessibleResourceIds.map(r => r.resourceId));
    const accessPermissionMap = new Map(accessibleResourceIds.map(r => [r.resourceId, r.permission]));

    const [repoRows, threadRows, resourceRows] = await Promise.all([
      db.select({ id: repositories.id, name: repositories.name, updatedAt: repositories.updatedAt })
        .from(repositories)
        .where(eq(repositories.accountId, access.space.id))
        .orderBy(desc(repositories.updatedAt))
        .all(),
      db.select({ id: threads.id, title: threads.title, status: threads.status, updatedAt: threads.updatedAt })
        .from(threads)
        .where(and(
          eq(threads.accountId, access.space.id),
          ne(threads.status, 'deleted'),
        ))
        .orderBy(desc(threads.updatedAt))
        .all(),
      db.select({
        id: resources.id,
        name: resources.name,
        type: resources.type,
        ownerAccountId: resources.ownerAccountId,
        updatedAt: resources.updatedAt,
      }).from(resources).where(
        and(
          inArray(resources.type, ['d1', 'r2']),
          ne(resources.status, 'deleted'),
          or(
            and(
              eq(resources.accountId, access.space.id),
              eq(resources.ownerAccountId, user.id),
            ),
            accessibleIdSet.size > 0 ? inArray(resources.id, Array.from(accessibleIdSet)) : undefined,
          ),
        )
      ).orderBy(desc(resources.updatedAt)).all(),
    ]);

    const exportedAt = new Date().toISOString();

    const d1Resources = resourceRows
      .filter((resource) => resource.type === 'd1')
      .map((resource) => ({
        id: resource.id,
        name: resource.name,
        updated_at: resource.updatedAt,
        access_level: resource.ownerAccountId === user.id ? 'owner' : (accessPermissionMap.get(resource.id) || 'read'),
        export_url: `/api/resources/${resource.id}/d1/export`,
        method: 'POST' as const,
      }));

    const r2Resources = resourceRows
      .filter((resource) => resource.type === 'r2')
      .map((resource) => ({
        id: resource.id,
        name: resource.name,
        updated_at: resource.updatedAt,
        access_level: resource.ownerAccountId === user.id ? 'owner' : (accessPermissionMap.get(resource.id) || 'read'),
      }));

    return c.json({
      space: toWorkspaceResponse(access.space),
      exported_at: exportedAt,
      repositories: repoRows.map((repo) => ({
        id: repo.id,
        name: repo.name,
        updated_at: repo.updatedAt,
        export_url: `/api/repos/${repo.id}/export`,
        method: 'GET' as const,
      })),
      threads: threadRows.map((thread) => ({
        id: thread.id,
        title: thread.title,
        status: thread.status,
        updated_at: thread.updatedAt,
        export_url: `/api/threads/${thread.id}/export`,
        method: 'GET' as const,
        formats: ['markdown', 'json', 'pdf'] as const,
      })),
      resources: {
        d1: d1Resources,
        r2: r2Resources,
      },
      counts: {
        repositories: repoRows.length,
        threads: threadRows.length,
        d1_resources: d1Resources.length,
        r2_resources: r2Resources.length,
        total_resources: d1Resources.length + r2Resources.length,
      },
    });
  })
  .patch('/:spaceId',
    zValidator('json', z.object({
      name: z.string().optional(),
      ai_model: z.string().optional(),
      ai_provider: z.string().optional(),
      security_posture: z.enum(VALID_SECURITY_POSTURES).optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const body = c.req.valid('json');

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin'],
      'Space not found or insufficient permissions'
    );

    const updates: {
      name?: string;
      ai_model?: string;
      ai_provider?: string;
      security_posture?: 'standard' | 'restricted_egress';
    } = {};

    if (body.name && body.name.trim().length > 0) {
      updates.name = body.name.trim();
    }

    if (body.ai_model) {
      const normalizedModel = normalizeModelId(body.ai_model);
      if (!normalizedModel) {
        throw new BadRequestError('Invalid model');
      }
      updates.ai_model = normalizedModel;

      const inferredProvider = getModelProvider(normalizedModel);
      const providerOverride = normalizeProviderInput(body.ai_provider);
      if (body.ai_provider && !providerOverride) {
        throw new BadRequestError('Invalid provider');
      }
      if (providerOverride && providerOverride !== inferredProvider) {
        throw new BadRequestError('Provider does not match model');
      }
      updates.ai_provider = providerOverride || inferredProvider;
    }

    if (body.ai_provider) {
      const normalizedProvider = normalizeProviderInput(body.ai_provider);
      if (!normalizedProvider) {
        throw new BadRequestError('Invalid provider');
      }
      if (!body.ai_model) {
        const existingModel = normalizeModelId(access.space.ai_model) || DEFAULT_MODEL_ID;
        const inferredProvider = getModelProvider(existingModel);
        if (normalizedProvider !== inferredProvider) {
          throw new BadRequestError('Provider does not match model');
        }
      }
      updates.ai_provider = normalizedProvider;
    }

    if (body.security_posture) {
      updates.security_posture = body.security_posture;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError('No valid updates provided');
    }

    const workspace = await updateWorkspace(c.env.DB, access.space.id, updates);
    if (!workspace) {
      throw new BadRequestError('No valid updates provided');
    }

    return c.json({ space: toWorkspaceResponse(workspace) });
  })
  .get('/:spaceId/model', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const workspace = await getWorkspaceModelSettings(c.env.DB, access.space.id);

    const model = normalizeModelId(workspace?.ai_model) || DEFAULT_MODEL_ID;
    const inferredProvider = getModelProvider(model);
    const provider = workspace?.ai_provider === inferredProvider ? workspace.ai_provider : inferredProvider;

    return c.json({
      ai_model: model,
      ai_provider: provider,
      model,
      provider,
      token_limit: resolveHistoryTokenBudget(model, c.env.MODEL_CONTEXT_WINDOWS),
    });
  })
  .patch('/:spaceId/model',
    zValidator('json', z.object({
      model: z.string().optional(),
      provider: z.string().optional(),
      ai_model: z.string().optional(),
      ai_provider: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const body = c.req.valid('json');

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin'],
      'Space not found or insufficient permissions'
    );

    const requestedModel = body.model || body.ai_model;
    const providerInput = body.provider || body.ai_provider;

    if (!requestedModel) {
      throw new BadRequestError('Model is required');
    }

    const model = normalizeModelId(requestedModel);
    if (!model) {
      throw new BadRequestError('Invalid model');
    }

    const inferredProvider = getModelProvider(model);
    const provider = providerInput || inferredProvider;
    if (provider !== inferredProvider) {
      throw new BadRequestError('Provider does not match model');
    }

    await updateWorkspaceModel(c.env.DB, access.space.id, model, provider);

    return c.json({
      ai_model: model,
      ai_provider: provider,
      model,
      provider,
      token_limit: resolveHistoryTokenBudget(model, c.env.MODEL_CONTEXT_WINDOWS),
    });
  })
  .delete('/:spaceId', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner'],
      'Space not found or insufficient permissions'
    );

    await deleteWorkspace(c.env.DB, access.space.id);

    return c.json({ success: true });
  })
  .get('/:spaceId/sidebar-items', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const items = await getUISidebarItems(c.env.DB, access.space.id);
    return c.json({ items });
  });
