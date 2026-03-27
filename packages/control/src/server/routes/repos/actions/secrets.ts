import { Hono } from 'hono';
import { parseJsonBody } from '../../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../../shared/route-auth';
import { BadRequestError } from '@takos/common/errors';
import { checkRepoAccess } from '../../../../application/services/source/repos';
import { getDb } from '../../../../infra/db';
import { workflowSecrets } from '../../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, generateId, now } from '../../../../shared/utils';
import { NotFoundError, InternalError } from '@takos/common/errors';

export default new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/actions/secrets', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const db = getDb(c.env.DB);

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, ['owner', 'admin']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const secrets = await db.select({
      id: workflowSecrets.id,
      name: workflowSecrets.name,
      createdAt: workflowSecrets.createdAt,
      updatedAt: workflowSecrets.updatedAt,
    })
      .from(workflowSecrets)
      .where(eq(workflowSecrets.repoId, repoId))
      .orderBy(workflowSecrets.name)
      .all();

    return c.json({
      secrets: secrets.map((s) => ({
        name: s.name,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      })),
    });
  })
  .put('/repos/:repoId/actions/secrets/:name', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const name = c.req.param('name');
    const body = await parseJsonBody<{ value: string }>(c);

    if (!body || !body.value) {
      throw new BadRequestError( 'Secret value is required');
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new BadRequestError(
        'Secret name must be uppercase letters, numbers, and underscores, starting with a letter or underscore'
      );
    }

    const db = getDb(c.env.DB);

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new InternalError('Encryption not configured');
    }

    const encryptedValue = JSON.stringify(await encrypt(body.value, encryptionKey, `secret:${repoId}:${name}`));
    const timestamp = now();

    const existing = await db.select()
      .from(workflowSecrets)
      .where(and(
        eq(workflowSecrets.repoId, repoId),
        eq(workflowSecrets.name, name),
      ))
      .get();

    if (existing) {
      await db.update(workflowSecrets)
        .set({
          encryptedValue,
          updatedAt: timestamp,
        })
        .where(and(
          eq(workflowSecrets.repoId, repoId),
          eq(workflowSecrets.name, name),
        ));
    } else {
      try {
        const secretId = generateId();
        await db.insert(workflowSecrets).values({
          id: secretId,
          repoId,
          name,
          encryptedValue,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      } catch {
        // Insert failed (unique constraint) -- update existing secret instead
        await db.update(workflowSecrets)
          .set({
            encryptedValue,
            updatedAt: timestamp,
          })
          .where(and(
            eq(workflowSecrets.repoId, repoId),
            eq(workflowSecrets.name, name),
          ));
      }
    }

    return c.json({
      name,
      created_at: timestamp,
      updated_at: timestamp,
    });
  })
  .delete('/repos/:repoId/actions/secrets/:name', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const name = c.req.param('name');
    const db = getDb(c.env.DB);

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const result = await db.delete(workflowSecrets)
      .where(and(
        eq(workflowSecrets.repoId, repoId),
        eq(workflowSecrets.name, name),
      ))
      .returning();

    if (result.length === 0) {
      throw new NotFoundError('Secret');
    }

    return c.json({ deleted: true });
  });
