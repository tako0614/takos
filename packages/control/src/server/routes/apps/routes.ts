import { Hono } from 'hono';
import type { Env, User } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import {
  getRequestedSpaceIdentifier,
  parseJsonBody,
  requireSpaceAccess,
} from '../route-auth';
import { BadRequestError, AuthenticationError, NotFoundError, AuthorizationError } from 'takos-common/errors';
import { getDb } from '../../../infra/db';
import { apps as appsTable, accounts } from '../../../infra/db/schema';
import { services } from '../../../infra/db/schema-services';
import { eq, and } from 'drizzle-orm';

type Variables = {
  user?: User;
};

/**
 * App type definitions for unified framework
 */
export type AppType = 'platform' | 'builtin' | 'custom';

/**
 * Builtin apps configuration
 */
const BUILTIN_APPS: Array<{
  name: string;
  description: string;
  icon: string;
  getPath: (spaceIdentifier?: string) => string;
}> = [
  {
    name: 'chat',
    description: 'AI chat workspace',
    icon: '💬',
    getPath: (spaceIdentifier) => spaceIdentifier ? `/chat/${spaceIdentifier}` : '/chat',
  },
  {
    name: 'repos',
    description: 'Source repository browser',
    icon: '📁',
    getPath: (spaceIdentifier) => spaceIdentifier ? `/repos/${spaceIdentifier}` : '/repos',
  },
  {
    name: 'store',
    description: 'Discover and install apps',
    icon: '🛍️',
    getPath: () => '/store',
  },
  {
    name: 'deploy',
    description: 'Workers and resources',
    icon: '🛠️',
    getPath: (spaceIdentifier) => spaceIdentifier ? `/deploy/w/${spaceIdentifier}` : '/deploy',
  },
];

function resolveCustomAppUrl(hostname: string | null | undefined, status: string | null | undefined): string | null {
  if (status === 'deployed' && hostname) {
    return `https://${hostname}`;
  }
  return null;
}

function getSpaceIdentifierFromAccount(account: { slug: string | null; type?: string } | null | undefined): string | null {
  if (!account) return null;
  if (account.type === 'user') return 'me';
  return account.slug;
}

async function resolveAppsSpaceScope(
  c: { req: { header: (name: string) => string | undefined } },
  requireAccess: () => ReturnType<typeof requireSpaceAccess>,
): Promise<{ identifier: string; spaceId: string } | null> {
  const spaceIdentifier = getRequestedSpaceIdentifier(c as Parameters<typeof getRequestedSpaceIdentifier>[0]);
  if (!spaceIdentifier) {
    return null;
  }

  const access = await requireAccess();

  return {
    identifier: spaceIdentifier,
    spaceId: access.space.id,
  };
}

/**
 * Register App API routes (requires authentication)
 */
export function registerAppApiRoutes<V extends Variables>(api: Hono<{ Bindings: Env; Variables: V }>) {
  const resolvePrincipalId = (user: User) => user.principal_id ?? user.id;

  // List all apps (builtin + custom)
  api.get('/apps', async (c) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }
    const db = getDb(c.env.DB);
    const spaceScope = await resolveAppsSpaceScope(
      c,
      () => requireSpaceAccess(c, getRequestedSpaceIdentifier(c) || '', user.id),
    );
    const principalId = resolvePrincipalId(user);

    const { asc: ascOrder, isNotNull } = await import('drizzle-orm');
    const { leftJoin } = { leftJoin: true }; // marker for readability

    // Get custom apps from database - find apps where user is a member of the workspace
    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const appRows = await db.select({
      id: appsTable.id,
      name: appsTable.name,
      description: appsTable.description,
      icon: appsTable.icon,
      appType: appsTable.appType,
      accountId: appsTable.accountId,
      serviceHostname: services.hostname,
      serviceStatus: services.status,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    }).from(appsTable)
      .leftJoin(services, eq(appsTable.serviceId, services.id))
      .leftJoin(accounts, eq(appsTable.accountId, accounts.id))
      .where(eq(appsTable.accountId, targetAccountId))
      .orderBy(ascOrder(appsTable.name))
      .all();

    const customApps = appRows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      appType: row.appType,
      accountId: row.accountId,
      service: row.serviceHostname !== null || row.serviceStatus !== null ? {
        hostname: row.serviceHostname,
        status: row.serviceStatus,
      } : null,
      account: {
        name: row.accountName,
        slug: row.accountSlug,
        type: row.accountType,
      },
    }));

    // Combine builtin and custom apps
    const apps = [
      ...BUILTIN_APPS.map(b => ({
        id: `builtin-${b.name}`,
        name: b.name,
        description: b.description,
        icon: b.icon,
        app_type: 'builtin' as AppType,
        url: b.getPath(spaceScope?.identifier),
        space_id: spaceScope?.identifier || null,
        space_name: null,
        service_hostname: null,
        service_status: null,
      })),
      ...customApps.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        icon: a.icon || '📱',
        app_type: (a.appType || 'custom') as AppType,
        url: resolveCustomAppUrl(a.service?.hostname, a.service?.status),
        space_id: getSpaceIdentifierFromAccount(a.account ? { slug: a.account.slug, type: a.account.type ?? undefined } : null),
        space_name: a.account?.name || null,
        service_hostname: a.service?.hostname || null,
        service_status: a.service?.status || null,
      })),
    ];

    return c.json({ apps });
  });

  // Get single app info
  api.get('/apps/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param('id');
    const db = getDb(c.env.DB);
    const spaceScope = await resolveAppsSpaceScope(
      c,
      () => requireSpaceAccess(c, getRequestedSpaceIdentifier(c) || '', user.id),
    );
    const principalId = resolvePrincipalId(user);

    // Check if it's a builtin app
    if (appId.startsWith('builtin-')) {
      const builtinName = appId.slice(8);
      const builtin = BUILTIN_APPS.find(b => b.name === builtinName);
      if (!builtin) {
        throw new NotFoundError('App');
      }
      return c.json({
        app: {
          id: appId,
          name: builtin.name,
          description: builtin.description,
          icon: builtin.icon,
          app_type: 'builtin',
          url: builtin.getPath(spaceScope?.identifier),
        }
      });
    }

    // Get custom app - user must be a member of the workspace
    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const appRow = await db.select({
      id: appsTable.id,
      name: appsTable.name,
      description: appsTable.description,
      icon: appsTable.icon,
      appType: appsTable.appType,
      takosClientKey: appsTable.takosClientKey,
      createdAt: appsTable.createdAt,
      updatedAt: appsTable.updatedAt,
      serviceHostname: services.hostname,
      serviceStatus: services.status,
      accountName: accounts.name,
      accountSlug: accounts.slug,
      accountType: accounts.type,
    }).from(appsTable)
      .leftJoin(services, eq(appsTable.serviceId, services.id))
      .leftJoin(accounts, eq(appsTable.accountId, accounts.id))
      .where(and(eq(appsTable.id, appId), eq(appsTable.accountId, targetAccountId)))
      .get();

    if (!appRow) {
      throw new NotFoundError('App');
    }

    return c.json({
      app: {
        id: appRow.id,
        name: appRow.name,
        description: appRow.description,
        icon: appRow.icon || '📱',
        app_type: appRow.appType || 'custom',
        url: resolveCustomAppUrl(appRow.serviceHostname, appRow.serviceStatus),
        space_id: getSpaceIdentifierFromAccount(appRow.accountSlug ? { slug: appRow.accountSlug, type: appRow.accountType ?? undefined } : null),
        space_name: appRow.accountName || null,
        service_hostname: appRow.serviceHostname || null,
        service_status: appRow.serviceStatus || null,
        takos_client_key: appRow.takosClientKey,
        created_at: appRow.createdAt,
        updated_at: appRow.updatedAt,
      }
    });
  });

  // Update app metadata
  api.patch('/apps/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param('id');
    const db = getDb(c.env.DB);

    if (appId.startsWith('builtin-')) {
      throw new AuthorizationError('Cannot modify builtin apps');
    }

    const body = await parseJsonBody<{
      name?: string;
      description?: string;
      icon?: string;
    }>(c, {});

    if (body === null) {
      throw new BadRequestError('Invalid JSON body');
    }

    const principalId = resolvePrincipalId(user);
    // Verify ownership - user must be owner or admin of the workspace
    const app = await db.select().from(appsTable).where(
      and(eq(appsTable.id, appId), eq(appsTable.accountId, principalId))
    ).get();

    if (!app) {
      throw new NotFoundError('App');
    }

    // Build update data
    const updateData: { description?: string; icon?: string; updatedAt: string } = {
      updatedAt: new Date().toISOString(),
    };

    if (body.description !== undefined) {
      updateData.description = body.description;
    }
    if (body.icon !== undefined) {
      updateData.icon = body.icon;
    }

    // Check if there are any actual updates besides updatedAt
    if (body.description === undefined && body.icon === undefined) {
      throw new BadRequestError('No valid updates provided');
    }

    await db.update(appsTable).set(updateData).where(eq(appsTable.id, appId));

    return c.json({ success: true });
  });

  // Generate client key for app (for API access)
  api.post('/apps/:id/client-key', async (c) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param('id');
    const db = getDb(c.env.DB);

    if (appId.startsWith('builtin-')) {
      throw new AuthorizationError('Cannot generate client key for builtin apps');
    }

    const principalId = resolvePrincipalId(user);
    // Verify ownership - user must be owner or admin of the workspace
    const app = await db.select().from(appsTable).where(
      and(eq(appsTable.id, appId), eq(appsTable.accountId, principalId))
    ).get();

    if (!app) {
      throw new NotFoundError('App');
    }

    // Generate new client key
    const clientKey = `tak_${generateId()}${generateId()}`;
    const timestamp = new Date().toISOString();

    await db.update(appsTable).set({
      takosClientKey: clientKey,
      updatedAt: timestamp,
    }).where(eq(appsTable.id, appId));

    return c.json({
      client_key: clientKey,
      app_id: appId,
      generated_at: timestamp,
    });
  });

  // Delete app
  api.delete('/apps/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param('id');
    const db = getDb(c.env.DB);

    if (appId.startsWith('builtin-')) {
      throw new AuthorizationError('Cannot delete builtin apps');
    }

    const principalId = resolvePrincipalId(user);
    // Verify ownership - only workspace owner can delete apps
    const app = await db.select().from(appsTable).where(
      and(eq(appsTable.id, appId), eq(appsTable.accountId, principalId))
    ).get();

    if (!app) {
      throw new NotFoundError('App');
    }

    // Delete app files from R2 using batch delete
    const bucket = c.env.TENANT_SOURCE;
    if (bucket) {
      const prefix = `apps/${app.name}/`;
      const listed = await bucket.list({ prefix });
      if (listed.objects.length > 0) {
        // R2 supports batch delete - delete all keys at once
        await bucket.delete(listed.objects.map(obj => obj.key));
      }
    }

    // Delete from database
    await db.delete(appsTable).where(eq(appsTable.id, appId));

    return c.json({ success: true });
  });
}
