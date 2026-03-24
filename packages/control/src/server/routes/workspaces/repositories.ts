import { Hono } from 'hono';
import { requireWorkspaceAccess, type AuthenticatedRouteEnv } from '../shared/helpers';
import { getRepositoryById } from '../../../application/services/identity/spaces';
import { getDb } from '../../../infra/db';
import { eq, desc } from 'drizzle-orm';
import { repositories } from '../../../infra/db/schema';
import { generateId, now } from '../../../shared/utils';
import { logError } from '../../../shared/utils/logger';
import { internalError } from '../../../shared/utils/error-response';

export default new Hono<AuthenticatedRouteEnv>()
  .post('/:spaceId/init-repo', async (c) => {
    const user = c.get('user');
    const spaceIdentifier = c.req.param('spaceId');

    const access = await requireWorkspaceAccess(
      c,
      spaceIdentifier,
      user.id,
      ['owner', 'admin'],
      'Workspace not found or insufficient permissions'
    );
    if (access instanceof Response) return access;
    const spaceId = access.workspace.id;

    const db = getDb(c.env.DB);

    const existingRepo = await db.select()
      .from(repositories)
      .where(eq(repositories.accountId, spaceId))
      .orderBy(desc(repositories.updatedAt))
      .get() ?? null;

    if (existingRepo) {
      const repository = await getRepositoryById(c.env.DB, existingRepo.id);
      return c.json({
        message: 'Repository already exists',
        skipped: true,
        repository,
      });
    }

    const repoId = generateId();
    const timestamp = now();

    try {
      await db.insert(repositories).values({
        id: repoId,
        accountId: spaceId,
        name: 'main',
        description: 'Default repository for workspace',
        visibility: 'private',
        defaultBranch: 'main',
        stars: 0,
        forks: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const repository = await getRepositoryById(c.env.DB, repoId);

      return c.json({
        message: 'Repository initialized successfully',
        repository,
      }, 201);
    } catch (err) {
      logError(`Failed to init repo for workspace ${spaceId}`, err, { module: 'routes/workspaces/repositories' });
      return internalError(c, err instanceof Error ? err.message : 'Failed to initialize repository');
    }
  });
