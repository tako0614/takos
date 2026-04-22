import type { Hono } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import { generateId } from "../../shared/utils/index.ts";
import {
  getRequestedSpaceIdentifier,
  parseJsonBody,
  requireSpaceAccess,
} from "./route-auth.ts";
import {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
} from "takos-common/errors";
import { getDb } from "../../infra/db/index.ts";
import { accounts, apps as appsTable } from "../../infra/db/schema.ts";
import { publications, services } from "../../infra/db/schema-services.ts";
import { and, asc, eq } from "drizzle-orm";

type Variables = {
  user?: User;
};

/**
 * App type definitions for unified framework
 */
export type AppType = "platform" | "custom";
type AppSourceType = "legacy" | "manifest";

type AccountInfo = {
  name: string | null;
  slug: string | null;
  type: string | null;
};

type LegacyAppRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  appType: string | null;
  serviceHostname: string | null;
  serviceStatus: string | null;
  accountName: string | null;
  accountSlug: string | null;
  accountType: string | null;
  takosClientKey?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PublicationAppRow = {
  id: string;
  name: string;
  groupId: string | null;
  sourceType: string | null;
  publicationType: string | null;
  specJson: string | null;
  resolvedJson: string | null;
  serviceConfig?: string | null;
  serviceHostname: string | null;
  serviceStatus: string | null;
  accountName: string | null;
  accountSlug: string | null;
  accountType: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PublicApp = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  app_type: AppType;
  url: string | null;
  space_id: string | null;
  space_name: string | null;
  service_hostname: string | null;
  service_status: string | null;
  source_type: AppSourceType;
  group_id: string | null;
  publication_name: string | null;
  category: string | null;
  sort_order: number | null;
  takos_client_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const UI_SURFACE_PUBLICATION_TYPE = "UiSurface";
const DEFAULT_APP_ICON = "";

function resolveCustomAppUrl(
  hostname: string | null | undefined,
  status: string | null | undefined,
): string | null {
  if (status === "deployed" && hostname) {
    return `https://${hostname}`;
  }
  return null;
}

function getSpaceIdentifierFromAccount(
  account: { slug: string | null; type?: string } | null | undefined,
): string | null {
  if (!account) return null;
  if (account.type === "user") return "me";
  return account.slug;
}

export const appsRouteDeps = {
  getDb,
  requireSpaceAccess,
};

async function resolveAppsSpaceScope(
  c: { req: { header: (name: string) => string | undefined } },
  requireAccess: () => ReturnType<typeof requireSpaceAccess>,
): Promise<{ identifier: string; spaceId: string } | null> {
  const spaceIdentifier = getRequestedSpaceIdentifier(
    c as Parameters<typeof getRequestedSpaceIdentifier>[0],
  );
  if (!spaceIdentifier) {
    return null;
  }

  const access = await requireAccess();

  return {
    identifier: spaceIdentifier,
    spaceId: access.space.id,
  };
}

function toPublicAppType(appType: string | null | undefined): AppType {
  return appType === "platform" ? "platform" : "custom";
}

function stringOrNull(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function spaceIdentifierFromRow(row: AccountInfo): string | null {
  return getSpaceIdentifierFromAccount({
    slug: row.slug,
    type: row.type ?? undefined,
  });
}

function resolveLauncherIcon(
  icon: string | null,
  baseUrl: string | null,
): string | null {
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) return icon;
  if (!baseUrl || !icon.startsWith("/") || icon.startsWith("//")) {
    return icon;
  }

  try {
    const base = new URL(baseUrl);
    return new URL(icon, `${base.protocol}//${base.host}`).toString();
  } catch {
    return icon;
  }
}

function legacyRowToPublicApp(row: LegacyAppRow): PublicApp {
  const url = resolveCustomAppUrl(row.serviceHostname, row.serviceStatus);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon || DEFAULT_APP_ICON,
    app_type: toPublicAppType(row.appType),
    url,
    space_id: spaceIdentifierFromRow({
      name: row.accountName,
      slug: row.accountSlug,
      type: row.accountType,
    }),
    space_name: row.accountName || null,
    service_hostname: row.serviceHostname || hostnameFromUrl(url),
    service_status: row.serviceStatus || null,
    source_type: "legacy",
    group_id: null,
    publication_name: null,
    category: null,
    sort_order: null,
    ...(row.takosClientKey !== undefined
      ? { takos_client_key: row.takosClientKey }
      : {}),
    ...(row.createdAt !== undefined ? { created_at: row.createdAt } : {}),
    ...(row.updatedAt !== undefined ? { updated_at: row.updatedAt } : {}),
  };
}

function publicationRowToPublicApp(row: PublicationAppRow): PublicApp | null {
  if (row.sourceType !== "manifest") return null;
  if (row.publicationType !== UI_SURFACE_PUBLICATION_TYPE) return null;

  const publication = parseJsonRecord(row.specJson);
  const spec = publication.spec && typeof publication.spec === "object" &&
      !Array.isArray(publication.spec)
    ? publication.spec as Record<string, unknown>
    : {};
  if (spec.launcher === false) return null;

  const url = stringOrNull(parseJsonRecord(row.resolvedJson).url);
  const title = stringOrNull(publication.title);
  const name = title ?? stringOrNull(publication.name) ?? row.name;
  const description = stringOrNull(spec.description);
  const serviceConfig = parseJsonRecord(row.serviceConfig);
  const desiredSpec = recordOrNull(serviceConfig.desiredSpec);
  const rawIcon = stringOrNull(spec.icon) ?? stringOrNull(desiredSpec?.icon) ??
    stringOrNull(serviceConfig.icon);
  const icon = resolveLauncherIcon(rawIcon, url) ?? DEFAULT_APP_ICON;
  const category = stringOrNull(spec.category);
  const sortOrder = numberOrNull(spec.sortOrder);

  return {
    id: row.id,
    name,
    description,
    icon,
    app_type: "custom",
    url,
    space_id: spaceIdentifierFromRow({
      name: row.accountName,
      slug: row.accountSlug,
      type: row.accountType,
    }),
    space_name: row.accountName || null,
    service_hostname: row.serviceHostname || hostnameFromUrl(url),
    service_status: row.serviceStatus || (url ? "deployed" : null),
    source_type: "manifest",
    group_id: row.groupId,
    publication_name: row.name,
    category,
    sort_order: sortOrder,
    created_at: row.createdAt ?? null,
    updated_at: row.updatedAt ?? null,
  };
}

function sortPublicApps(apps: PublicApp[]): PublicApp[] {
  return apps.sort((left, right) => {
    const sortLeft = left.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sortRight = right.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sortLeft !== sortRight) return sortLeft - sortRight;
    return left.name.localeCompare(right.name);
  });
}

async function listLegacyAppRows(
  db: ReturnType<typeof getDb>,
  accountId: string,
): Promise<LegacyAppRow[]> {
  return await db.select({
    id: appsTable.id,
    name: appsTable.name,
    description: appsTable.description,
    icon: appsTable.icon,
    appType: appsTable.appType,
    serviceHostname: services.hostname,
    serviceStatus: services.status,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountType: accounts.type,
  }).from(appsTable)
    .leftJoin(services, eq(appsTable.serviceId, services.id))
    .leftJoin(accounts, eq(appsTable.accountId, accounts.id))
    .where(eq(appsTable.accountId, accountId))
    .orderBy(asc(appsTable.name))
    .all() as LegacyAppRow[];
}

async function findLegacyAppRow(
  db: ReturnType<typeof getDb>,
  accountId: string,
  appId: string,
): Promise<LegacyAppRow | null> {
  return await db.select({
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
    .where(and(eq(appsTable.id, appId), eq(appsTable.accountId, accountId)))
    .get() as LegacyAppRow | null;
}

async function listPublicationAppRows(
  db: ReturnType<typeof getDb>,
  accountId: string,
): Promise<PublicationAppRow[]> {
  return await db.select({
    id: publications.id,
    name: publications.name,
    groupId: publications.groupId,
    sourceType: publications.sourceType,
    publicationType: publications.publicationType,
    specJson: publications.specJson,
    resolvedJson: publications.resolvedJson,
    serviceConfig: services.config,
    serviceHostname: services.hostname,
    serviceStatus: services.status,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountType: accounts.type,
    createdAt: publications.createdAt,
    updatedAt: publications.updatedAt,
  }).from(publications)
    .leftJoin(services, eq(publications.ownerServiceId, services.id))
    .leftJoin(accounts, eq(publications.accountId, accounts.id))
    .where(and(
      eq(publications.accountId, accountId),
      eq(publications.sourceType, "manifest"),
      eq(publications.publicationType, UI_SURFACE_PUBLICATION_TYPE),
    ))
    .orderBy(asc(publications.createdAt), asc(publications.id))
    .all() as PublicationAppRow[];
}

async function findPublicationAppRow(
  db: ReturnType<typeof getDb>,
  accountId: string,
  appId: string,
): Promise<PublicationAppRow | null> {
  return await db.select({
    id: publications.id,
    name: publications.name,
    groupId: publications.groupId,
    sourceType: publications.sourceType,
    publicationType: publications.publicationType,
    specJson: publications.specJson,
    resolvedJson: publications.resolvedJson,
    serviceConfig: services.config,
    serviceHostname: services.hostname,
    serviceStatus: services.status,
    accountName: accounts.name,
    accountSlug: accounts.slug,
    accountType: accounts.type,
    createdAt: publications.createdAt,
    updatedAt: publications.updatedAt,
  }).from(publications)
    .leftJoin(services, eq(publications.ownerServiceId, services.id))
    .leftJoin(accounts, eq(publications.accountId, accounts.id))
    .where(and(
      eq(publications.id, appId),
      eq(publications.accountId, accountId),
      eq(publications.sourceType, "manifest"),
      eq(publications.publicationType, UI_SURFACE_PUBLICATION_TYPE),
    ))
    .get() as PublicationAppRow | null;
}

async function rejectManifestManagedAppMutationIfMatched(
  db: ReturnType<typeof getDb>,
  accountId: string,
  appId: string,
): Promise<void> {
  const publicationRow = await findPublicationAppRow(db, accountId, appId);
  const publicationApp = publicationRow
    ? publicationRowToPublicApp(publicationRow)
    : null;
  if (!publicationApp) return;
  throw new BadRequestError(
    "Manifest-managed apps are read-only. Update publish[] in the app manifest and redeploy.",
  );
}

/**
 * Register App API routes (requires authentication)
 */
export function registerAppApiRoutes<V extends Variables>(
  api: Hono<{ Bindings: Env; Variables: V }>,
) {
  const resolvePrincipalId = (user: User) => user.principal_id ?? user.id;

  // List registered apps.
  api.get("/apps", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const db = appsRouteDeps.getDb(c.env.DB);
    const spaceScope = await resolveAppsSpaceScope(
      c,
      () =>
        appsRouteDeps.requireSpaceAccess(
          c,
          getRequestedSpaceIdentifier(c) || "",
          user.id,
        ),
    );
    const principalId = resolvePrincipalId(user);

    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const legacyApps = (await listLegacyAppRows(db, targetAccountId))
      .map(legacyRowToPublicApp);
    const publicationApps = (await listPublicationAppRows(db, targetAccountId))
      .map(publicationRowToPublicApp)
      .filter((app): app is PublicApp => app !== null);
    const apps = sortPublicApps([...publicationApps, ...legacyApps]);

    return c.json({ apps });
  });

  // Get single app info
  api.get("/apps/:id", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param("id");
    const db = appsRouteDeps.getDb(c.env.DB);
    const spaceScope = await resolveAppsSpaceScope(
      c,
      () =>
        appsRouteDeps.requireSpaceAccess(
          c,
          getRequestedSpaceIdentifier(c) || "",
          user.id,
        ),
    );
    const principalId = resolvePrincipalId(user);

    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const legacyApp = await findLegacyAppRow(db, targetAccountId, appId);

    if (legacyApp) {
      return c.json({ app: legacyRowToPublicApp(legacyApp) });
    }

    const publicationRow = await findPublicationAppRow(
      db,
      targetAccountId,
      appId,
    );
    const publicationApp = publicationRow
      ? publicationRowToPublicApp(publicationRow)
      : null;
    if (publicationApp) {
      return c.json({ app: publicationApp });
    }

    throw new NotFoundError("App");
  });

  // Update app metadata
  api.patch("/apps/:id", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param("id");
    const db = appsRouteDeps.getDb(c.env.DB);

    const body = await parseJsonBody<{
      name?: string;
      description?: string;
      icon?: string;
    }>(c, {});

    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }

    const spaceScope = await resolveAppsSpaceScope(
      c,
      () =>
        appsRouteDeps.requireSpaceAccess(
          c,
          getRequestedSpaceIdentifier(c) || "",
          user.id,
        ),
    );
    const principalId = resolvePrincipalId(user);

    // Verify ownership - user must be owner or admin of the workspace
    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const app = await db.select().from(appsTable).where(
      and(eq(appsTable.id, appId), eq(appsTable.accountId, targetAccountId)),
    ).get();

    if (!app) {
      await rejectManifestManagedAppMutationIfMatched(
        db,
        targetAccountId,
        appId,
      );
      throw new NotFoundError("App");
    }

    // Build update data
    const updateData: {
      description?: string;
      icon?: string;
      updatedAt: string;
    } = {
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
      throw new BadRequestError("No valid updates provided");
    }

    await db.update(appsTable).set(updateData).where(eq(appsTable.id, appId));

    return c.json({ success: true });
  });

  // Generate client key for app (for API access)
  api.post("/apps/:id/client-key", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param("id");
    const db = appsRouteDeps.getDb(c.env.DB);

    const spaceScope = await resolveAppsSpaceScope(
      c,
      () =>
        appsRouteDeps.requireSpaceAccess(
          c,
          getRequestedSpaceIdentifier(c) || "",
          user.id,
        ),
    );
    const principalId = resolvePrincipalId(user);

    // Verify ownership - user must be owner or admin of the workspace
    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const app = await db.select().from(appsTable).where(
      and(eq(appsTable.id, appId), eq(appsTable.accountId, targetAccountId)),
    ).get();

    if (!app) {
      await rejectManifestManagedAppMutationIfMatched(
        db,
        targetAccountId,
        appId,
      );
      throw new NotFoundError("App");
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
  api.delete("/apps/:id", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param("id");
    const db = appsRouteDeps.getDb(c.env.DB);

    const spaceScope = await resolveAppsSpaceScope(
      c,
      () =>
        appsRouteDeps.requireSpaceAccess(
          c,
          getRequestedSpaceIdentifier(c) || "",
          user.id,
        ),
    );
    const principalId = resolvePrincipalId(user);

    // Verify ownership - only workspace owner can delete apps
    const targetAccountId = spaceScope ? spaceScope.spaceId : principalId;
    const app = await db.select().from(appsTable).where(
      and(eq(appsTable.id, appId), eq(appsTable.accountId, targetAccountId)),
    ).get();

    if (!app) {
      await rejectManifestManagedAppMutationIfMatched(
        db,
        targetAccountId,
        appId,
      );
      throw new NotFoundError("App");
    }

    // Delete app files from R2 using batch delete
    const bucket = c.env.TENANT_SOURCE;
    if (bucket) {
      const prefix = `apps/${app.name}/`;
      const listed = await bucket.list({ prefix });
      if (listed.objects.length > 0) {
        // R2 supports batch delete - delete all keys at once
        await bucket.delete(
          listed.objects.map((obj: { key: string }) => obj.key),
        );
      }
    }

    // Delete from database
    await db.delete(appsTable).where(eq(appsTable.id, appId));

    return c.json({ success: true });
  });
}
