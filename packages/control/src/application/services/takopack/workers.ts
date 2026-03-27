import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import {
  services,
  serviceBindings,
  physicalServices,
  physicalServiceBindings,
} from '../../../infra/db/schema-services';
import { eq, and, or, isNull } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { generateId, now } from '../../../shared/utils';
import { filterBindingsByCapabilities, type StandardCapabilityId } from '../platform/capabilities';
import { createDeploymentService } from '../deployment';
import type {
  TakopackManifest,
  ResourceProvisionResult,
  WorkerDeploymentResult,
  ResolvedWorkerResourceBinding,
} from './types';
import {
  getRequiredPackageFile,
  decodeArrayBuffer,
  assertManifestWorkerBundleIntegrity,
} from './manifest';

export class TakopackWorkerService {
  constructor(private env: Env) {}

  async deployManifestWorkers(params: {
    spaceId: string;
    takopackId: string;
    packageName: string;
    capabilities: string[];
    workers: NonNullable<TakopackManifest['workers']>;
    files: Map<string, ArrayBuffer>;
    sharedEnv?: Record<string, string>;
    provisionedResources?: ResourceProvisionResult;
    oauthClientId?: string;
    oauthClientSecret?: string;
    hostnameHint?: string;
    serviceBindingOverrides?: Record<string, string>;
  }): Promise<WorkerDeploymentResult[]> {
    const db = getDb(this.env.DB);
    const deploymentService = createDeploymentService(this.env);
    const isSingleWorker = params.workers.length === 1;
    const deployed: WorkerDeploymentResult[] = [];

    for (const workerConfig of params.workers) {
      const workerId = generateId();
      const workerName = `worker-${workerId}`;
      const slug = buildWorkerSlug(params.packageName, workerConfig.name, workerId);
      const hostname = this.buildWorkerHostname(slug, params.hostnameHint, isSingleWorker);
      const workerBindingConfig = workerConfig.bindings || {
        d1: [],
        r2: [],
        kv: [],
        queue: [],
        analytics: [],
        workflows: [],
        vectorize: [],
      };
      if ((workerConfig.triggers?.schedules?.length || 0) > 0 || (workerConfig.triggers?.queues?.length || 0) > 0) {
        throw new Error(
          `Scheduled and queue trigger delivery require Takos-managed orchestration and are not supported yet ` +
          `(${workerConfig.name}).`
        );
      }
      const workerScriptBuffer = getRequiredPackageFile(
        params.files,
        workerConfig.bundle,
        `Worker bundle not found: ${workerConfig.bundle}`
      );
      await assertManifestWorkerBundleIntegrity(workerConfig, workerScriptBuffer);
      const workerScript = decodeArrayBuffer(workerScriptBuffer);

      const resourceBindings = await this.resolveManifestWorkerResourceBindings(
        params.spaceId,
        workerBindingConfig,
        params.provisionedResources
      );
      const sharedEnv = { ...(params.sharedEnv || {}) };

      const envBindings = buildWorkerEnvBindings(
        sharedEnv,
        workerConfig.env,
        params.oauthClientId,
        params.oauthClientSecret
      );
      const workerConfigJson = JSON.stringify({
        source: 'bundle_deployment',
        bundle_deployment_id: params.takopackId,
        manifest_worker_name: workerConfig.name,
        bundle_path: workerConfig.bundle,
        bundle_hash: workerConfig.bundleHash,
        bundle_size: workerConfig.bundleSize,
        capabilities: params.capabilities,
      });
      const timestamp = now();

      await db.insert(physicalServices).values({
        id: workerId,
        accountId: params.spaceId,
        serviceType: 'service',
        status: 'pending',
        config: workerConfigJson,
        hostname,
        routeRef: workerName,
        slug,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      try {
        const serviceBindingSpecs: WorkerBinding[] = [];

        for (const bindingName of workerBindingConfig.services || []) {
          const name = bindingName.trim();
          if (!name) continue;
          const overriddenService = params.serviceBindingOverrides?.[name];
          if (overriddenService) {
            serviceBindingSpecs.push({ type: 'service', name, service: overriddenService });
          }
        }

        const combinedBindings: WorkerBinding[] = [
          ...serviceBindingSpecs,
          ...resourceBindings.map(binding => binding.wfpBinding),
          ...envBindings,
        ];

        const { allowedBindings, deniedBindings } = filterBindingsByCapabilities({
          bindings: combinedBindings,
          allowed: new Set(params.capabilities as StandardCapabilityId[]),
        });

        if (deniedBindings.length > 0) {
          const deniedSummary = deniedBindings
            .map(b => `${b.type}:${b.name}`)
            .slice(0, 20)
            .join(', ');
          throw new Error(
            `Worker bindings denied by capability policy (count=${deniedBindings.length}): ${deniedSummary}`
          );
        }

        if (resourceBindings.length > 0) {
          const bindingTimestamp = now();
          await db.insert(physicalServiceBindings).values(
            resourceBindings.map((binding) => ({
              id: generateId(),
              serviceId: workerId,
              resourceId: binding.resourceId,
              bindingName: binding.bindingName,
              bindingType: binding.bindingType,
              config: '{}',
              createdAt: bindingTimestamp,
            })),
          );
        }

        const deployment = await deploymentService.createDeployment({
          workerId,
          spaceId: params.spaceId,
          userId: null,
          bundleContent: workerScript,
          strategy: 'direct',
          deployMessage: `Install bundle deployment ${params.packageName}:${params.takopackId}`,
          snapshotOverride: {
            envVars: buildEnvVarSnapshot(allowedBindings),
            bindings: allowedBindings,
          },
        });
        const executedDeployment = await deploymentService.executeDeployment(deployment.id);
        const artifactRef = executedDeployment.artifact_ref;
        if (!artifactRef) {
          throw new Error(`Bundle deployment ${deployment.id} completed without artifact_ref`);
        }

        deployed.push({
          manifestWorkerName: workerConfig.name,
          workerId,
          workerName,
          artifactRef,
          slug,
          hostname,
        });
      } catch (error) {
        try {
          await db.delete(physicalServiceBindings).where(eq(physicalServiceBindings.serviceId, workerId));
        } catch {
          // best effort cleanup
        }

        try {
          await db.update(services).set({
            status: 'failed',
            updatedAt: now(),
          }).where(eq(services.id, workerId));
        } catch {
          // best-effort status update
        }
        throw error;
      }
    }

    return deployed;
  }

  private async resolveManifestWorkerResourceBindings(
    spaceId: string,
    bindings: {
      d1: string[];
      r2: string[];
      kv: string[];
      queue?: string[];
      analytics?: string[];
      workflows?: string[];
      vectorize?: string[];
      durableObjects?: string[];
    },
    provisionedResources?: ResourceProvisionResult
  ): Promise<ResolvedWorkerResourceBinding[]> {
    const resolved: ResolvedWorkerResourceBinding[] = [];
    const usedBindingNames = new Set<string>();

    const resourceTypeConfigs = [
      {
        type: 'd1' as const,
        names: bindings.d1 || [],
        toWfpBinding: (name: string, resource: { cfId?: string }) => {
          if (!resource.cfId) throw new Error(`D1 resource is missing Cloudflare database ID: ${name}`);
          return { type: 'd1' as const, name, database_id: resource.cfId };
        },
      },
      {
        type: 'r2' as const,
        names: bindings.r2 || [],
        toWfpBinding: (name: string, resource: { cfName?: string }) => {
          if (!resource.cfName) throw new Error(`R2 resource is missing Cloudflare bucket name: ${name}`);
          return { type: 'r2_bucket' as const, name, bucket_name: resource.cfName };
        },
      },
      {
        type: 'kv' as const,
        names: bindings.kv || [],
        toWfpBinding: (name: string, resource: { cfId?: string }) => {
          if (!resource.cfId) throw new Error(`KV resource is missing Cloudflare namespace ID: ${name}`);
          return { type: 'kv_namespace' as const, name, namespace_id: resource.cfId };
        },
      },
      {
        type: 'queue' as const,
        names: bindings.queue || [],
        toWfpBinding: (name: string, resource: { cfName?: string; config?: Record<string, unknown> }) => {
          if (!resource.cfName) throw new Error(`Queue resource is missing Cloudflare queue name: ${name}`);
          const rawDelay = resource.config?.deliveryDelaySeconds;
          const deliveryDelay = typeof rawDelay === 'number'
            ? rawDelay
            : typeof rawDelay === 'string'
              ? Number(rawDelay)
              : undefined;
          return {
            type: 'queue' as const,
            name,
            queue_name: resource.cfName,
            ...(typeof deliveryDelay === 'number' && Number.isFinite(deliveryDelay)
              ? { delivery_delay: Math.floor(deliveryDelay) }
              : {}),
          };
        },
      },
      {
        type: 'analytics_engine' as const,
        names: bindings.analytics || [],
        toWfpBinding: (name: string, resource: { cfName?: string }) => {
          if (!resource.cfName) throw new Error(`Analytics Engine resource is missing dataset name: ${name}`);
          return { type: 'analytics_engine' as const, name, dataset: resource.cfName };
        },
        resolveType: 'analytics_engine' as const,
      },
      {
        type: 'workflow' as const,
        names: bindings.workflows || [],
        toWfpBinding: (name: string) => {
          throw new Error(
            `Workflow resources can be provisioned, but workflow bindings are not materialized into tenant worker runtime bindings yet (${name}). ` +
            `Declare the workflow resource in the manifest, then invoke it through Takos-managed workflow APIs.`,
          );
        },
      },
      {
        type: 'vectorize' as const,
        names: bindings.vectorize || [],
        toWfpBinding: (name: string, resource: { cfName?: string }) => {
          if (!resource.cfName) throw new Error(`Vectorize resource is missing Cloudflare index name: ${name}`);
          return { type: 'vectorize' as const, name, index_name: resource.cfName };
        },
      },
      {
        type: 'durable_object' as const,
        names: bindings.durableObjects || [],
        toWfpBinding: (name: string, resource: { cfName?: string; config?: Record<string, unknown> }) => {
          const className = resource.config?.className as string | undefined || resource.cfName;
          if (!className) throw new Error(`Durable Object resource is missing class name: ${name}`);
          const scriptName = resource.config?.scriptName as string | undefined;
          return {
            type: 'durable_object_namespace' as const,
            name,
            class_name: className,
            ...(scriptName ? { script_name: scriptName } : {}),
          };
        },
        resolveType: 'durable_object' as const,
      },
    ] as const;

    for (const config of resourceTypeConfigs) {
      for (const bindingNameRaw of config.names) {
        const bindingName = bindingNameRaw.trim();
        if (!bindingName) continue;
        if (usedBindingNames.has(bindingName)) {
          throw new Error(`Duplicate worker binding name: ${bindingName}`);
        }
        usedBindingNames.add(bindingName);

        // Workflow bindings are validated via toWfpBinding before resource resolution
        // to avoid unnecessary DB queries for unsupported binding types.
        if (config.type === 'workflow') {
          (config.toWfpBinding as (name: string) => never)(bindingName);
          continue;
        }

        const resource = await this.resolveResourceReferenceForWorkerBinding(
          spaceId,
          ('resolveType' in config ? config.resolveType : config.type),
          bindingName,
          provisionedResources
        );

        resolved.push({
          bindingType: config.type as ResolvedWorkerResourceBinding['bindingType'],
          bindingName,
          resourceId: resource.resourceId,
          wfpBinding: config.toWfpBinding(bindingName, resource),
        });
      }
    }

    return resolved;
  }

  private async resolveResourceReferenceForWorkerBinding(
    spaceId: string,
    type: 'd1' | 'r2' | 'kv' | 'queue' | 'analyticsEngine' | 'analytics_engine' | 'workflow' | 'vectorize' | 'durable_object' | 'durableObject',
    reference: string,
    provisionedResources?: ResourceProvisionResult
  ): Promise<{ resourceId: string; cfId?: string; cfName?: string; config?: Record<string, unknown> }> {
    const ref = reference.trim();

    const provisionedKey = type === 'analytics_engine' ? 'analyticsEngine' : type === 'durable_object' ? 'durableObject' : type;
    const provisioned = provisionedResources?.[provisionedKey] || [];
    for (const resource of provisioned) {
      const candidates = [resource.binding, resource.name, resource.resourceId];
      if ('id' in resource) candidates.push((resource as { id: string }).id);
      if (candidates.includes(ref)) {
        const dbForProvisioned = getDb(this.env.DB);
        const resourceRow = await dbForProvisioned.select({
          id: resources.id,
          cfId: resources.cfId,
          cfName: resources.cfName,
          config: resources.config,
        }).from(resources).where(eq(resources.id, resource.resourceId)).get();

        return {
          resourceId: resource.resourceId,
          cfId: resourceRow?.cfId || ('id' in resource ? (resource as { id: string }).id : undefined),
          cfName: resourceRow?.cfName || resource.name,
          config: resourceRow?.config ? (() => { try { return JSON.parse(resourceRow.config!) as Record<string, unknown>; } catch { return undefined; } })() : undefined,
        };
      }
    }

    const db = getDb(this.env.DB);

    const refConditions = type !== 'r2'
      ? or(
          eq(resources.id, ref),
          eq(resources.name, ref),
          eq(resources.cfName, ref),
          eq(resources.cfId, ref),
        )
      : or(
          eq(resources.id, ref),
          eq(resources.name, ref),
          eq(resources.cfName, ref),
        );

    const storageType = type === 'analyticsEngine' ? 'analytics_engine' : type;

    const resource = await db.select({
      id: resources.id,
      cfId: resources.cfId,
      cfName: resources.cfName,
      config: resources.config,
    }).from(resources).where(
      and(
        eq(resources.type, storageType),
        eq(resources.status, 'active'),
        refConditions,
        or(eq(resources.accountId, spaceId), isNull(resources.accountId)),
      )
    ).get();

    if (!resource) {
      throw new Error(`Resource not found for ${type} binding: ${ref}`);
    }

    return {
      resourceId: resource.id,
      cfId: resource.cfId || undefined,
      cfName: resource.cfName || undefined,
      config: resource.config ? (() => { try { return JSON.parse(resource.config!) as Record<string, unknown>; } catch { return undefined; } })() : undefined,
    };
  }

  private buildWorkerHostname(
    slug: string,
    hostnameHint: string | undefined,
    isSingleWorker: boolean
  ): string {
    if (hostnameHint && isSingleWorker) {
      const normalizedHint = hostnameHint
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');
      if (normalizedHint) {
        return normalizedHint;
      }
    }
    return `${slug}.${this.env.TENANT_BASE_DOMAIN}`.toLowerCase();
  }
}

export function buildWorkerSlug(packageName: string, workerName: string, workerId: string): string {
  const base = `${packageName}-${workerName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const suffix = workerId.toLowerCase().slice(0, 6);
  const candidate = `${base || 'worker'}-${suffix}`
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return candidate.length >= 3 ? candidate : `worker-${suffix}`;
}

export function buildWorkerEnvBindings(
  defaults: Record<string, string>,
  workerEnv: Record<string, string>,
  oauthClientId?: string,
  oauthClientSecret?: string
): WorkerBinding[] {
  const merged = new Map<string, { type: 'plain_text' | 'secret_text'; text: string }>();

  for (const source of [defaults, workerEnv]) {
    for (const [name, value] of Object.entries(source || {})) {
      const key = name.trim();
      if (key) merged.set(key, { type: 'plain_text', text: value });
    }
  }

  if (oauthClientId) {
    merged.set('CLIENT_ID', { type: 'plain_text', text: oauthClientId });
  }
  if (oauthClientSecret) {
    merged.set('CLIENT_SECRET', { type: 'secret_text', text: oauthClientSecret });
  }

  return Array.from(merged.entries()).map(([name, binding]) => ({
    type: binding.type,
    name,
    text: binding.text,
  }));
}

function buildEnvVarSnapshot(bindings: WorkerBinding[]): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const binding of bindings) {
    if (binding.type === 'plain_text' || binding.type === 'secret_text') {
      envVars[binding.name] = binding.text ?? '';
    }
  }
  return envVars;
}
