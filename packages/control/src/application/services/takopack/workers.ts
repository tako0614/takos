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
      const workerBindingConfig = workerConfig.bindings || { d1: [], r2: [], kv: [], vectorize: [] };
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
    bindings: { d1: string[]; r2: string[]; kv: string[]; vectorize?: string[] },
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
        type: 'vectorize' as const,
        names: bindings.vectorize || [],
        toWfpBinding: (name: string, resource: { cfName?: string }) => {
          if (!resource.cfName) throw new Error(`Vectorize resource is missing Cloudflare index name: ${name}`);
          return { type: 'vectorize' as const, name, index_name: resource.cfName };
        },
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

        const resource = await this.resolveResourceReferenceForWorkerBinding(
          spaceId,
          config.type,
          bindingName,
          provisionedResources
        );

        resolved.push({
          bindingType: config.type,
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
    type: 'd1' | 'r2' | 'kv' | 'vectorize',
    reference: string,
    provisionedResources?: ResourceProvisionResult
  ): Promise<{ resourceId: string; cfId?: string; cfName?: string }> {
    const ref = reference.trim();

    const provisioned = provisionedResources?.[type] || [];
    for (const resource of provisioned) {
      const candidates = [resource.binding, resource.name, resource.resourceId];
      if ('id' in resource) candidates.push((resource as { id: string }).id);
      if (candidates.includes(ref)) {
        return {
          resourceId: resource.resourceId,
          cfId: 'id' in resource ? (resource as { id: string }).id : undefined,
          cfName: resource.name,
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

    const resource = await db.select({
      id: resources.id,
      cfId: resources.cfId,
      cfName: resources.cfName,
    }).from(resources).where(
      and(
        eq(resources.type, type),
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
