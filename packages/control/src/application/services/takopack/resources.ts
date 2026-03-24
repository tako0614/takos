import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { eq, and, like, isNotNull } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import type { ManifestResources, ResourceProvisionResult } from './types';
import { logError, logWarn } from '../../../shared/utils/logger';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';
import { provisionCloudflareResource } from '../resources';
import {
  getPackageFile,
  normalizePackagePath,
  normalizePackageDirectory,
  decodeArrayBuffer,
  looksLikeSQL,
} from './manifest';

function buildManifestKey(bundleKey: string, binding: string): string {
  return `takopack:${bundleKey}:${binding}`;
}

async function computeSHA256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class TakopackResourceService {
  constructor(private env: Env) {}

  /**
   * Provision new resources or adopt existing ones matched by manifest_key.
   * On update, existing D1/R2/KV resources are reused instead of recreated.
   */
  async provisionOrAdoptResources(
    spaceId: string,
    userId: string,
    packageName: string,
    bundleKey: string,
    bundleDeploymentId: string,
    manifestResources: ManifestResources,
    files: Map<string, ArrayBuffer>
  ): Promise<ResourceProvisionResult> {
    const provider = new CloudflareResourceService(this.env);
    const db = getDb(this.env.DB);

    const safeName = packageName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);

    const suffix = generateId(6).toLowerCase();

    const result: ResourceProvisionResult = {
      d1: [],
      r2: [],
      kv: [],
      vectorize: [],
    };

    const createdResources: Array<{ id: string; type: string; cfId?: string; cfName?: string }> = [];

    try {
      if (manifestResources.d1) {
        for (const d1Config of manifestResources.d1) {
          const manifestKey = buildManifestKey(bundleKey, d1Config.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'd1'))
          ).get();

          if (existing && existing.cfId) {
            // Adopt existing resource
            await db.update(resources).set({
              orphanedAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.d1.push({
              binding: d1Config.binding,
              id: existing.cfId,
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });

            if (d1Config.migrations) {
              await this.applyIncrementalMigrations(provider, existing.cfId, d1Config.migrations, files, d1Config.binding);
            }
          } else {
            // Provision new resource
            const d1Name = `${safeName}-${d1Config.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: d1Name,
              type: 'd1',
              cfName: d1Name,
            });
            const d1Id = created.cfId;
            const resourceId = created.id;

            // Set manifest_key on newly created resource
            await db.update(resources).set({ manifestKey }).where(eq(resources.id, resourceId));

            createdResources.push({ id: resourceId, type: 'd1', cfId: d1Id || undefined, cfName: d1Name });

            result.d1.push({
              binding: d1Config.binding,
              id: d1Id || '',
              name: d1Name,
              resourceId,
              wasAdopted: false,
            });

            if (d1Config.migrations) {
              if (!d1Id) {
                throw new Error(`Provisioned D1 resource is missing Cloudflare database ID: ${d1Name}`);
              }
              await this.applyIncrementalMigrations(provider, d1Id, d1Config.migrations, files, d1Config.binding);
            }
          }
        }
      }

      if (manifestResources.r2) {
        for (const r2Config of manifestResources.r2) {
          const manifestKey = buildManifestKey(bundleKey, r2Config.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'r2'))
          ).get();

          if (existing) {
            await db.update(resources).set({
              orphanedAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.r2.push({
              binding: r2Config.binding,
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });
          } else {
            const r2Name = `${safeName}-${r2Config.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: r2Name,
              type: 'r2',
              cfName: r2Name,
            });
            const resourceId = created.id;

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, resourceId));

            createdResources.push({ id: resourceId, type: 'r2', cfName: r2Name });

            result.r2.push({ binding: r2Config.binding, name: r2Name, resourceId, wasAdopted: false });
          }
        }
      }

      if (manifestResources.kv) {
        for (const kvConfig of manifestResources.kv) {
          const manifestKey = buildManifestKey(bundleKey, kvConfig.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'kv'))
          ).get();

          if (existing && existing.cfId) {
            await db.update(resources).set({
              orphanedAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.kv.push({
              binding: kvConfig.binding,
              id: existing.cfId,
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });
          } else {
            const kvName = `${safeName}-${kvConfig.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: kvName,
              type: 'kv',
              cfName: kvName,
            });
            const kvId = created.cfId;
            const resourceId = created.id;

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, resourceId));

            createdResources.push({ id: resourceId, type: 'kv', cfId: kvId || undefined, cfName: kvName });

            result.kv.push({
              binding: kvConfig.binding,
              id: kvId || '',
              name: kvName,
              resourceId,
              wasAdopted: false,
            });
          }
        }
      }

      if (manifestResources.vectorize) {
        for (const vectorizeConfig of manifestResources.vectorize) {
          const manifestKey = buildManifestKey(bundleKey, vectorizeConfig.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'vectorize'))
          ).get();

          if (existing) {
            await db.update(resources).set({
              orphanedAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.vectorize.push({
              binding: vectorizeConfig.binding,
              id: existing.cfName || existing.cfId || '',
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });
          } else {
            const vectorizeName = `${safeName}-${vectorizeConfig.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: vectorizeName,
              type: 'vectorize',
              cfName: vectorizeName,
              ...(vectorizeConfig.dimensions || vectorizeConfig.metric
                ? {
                    vectorize: {
                      dimensions: vectorizeConfig.dimensions ?? 1536,
                      metric: vectorizeConfig.metric ?? 'cosine',
                    },
                  }
                : {}),
            });
            const resourceId = created.id;

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, resourceId));

            createdResources.push({ id: resourceId, type: 'vectorize', cfId: created.cfId || undefined, cfName: vectorizeName });

            result.vectorize.push({
              binding: vectorizeConfig.binding,
              id: created.cfName,
              name: vectorizeName,
              resourceId,
              wasAdopted: false,
            });
          }
        }
      }

      return result;
    } catch (error) {
      logError('Resource provisioning failed, rolling back', error, { module: 'services/takopack/resources' });

      // Only rollback newly created resources, not adopted ones
      for (const resource of createdResources) {
        try {
          await provider.deleteResource({
            type: resource.type,
            cfId: resource.cfId,
            cfName: resource.cfName,
          });
          await db.delete(resources).where(eq(resources.id, resource.id));
        } catch (rollbackError) {
          logError(`Failed to rollback resource ${resource.id}`, rollbackError, { module: 'services/takopack/resources' });
        }
      }

      throw error;
    }
  }

  /**
   * Apply D1 migrations incrementally using a _takos_migrations tracking table.
   * Already-applied migrations are skipped; modified migrations cause an error.
   */
  private async applyIncrementalMigrations(
    provider: CloudflareResourceService,
    databaseId: string,
    migrations: string,
    files: Map<string, ArrayBuffer>,
    bindingName: string
  ): Promise<{ applied: number; skipped: number }> {
    // Ensure tracking table exists
    await provider.executeD1Query(databaseId, `
      CREATE TABLE IF NOT EXISTS _takos_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    // Fetch already-applied migrations
    const appliedRows = await provider.queryD1<{ filename: string; checksum: string }>(
      databaseId,
      'SELECT filename, checksum FROM _takos_migrations ORDER BY id'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.filename, r.checksum]));

    // Resolve migration SQL sources
    const sqlSources = this.resolveMigrationSqlSources(migrations, files);

    let applied = 0;
    let skipped = 0;

    for (const source of sqlSources) {
      const sql = source.sql.trim();
      if (!sql) continue;

      const checksum = await computeSHA256Hex(sql);
      const existingChecksum = appliedMap.get(source.source);

      if (existingChecksum) {
        // Already applied — verify integrity
        if (existingChecksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for "${source.source}" (binding: ${bindingName}). ` +
            `Expected ${existingChecksum}, got ${checksum}. ` +
            `Previously applied migrations must not be modified.`
          );
        }
        skipped++;
        continue;
      }

      // Apply the migration
      try {
        await provider.executeD1Query(databaseId, sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to apply D1 migration (${bindingName}, ${source.source}): ${message}`);
      }

      // Record it
      const escapedFilename = source.source.replace(/'/g, "''");
      const escapedChecksum = checksum.replace(/'/g, "''");
      await provider.executeD1Query(databaseId,
        `INSERT INTO _takos_migrations (filename, checksum, applied_at) VALUES ('${escapedFilename}', '${escapedChecksum}', '${new Date().toISOString()}')`
      );
      applied++;
    }

    return { applied, skipped };
  }

  private resolveMigrationSqlSources(
    migrations: string,
    files: Map<string, ArrayBuffer>
  ): Array<{ source: string; sql: string }> {
    const ref = migrations.trim();
    if (!ref) {
      return [];
    }

    const directFile = getPackageFile(files, ref);
    if (directFile) {
      return [{
        source: normalizePackagePath(ref),
        sql: decodeArrayBuffer(directFile),
      }];
    }

    const directoryPrefix = normalizePackageDirectory(ref);
    const migrationFiles = Array.from(files.entries())
      .map(([path, content]) => ({
        normalizedPath: normalizePackagePath(path),
        content,
      }))
      .filter(file =>
        file.normalizedPath.startsWith(directoryPrefix) &&
        file.normalizedPath.toLowerCase().endsWith('.sql')
      )
      .sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));

    if (migrationFiles.length > 0) {
      return migrationFiles.map(file => ({
        source: file.normalizedPath,
        sql: decodeArrayBuffer(file.content),
      }));
    }

    if (looksLikeSQL(ref)) {
      return [{
        source: 'inline-sql',
        sql: ref,
      }];
    }

    throw new Error(`Migration source not found in package: ${migrations}`);
  }
}
