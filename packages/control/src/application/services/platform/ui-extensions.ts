/**
 * UI Extension Service
 *
 * bundle deployment による UI 拡張の管理
 */

import { getDb, uiExtensions } from '../../../infra/db';
import { eq, and, isNotNull, asc, count as drizzleCount } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { R2Bucket } from '../../../shared/types/bindings.ts';
import { textDate } from '../../../shared/utils/db-guards';

export interface UIExtension {
  id: string;
  spaceId: string;
  path: string;
  label: string;
  icon?: string;
  bundleR2Key: string;
  sidebar?: {
    label: string;
    icon: string;
    path?: string;
    url?: string;
  };
  bundleDeploymentId?: string;
  createdAt: string;
}

export interface UIExtensionWithBundle extends UIExtension {
  bundleUrl?: string;
}

function parseSidebarJson(json: string): UIExtension['sidebar'] | undefined {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    if (typeof parsed.label !== 'string' || typeof parsed.icon !== 'string') return undefined;
    return parsed as UIExtension['sidebar'];
  } catch {
    return undefined;
  }
}

function mapUIExtension(ext: {
  id: string;
  accountId: string;
  path: string;
  label: string;
  icon: string | null;
  bundleR2Key: string;
  sidebarJson: string | null;
  bundleDeploymentId: string | null;
  createdAt: Date | string;
}): UIExtension {
  return {
    id: ext.id,
    spaceId: ext.accountId,
    path: ext.path,
    label: ext.label,
    icon: ext.icon || undefined,
    bundleR2Key: ext.bundleR2Key,
    sidebar: ext.sidebarJson ? parseSidebarJson(ext.sidebarJson) : undefined,
    bundleDeploymentId: ext.bundleDeploymentId || undefined,
    createdAt: textDate(ext.createdAt),
  };
}

function mapUIExtensionPersistenceRow(ext: {
  id: string;
  accountId: string;
  path: string;
  label: string;
  icon: string | null;
  bundleR2Key: string;
  sidebarJson: string | null;
  bundleDeploymentId: string | null;
  createdAt: Date | string;
}) {
  return {
    ...ext,
    bundleDeploymentId: ext.bundleDeploymentId,
  };
}

/**
 * List all UI extensions for a workspace
 */
export async function listUIExtensions(
  db: D1Database,
  spaceId: string
): Promise<UIExtension[]> {
  const drizzle = getDb(db);

  const extensions = await drizzle.select().from(uiExtensions).where(eq(uiExtensions.accountId, spaceId)).orderBy(asc(uiExtensions.path)).all();

  return extensions.map((ext) => mapUIExtension(mapUIExtensionPersistenceRow(ext)));
}

/**
 * Get a single UI extension by path
 */
export async function getUIExtensionByPath(
  db: D1Database,
  spaceId: string,
  path: string
): Promise<UIExtension | null> {
  const drizzle = getDb(db);

  const ext = await drizzle.select().from(uiExtensions).where(and(eq(uiExtensions.accountId, spaceId), eq(uiExtensions.path, path))).get();

  if (!ext) return null;
  return mapUIExtension(mapUIExtensionPersistenceRow(ext));
}

/**
 * Get UI extension bundle content from R2
 */
export async function getUIExtensionBundle(
  db: D1Database,
  storage: R2Bucket,
  spaceId: string,
  path: string
): Promise<{ content: ArrayBuffer; contentType: string } | null> {
  const ext = await getUIExtensionByPath(db, spaceId, path);

  if (!ext) return null;

  const object = await storage.get(ext.bundleR2Key);

  if (!object) return null;

  return {
    content: await object.arrayBuffer(),
    contentType: object.httpMetadata?.contentType || 'application/javascript',
  };
}

/**
 * Get sidebar items for workspace (from all UI extensions)
 */
export async function getUISidebarItems(
  db: D1Database,
  spaceId: string
): Promise<Array<{ label: string; icon: string; path?: string; url?: string; extensionId: string }>> {
  const drizzle = getDb(db);

  const extensions = await drizzle.select().from(uiExtensions).where(and(eq(uiExtensions.accountId, spaceId), isNotNull(uiExtensions.sidebarJson))).all();

  return extensions
    .filter(ext => ext.sidebarJson)
    .map(ext => {
      const sidebar = parseSidebarJson(ext.sidebarJson!);
      if (!sidebar) return null;
      return {
        ...sidebar,
        extensionId: ext.id,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

/**
 * Check if a path is registered as a UI extension
 */
export async function isUIExtensionPath(
  db: D1Database,
  spaceId: string,
  path: string
): Promise<boolean> {
  const drizzle = getDb(db);

  const result = await drizzle.select({ count: drizzleCount() }).from(uiExtensions).where(and(eq(uiExtensions.accountId, spaceId), eq(uiExtensions.path, path))).get();

  return (result?.count ?? 0) > 0;
}

/**
 * Get all registered extension paths for a workspace
 */
export async function getUIExtensionPaths(
  db: D1Database,
  spaceId: string
): Promise<string[]> {
  const drizzle = getDb(db);

  const extensions = await drizzle.select({ path: uiExtensions.path }).from(uiExtensions).where(eq(uiExtensions.accountId, spaceId)).all();

  return extensions.map(ext => ext.path);
}
