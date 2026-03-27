import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { eq, and, or } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { generateId, now } from '../../../shared/utils';
import type { ManifestResources, ResourceProvisionResult } from './types';
import { logError } from '../../../shared/utils/logger';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';
import { provisionCloudflareResource, insertResource } from '../resources';
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
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
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
            const d1Name = `${safeName}-${d1Config.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: d1Name,
              type: 'd1',
              cfName: d1Name,
            });

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'd1', cfId: created.cfId || undefined, cfName: d1Name });

            result.d1.push({
              binding: d1Config.binding,
              id: created.cfId || '',
              name: d1Name,
              resourceId: created.id,
              wasAdopted: false,
            });

            if (d1Config.migrations) {
              if (!created.cfId) {
                throw new Error(`Provisioned D1 resource is missing Cloudflare database ID: ${d1Name}`);
              }
              await this.applyIncrementalMigrations(provider, created.cfId, d1Config.migrations, files, d1Config.binding);
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

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'r2', cfName: r2Name });

            result.r2.push({
              binding: r2Config.binding,
              name: r2Name,
              resourceId: created.id,
              wasAdopted: false,
            });
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

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'kv', cfId: created.cfId || undefined, cfName: kvName });

            result.kv.push({
              binding: kvConfig.binding,
              id: created.cfId || '',
              name: kvName,
              resourceId: created.id,
              wasAdopted: false,
            });
          }
        }
      }

      if (manifestResources.queue) {
        for (const queueConfig of manifestResources.queue) {
          const manifestKey = buildManifestKey(bundleKey, queueConfig.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'queue'))
          ).get();

          if (existing && (existing.cfId || existing.cfName)) {
            await db.update(resources).set({
              orphanedAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.queue.push({
              binding: queueConfig.binding,
              id: existing.cfId || existing.cfName || '',
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });
          } else {
            const queueName = `${safeName}-${queueConfig.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: queueName,
              type: 'queue',
              cfName: queueName,
              config: {
                ...(queueConfig.maxRetries != null ? { maxRetries: queueConfig.maxRetries } : {}),
                ...(queueConfig.deadLetterQueue ? { deadLetterQueue: queueConfig.deadLetterQueue } : {}),
                ...(queueConfig.deliveryDelaySeconds != null
                  ? { deliveryDelaySeconds: queueConfig.deliveryDelaySeconds }
                  : {}),
              },
              queue: queueConfig.deliveryDelaySeconds != null
                ? { deliveryDelaySeconds: queueConfig.deliveryDelaySeconds }
                : undefined,
            });

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'queue', cfId: created.cfId || undefined, cfName: queueName });

            result.queue.push({
              binding: queueConfig.binding,
              id: created.cfId || '',
              name: queueName,
              resourceId: created.id,
              wasAdopted: false,
            });
          }
        }
      }

      if (manifestResources.analyticsEngine) {
        for (const analyticsConfig of manifestResources.analyticsEngine) {
          const manifestKey = buildManifestKey(bundleKey, analyticsConfig.binding);
          const existing = await db.select().from(resources).where(
            and(
              eq(resources.manifestKey, manifestKey),
              or(eq(resources.type, 'analyticsEngine'), eq(resources.type, 'analytics_engine')),
            )
          ).get();

          if (existing) {
            await db.update(resources).set({
              orphanedAt: null,
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.analyticsEngine.push({
              binding: analyticsConfig.binding,
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });
          } else {
            const datasetName = (analyticsConfig.dataset || '').trim()
              || `${safeName}-${analyticsConfig.binding.toLowerCase()}-${suffix}`;
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: datasetName,
              type: 'analytics_engine',
              cfName: datasetName,
              config: {
                dataset: datasetName,
              },
              analyticsEngine: {
                dataset: datasetName,
              },
            });

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'analytics_engine', cfId: created.cfId || undefined, cfName: datasetName });

            result.analyticsEngine.push({
              binding: analyticsConfig.binding,
              name: datasetName,
              resourceId: created.id,
              wasAdopted: false,
            });
          }
        }
      }

      if (manifestResources.workflow) {
        for (const workflowConfig of manifestResources.workflow) {
          const manifestKey = buildManifestKey(bundleKey, workflowConfig.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'workflow'))
          ).get();

          const workflowName = `${safeName}-${workflowConfig.binding.toLowerCase()}-${suffix}`;
          const workflowConfigRecord = {
            service: workflowConfig.service,
            export: workflowConfig.export,
            ...(workflowConfig.timeoutMs != null ? { timeoutMs: workflowConfig.timeoutMs } : {}),
            ...(workflowConfig.maxRetries != null ? { maxRetries: workflowConfig.maxRetries } : {}),
          };

          if (existing) {
            await db.update(resources).set({
              orphanedAt: null,
              config: JSON.stringify(workflowConfigRecord),
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.workflow.push({
              binding: workflowConfig.binding,
              name: existing.name,
              resourceId: existing.id,
              wasAdopted: true,
            });
          } else {
            const created = await provisionCloudflareResource(this.env, {
              ownerId: userId,
              spaceId,
              name: workflowName,
              type: 'workflow',
              cfName: workflowName,
              config: workflowConfigRecord,
              workflow: workflowConfigRecord,
            });

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'workflow', cfId: created.cfId || undefined, cfName: workflowName });

            result.workflow.push({
              binding: workflowConfig.binding,
              name: workflowName,
              resourceId: created.id,
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

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, created.id));

            createdResources.push({ id: created.id, type: 'vectorize', cfId: created.cfId || undefined, cfName: vectorizeName });

            result.vectorize.push({
              binding: vectorizeConfig.binding,
              id: created.cfName,
              name: vectorizeName,
              resourceId: created.id,
              wasAdopted: false,
            });
          }
        }
      }

      if (manifestResources.durableObject) {
        for (const doConfig of manifestResources.durableObject) {
          const manifestKey = buildManifestKey(bundleKey, doConfig.binding);
          const existing = await db.select().from(resources).where(
            and(eq(resources.manifestKey, manifestKey), eq(resources.type, 'durable_object'))
          ).get();

          if (existing) {
            await db.update(resources).set({
              orphanedAt: null,
              config: JSON.stringify({ className: doConfig.className, ...(doConfig.scriptName ? { scriptName: doConfig.scriptName } : {}) }),
              updatedAt: new Date().toISOString(),
            }).where(eq(resources.id, existing.id));

            result.durableObject.push({
              binding: doConfig.binding,
              name: existing.name,
              resourceId: existing.id,
              className: doConfig.className,
              scriptName: doConfig.scriptName,
              wasAdopted: true,
            });
          } else {
            const doName = `${safeName}-${doConfig.binding.toLowerCase()}-${suffix}`;
            const id = generateId();
            const timestamp = now();

            await insertResource(this.env.DB, {
              id,
              owner_id: userId,
              name: doName,
              type: 'durable_object',
              status: 'active',
              cf_id: null,
              cf_name: doConfig.className,
              config: { className: doConfig.className, ...(doConfig.scriptName ? { scriptName: doConfig.scriptName } : {}) },
              space_id: spaceId,
              created_at: timestamp,
              updated_at: timestamp,
            });

            await db.update(resources).set({ manifestKey }).where(eq(resources.id, id));

            createdResources.push({ id, type: 'durable_object', cfName: doConfig.className });

            result.durableObject.push({
              binding: doConfig.binding,
              name: doName,
              resourceId: id,
              className: doConfig.className,
              scriptName: doConfig.scriptName,
              wasAdopted: false,
            });
          }
        }
      }

      return result;
    } catch (error) {
      logError('Resource provisioning failed, rolling back', error, { module: 'services/takopack/resources' });

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

  private async applyIncrementalMigrations(
    provider: CloudflareResourceService,
    databaseId: string,
    migrations: string,
    files: Map<string, ArrayBuffer>,
    bindingName: string
  ): Promise<{ applied: number; skipped: number }> {
    await provider.executeD1Query(databaseId, `
      CREATE TABLE IF NOT EXISTS _takos_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    const appliedRows = await provider.queryD1<{ filename: string; checksum: string }>(
      databaseId,
      'SELECT filename, checksum FROM _takos_migrations ORDER BY id'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.filename, r.checksum]));

    const sqlSources = this.resolveMigrationSqlSources(migrations, files);

    let applied = 0;
    let skipped = 0;

    for (const source of sqlSources) {
      const sql = source.sql.trim();
      if (!sql) continue;

      const checksum = await computeSHA256Hex(sql);
      const existingChecksum = appliedMap.get(source.source);

      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for "${source.source}" (binding: ${bindingName}). ` +
            `Expected ${existingChecksum}, got ${checksum}. Previously applied migrations must not be modified.`
          );
        }
        skipped++;
        continue;
      }

      try {
        await provider.executeD1Query(databaseId, sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to apply D1 migration (${bindingName}, ${source.source}): ${message}`);
      }

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
    if (!ref) return [];

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
      return [{ source: 'inline-sql', sql: ref }];
    }

    throw new Error(`Migration source not found in package: ${migrations}`);
  }
}
