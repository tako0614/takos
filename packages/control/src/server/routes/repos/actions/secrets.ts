import { Hono } from 'hono';
import { badRequest, parseJsonBody } from '../../shared/helpers';
import type { AuthenticatedRouteEnv } from '../../shared/helpers';
import { checkRepoAccess } from '../../../../application/services/source/repos';
import { getDb } from '../../../../infra/db';
import { workflowSecrets } from '../../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { encrypt, generateId, now } from '../../../../shared/utils';
import { notFound, internalError } from '../../../../shared/utils/error-response';

export default new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/actions/secrets', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const db = getDb(c.env.DB);

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, ['owner', 'admin']);
    if (!repoAccess) {
      return notFound(c, 'Repository');
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
      return badRequest(c, 'Secret value is required');
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
    if (!repoAccess) {
      return notFound(c, 'Repository');
    }

    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      return badRequest(
        c,
        'Secret name must be uppercase letters, numbers, and underscores, starting with a letter or underscore'
      );
    }

    const db = getDb(c.env.DB);

    const encryptionKey = c.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return internalError(c, 'Encryption not configured');
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
      return notFound(c, 'Repository');
    }

    const result = await db.delete(workflowSecrets)
      .where(and(
        eq(workflowSecrets.repoId, repoId),
        eq(workflowSecrets.name, name),
      ))
      .returning();

    if (result.length === 0) {
      return notFound(c, 'Secret');
    }

    return c.json({ deleted: true });
  });
