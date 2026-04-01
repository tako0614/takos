import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, User } from '../../shared/types/index.ts';
import {
  getRequestedSpaceIdentifier,
  requireSpaceAccess,
} from './route-auth.ts';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { zValidator } from './zod-validator.ts';
import {
  ALLOWED_SHORTCUT_RESOURCE_TYPES,
  createShortcut,
  deleteShortcut,
  isShortcutResourceType,
  listShortcuts,
  reorderShortcuts,
  type ShortcutResourceType,
  updateShortcut,
} from '../../application/services/identity/shortcuts.ts';
import {
  listShortcutGroups,
  getShortcutGroup,
  createShortcutGroup,
  updateShortcutGroup,
  deleteShortcutGroup,
  addItemToGroup,
  removeItemFromGroup,
  type ShortcutItem,
} from '../../application/services/identity/shortcut-groups.ts';
// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createShortcutSchema = z.object({
  name: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  icon: z.string().optional(),
});

const updateShortcutSchema = z.object({
  name: z.string().optional(),
  icon: z.string().optional(),
  position: z.number().optional(),
});

const reorderSchema = z.object({
  order: z.array(z.string()),
});

const shortcutItemSchema = z.object({
  type: z.string(),
  label: z.string(),
  serviceId: z.string().optional(),
  resourceId: z.string().optional(),
  url: z.string().optional(),
  icon: z.string().optional(),
});

const createGroupSchema = z.object({
  name: z.string(),
  icon: z.string().optional(),
  items: z.array(shortcutItemSchema).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().optional(),
  icon: z.string().optional(),
  items: z.array(shortcutItemSchema).optional(),
});

const addGroupItemSchema = z.object({
  type: z.enum(['service', 'ui', 'd1', 'r2', 'kv', 'link']),
  label: z.string(),
  serviceId: z.string().optional(),
  resourceId: z.string().optional(),
  url: z.string().optional(),
  icon: z.string().optional(),
});

type ShortcutContext = Context<{ Bindings: Env; Variables: { user: User } }>;

export const shortcutsRouteDeps = {
  requireSpaceAccess,
  getRequestedSpaceIdentifier,
  listShortcuts,
  createShortcut,
  updateShortcut,
  deleteShortcut,
  reorderShortcuts,
  listShortcutGroups,
  getShortcutGroup,
  createShortcutGroup,
  updateShortcutGroup,
  deleteShortcutGroup,
  addItemToGroup,
  removeItemFromGroup,
  isShortcutResourceType,
};

// Helper to resolve space context. Header-based space selection must pass membership checks.
async function getSpaceId(c: ShortcutContext): Promise<string> {
  const spaceIdentifier = shortcutsRouteDeps.getRequestedSpaceIdentifier(c);
  if (spaceIdentifier) {
    const user = c.get('user');
    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceIdentifier, user.id);
    return access.space.id;
  }
  // Default to user's own account
  const user = c.get('user');
  return user.id;
}

 
export default new Hono<{ Bindings: Env; Variables: { user: User } }>()

  // List shortcuts for current space/user
  .get('/', async (c) => {
    const user = c.get('user');
    const spaceId = await getSpaceId(c);
    const results = await shortcutsRouteDeps.listShortcuts(c.env.DB, user.id, spaceId);
    return c.json({ shortcuts: results });
  })

  // Create shortcut
  .post('/',
    zValidator('json', createShortcutSchema),
    async (c) => {
    const user = c.get('user');
    const spaceId = await getSpaceId(c);

    const body = c.req.valid('json') as {
      name: string;
      resourceType: ShortcutResourceType;
      resourceId: string;
      icon?: string;
    };

    if (!body.name || !body.resourceType || !body.resourceId) {
      throw new BadRequestError( 'Name, resourceType, and resourceId are required');
    }

    if (!shortcutsRouteDeps.isShortcutResourceType(body.resourceType)) {
      throw new BadRequestError( `Invalid resourceType. Allowed values: ${ALLOWED_SHORTCUT_RESOURCE_TYPES.join(', ')}`);
    }

    if (body.resourceType === 'link') {
      try {
        const u = new URL(body.resourceId);
        if (!['http:', 'https:'].includes(u.protocol)) {
          throw new BadRequestError( 'Invalid URL scheme. Only http and https are allowed.');
        }
      } catch {
        // URL constructor throws on malformed input
        throw new BadRequestError( 'Invalid URL');
      }
    }

    const created = await shortcutsRouteDeps.createShortcut(c.env.DB, user.id, spaceId, body);
    return c.json(created, 201);
  })

  // Update shortcut
  .put('/:id',
    zValidator('json', updateShortcutSchema),
    async (c) => {
    const user = c.get('user');
    const spaceId = await getSpaceId(c);
    const id = c.req.param('id');

    const body = c.req.valid('json');

    const updated = await shortcutsRouteDeps.updateShortcut(c.env.DB, user.id, spaceId, id, body);
    if (!updated) {
      throw new BadRequestError( 'No fields to update');
    }

    return c.json({ success: true });
  })

  // Delete shortcut
  .delete('/:id', async (c) => {
    const user = c.get('user');
    const spaceId = await getSpaceId(c);
    const id = c.req.param('id');

    await shortcutsRouteDeps.deleteShortcut(c.env.DB, user.id, spaceId, id);

    return c.json({ success: true });
  })

  // Reorder shortcuts (batch update positions)
  .post('/reorder',
    zValidator('json', reorderSchema),
    async (c) => {
    const user = c.get('user');
    const spaceId = await getSpaceId(c);

    const body = c.req.valid('json');

    // Batch update all shortcut positions in a single D1 batch call
    await shortcutsRouteDeps.reorderShortcuts(c.env.DB, user.id, spaceId, body.order);

    return c.json({ success: true });
  });

/**
 * Shortcut Groups API Routes
 *
 * GET    /api/spaces/:spaceId/shortcuts/groups - List groups
 * POST   /api/spaces/:spaceId/shortcuts/groups - Create group
 * GET    /api/spaces/:spaceId/shortcuts/groups/:groupId - Get group
 * PATCH  /api/spaces/:spaceId/shortcuts/groups/:groupId - Update group
 * DELETE /api/spaces/:spaceId/shortcuts/groups/:groupId - Delete group
 * POST   /api/spaces/:spaceId/shortcuts/groups/:groupId/items - Add item
 * DELETE /api/spaces/:spaceId/shortcuts/groups/:groupId/items/:itemId - Remove item
 */

 
export const shortcutGroupRoutes = new Hono<{ Bindings: Env; Variables: { user: User } }>()

  // List shortcut groups
  .get('/spaces/:spaceId/shortcuts/groups', async (c) => {
    const { spaceId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id);

    const groups = await shortcutsRouteDeps.listShortcutGroups(c.env.DB, access.space.id);

    return c.json({ data: groups });
  })

  // Create shortcut group
  .post('/spaces/:spaceId/shortcuts/groups',
    zValidator('json', createGroupSchema),
    async (c) => {
    const { spaceId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id, ['owner', 'admin', 'editor']);

    const body = c.req.valid('json');

    if (!body.name) {
      throw new BadRequestError( 'name is required');
    }

    const group = await shortcutsRouteDeps.createShortcutGroup(c.env.DB, access.space.id, {
      name: body.name,
      icon: body.icon,
      items: body.items as ShortcutItem[] | undefined,
    });

    return c.json({ data: group }, 201);
  })

  // Get shortcut group
  .get('/spaces/:spaceId/shortcuts/groups/:groupId', async (c) => {
    const { spaceId, groupId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id);

    const group = await shortcutsRouteDeps.getShortcutGroup(c.env.DB, access.space.id, groupId);

    if (!group) {
      throw new NotFoundError( 'Shortcut group');
    }

    return c.json({ data: group });
  })

  // Update shortcut group
  .patch('/spaces/:spaceId/shortcuts/groups/:groupId',
    zValidator('json', updateGroupSchema),
    async (c) => {
    const { spaceId, groupId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id, ['owner', 'admin', 'editor']);

    const body = c.req.valid('json');

    const group = await shortcutsRouteDeps.updateShortcutGroup(c.env.DB, access.space.id, groupId, {
      name: body.name,
      icon: body.icon,
      items: body.items as ShortcutItem[] | undefined,
    });

    if (!group) {
      throw new NotFoundError( 'Shortcut group (or managed by app deployment)');
    }

    return c.json({ data: group });
  })

  // Delete shortcut group
  .delete('/spaces/:spaceId/shortcuts/groups/:groupId', async (c) => {
    const { spaceId, groupId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id, ['owner', 'admin']);

    const deleted = await shortcutsRouteDeps.deleteShortcutGroup(c.env.DB, access.space.id, groupId);

    if (!deleted) {
      throw new NotFoundError( 'Shortcut group (or managed by app deployment)');
    }

    return c.json({ success: true });
  })

  // Add item to group
  .post('/spaces/:spaceId/shortcuts/groups/:groupId/items',
    zValidator('json', addGroupItemSchema),
    async (c) => {
    const { spaceId, groupId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id, ['owner', 'admin', 'editor']);

    const body = c.req.valid('json');

    if (!body.type || !body.label) {
      throw new BadRequestError( 'type and label are required');
    }

    const item = await shortcutsRouteDeps.addItemToGroup(c.env.DB, access.space.id, groupId, body as Omit<ShortcutItem, 'id'>);

    if (!item) {
      throw new NotFoundError( 'Shortcut group (or managed by app deployment)');
    }

    return c.json({ data: item }, 201);
  })

  // Remove item from group
  .delete('/spaces/:spaceId/shortcuts/groups/:groupId/items/:itemId', async (c) => {
    const { spaceId, groupId, itemId } = c.req.param();
    const user = c.get('user');

    const access = await shortcutsRouteDeps.requireSpaceAccess(c, spaceId, user.id, ['owner', 'admin', 'editor']);

    const removed = await shortcutsRouteDeps.removeItemFromGroup(c.env.DB, access.space.id, groupId, itemId);

    if (!removed) {
      throw new NotFoundError( 'Shortcut group or item (or managed by app deployment)');
    }

    return c.json({ success: true });
  });
