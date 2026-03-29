import { Hono, type Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Env } from '../../shared/types';
import { spaceAccess, type SpaceAccessRouteEnv } from './route-auth';
import { getDb, groups, groupEntities } from '../../infra/db';
import { BadRequestError, NotFoundError } from 'takos-common/errors';

type GroupsContext = Context<SpaceAccessRouteEnv>;

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

function getGroupIdParam(c: GroupsContext): string {
  const groupId = c.req.param('groupId');
  if (!groupId) throw new BadRequestError('groupId param is required');
  return groupId;
}

function getCategoryParam(c: GroupsContext): string {
  const category = c.req.param('category');
  if (!category) throw new BadRequestError('category param is required');
  return decodeURIComponent(category);
}

function getNameParam(c: GroupsContext): string {
  const name = c.req.param('name');
  if (!name) throw new BadRequestError('name param is required');
  return decodeURIComponent(name);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listGroupsHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const result = await db.select().from(groups).where(eq(groups.spaceId, space.id));
  return c.json({ groups: result });
}

async function createGroupHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(groups).values({
    id,
    spaceId: space.id,
    name: body.name,
    appVersion: body.appVersion ?? null,
    provider: body.provider ?? null,
    env: body.env ?? null,
    manifestJson: body.manifestJson ? JSON.stringify(body.manifestJson) : null,
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ id, name: body.name }, 201);
}

async function getGroupHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const group = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.spaceId, space.id)))
    .get();
  if (!group) throw new NotFoundError('Group');
  return c.json(group);
}

async function deleteGroupHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const group = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.spaceId, space.id)))
    .get();
  if (!group) throw new NotFoundError('Group');
  await db.delete(groups).where(eq(groups.id, groupId));
  return c.json({ deleted: true });
}

async function listEntitiesHandler(c: GroupsContext) {
  const db = getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const category = c.req.query('category');

  const where = category
    ? and(eq(groupEntities.groupId, groupId), eq(groupEntities.category, category))
    : eq(groupEntities.groupId, groupId);

  const result = await db
    .select()
    .from(groupEntities)
    .where(where);
  return c.json({
    entities: result.map((e) => ({ ...e, config: JSON.parse(e.config) })),
  });
}

async function upsertEntityHandler(c: GroupsContext) {
  const db = getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const body = await c.req.json();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .insert(groupEntities)
    .values({
      id,
      groupId,
      category: body.category,
      name: body.name,
      config: JSON.stringify(body.config || {}),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [groupEntities.groupId, groupEntities.category, groupEntities.name],
      set: { config: JSON.stringify(body.config || {}), updatedAt: now },
    });

  return c.json({ id, category: body.category, name: body.name }, 201);
}

async function deleteEntityHandler(c: GroupsContext) {
  const db = getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const category = getCategoryParam(c);
  const name = getNameParam(c);

  await db
    .delete(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, category),
        eq(groupEntities.name, name),
      ),
    );
  return c.json({ deleted: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const groupsRouter = new Hono<{ Bindings: Env }>();

// Group CRUD
groupsRouter
  .get('/spaces/:spaceId/groups', spaceAccess(), listGroupsHandler)
  .post('/spaces/:spaceId/groups', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), createGroupHandler)
  .get('/spaces/:spaceId/groups/:groupId', spaceAccess(), getGroupHandler)
  .delete('/spaces/:spaceId/groups/:groupId', spaceAccess({ roles: ['owner', 'admin'] }), deleteGroupHandler)

  // Group entities
  .get('/spaces/:spaceId/groups/:groupId/entities', spaceAccess(), listEntitiesHandler)
  .post('/spaces/:spaceId/groups/:groupId/entities', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), upsertEntityHandler)
  .delete('/spaces/:spaceId/groups/:groupId/entities/:category/:name', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), deleteEntityHandler);

export default groupsRouter;
