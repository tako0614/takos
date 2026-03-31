import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types/index.ts';
import { generateId } from '../../../shared/utils/index.ts';
import { getDb, files, apps } from '../../../infra/db/index.ts';
import { eq, and, like } from 'drizzle-orm';

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
};

export function normalizeDistPath(input: string): string {
  let normalized = input.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('Invalid dist_path');
  }
  return normalized;
}

export async function deployFrontendFromWorkspace(
  env: Env,
  input: {
    spaceId: string;
    appName: string;
    distPath: string;
    clear?: boolean;
    description?: string | null;
    icon?: string | null;
  }
) {
  const drizzle = getDb(env.DB);
  const appName = input.appName.trim();
  if (!appName) {
    throw new Error('app_name is required');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(appName)) {
    throw new Error('app_name must be 3-64 chars, lowercase alphanumeric and hyphen');
  }

  const distPath = normalizeDistPath(input.distPath);
  const bucket = env.TENANT_SOURCE;
  if (!bucket) {
    throw new Error('TENANT_SOURCE is not configured');
  }

  if (input.clear) {
    const existingObjs = await bucket.list({ prefix: `apps/${appName}/` });
    if (existingObjs.objects.length > 0) {
      await bucket.delete(existingObjs.objects.map((obj: { key: string }) => obj.key));
    }
  }

  // Get files from workspace
  const fileRows = await drizzle.select({
    id: files.id,
    path: files.path,
  }).from(files).where(and(eq(files.accountId, input.spaceId), like(files.path, `${distPath}/%`))).all();

  if (fileRows.length === 0) {
    throw new Error(`No files found under ${distPath}/`);
  }

  let uploaded = 0;
  for (const file of fileRows) {
    const relative = file.path.slice(`${distPath}/`.length);
    if (!relative) continue;

    const sourceKey = `spaces/${input.spaceId}/files/${file.id}`;
    const obj = await bucket.get(sourceKey);
    if (!obj) continue;

    const ext = relative.split('.').pop()?.toLowerCase() || 'txt';
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const destKey = `apps/${appName}/${relative}`;

    await bucket.put(destKey, obj.body, {
      httpMetadata: { contentType },
    });
    uploaded++;
  }

  const timestamp = new Date().toISOString();

  // Check if app exists
  const existingApp = await drizzle.select({ id: apps.id }).from(apps).where(and(eq(apps.accountId, input.spaceId), eq(apps.name, appName))).get();

  if (existingApp) {
    await drizzle.update(apps).set({
      description: input.description ?? null,
      icon: input.icon ?? null,
      updatedAt: timestamp,
    }).where(eq(apps.id, existingApp.id));
  } else {
    await drizzle.insert(apps).values({
      id: generateId(),
      accountId: input.spaceId,
      serviceId: null,
      name: appName,
      description: input.description ?? null,
      icon: input.icon ?? null,
      appType: 'custom',
      takosClientKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return {
    appName,
    uploaded,
    url: `/apps/${appName}/`,
  };
}
