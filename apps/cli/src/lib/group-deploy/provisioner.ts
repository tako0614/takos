/**
 * Group Deploy -- resource provisioner.
 *
 * Orchestrates resource provisioning through a provider-agnostic
 * ResourceProvider interface. The provider is resolved automatically
 * from the supplied options and environment variables.
 */
import type { ProvisionedResource, ResourceProvisionResult } from './deploy-models.ts';
import { toBinding } from './cloudflare-utils.ts';
import type { ResourceProvider, ProviderOptions } from './resource-provider.ts';
import { validateResourceName } from './resource-provider.ts';
import { CloudflareProvider } from './providers/cloudflare.ts';
import { AWSProvider } from './providers/aws.ts';
import { GCPProvider } from './providers/gcp.ts';
import { K8sProvider } from './providers/kubernetes.ts';
import { DockerProvider } from './providers/docker.ts';

const RESOURCE_TYPE_ALIAS: Record<string, string> = {
  secret_ref: 'secretRef',
  analytics_engine: 'analyticsEngine',
  workflow_binding: 'workflow',
  durable_object_namespace: 'durableObject',
  secret: 'secretRef',
  sql: 'd1',
  object_store: 'r2',
  vector_index: 'vectorize',
  analytics_store: 'analyticsEngine',
  workflow_runtime: 'workflow',
  durable_namespace: 'durableObject',
  vector_store: 'vectorize',
};

function canonicalizeResourceType(type: string): string {
  return RESOURCE_TYPE_ALIAS[type] ?? type;
}

// ── Provider resolution ──────────────────────────────────────────────────────

/**
 * Resolve the appropriate ResourceProvider from options / environment.
 *
 * Detection order:
 *   1. Cloudflare -- accountId + apiToken supplied (explicit or via env)
 *   2. AWS        -- AWS_ACCESS_KEY_ID is set
 *   3. GCP        -- GOOGLE_APPLICATION_CREDENTIALS is set
 *   4. K8s        -- KUBECONFIG is set
 *   5. Docker     -- fallback (local / self-hosted)
 */
export function resolveProvider(options: ProviderOptions): ResourceProvider {
  if (options.accountId && options.apiToken) {
    return new CloudflareProvider({
      accountId: options.accountId,
      apiToken: options.apiToken,
      groupName: options.groupName,
      env: options.env,
    });
  }
  if (Deno.env.get('AWS_ACCESS_KEY_ID')) {
    return new AWSProvider();
  }
  if (Deno.env.get('GOOGLE_APPLICATION_CREDENTIALS')) {
    return new GCPProvider();
  }
  if (Deno.env.get('KUBECONFIG')) {
    return new K8sProvider();
  }
  return new DockerProvider();
}

// ── Resource Provisioner ─────────────────────────────────────────────────────

export async function provisionResources(
  resources: Record<string, {
    type: string;
    binding?: string;
    vectorize?: { dimensions: number; metric: string };
    queue?: { maxRetries?: number; deadLetterQueue?: string };
  }>,
  options: { accountId: string; apiToken: string; groupName: string; env: string; dryRun?: boolean },
): Promise<{ provisioned: Map<string, ProvisionedResource>; results: ResourceProvisionResult[] }> {
  const provisioned = new Map<string, ProvisionedResource>();
  const results: ResourceProvisionResult[] = [];

  const provider = resolveProvider(options);
  const providerLabel = provider.name.toUpperCase();
  process.stderr.write(`[INFO] Detected provider: ${provider.name}${providerLabel === 'CLOUDFLARE' ? ' (CLOUDFLARE_ACCOUNT_ID set)' : ''}\n`);

  for (const [name, resource] of Object.entries(resources)) {
    validateResourceName(name);
    const resourceType = canonicalizeResourceType(resource.type);
    const binding = resource.binding || toBinding(name);

    if (options.dryRun) {
      const dryId = `(dry-run) ${name}`;
      provisioned.set(name, { name, type: resourceType, id: dryId, binding });
      results.push({ name, type: resourceType, status: 'provisioned', id: dryId });
      continue;
    }

    try {
      let result;

      switch (resourceType) {
        case 'd1': {
          result = await provider.createDatabase(name);
          break;
        }
        case 'r2': {
          result = await provider.createObjectStorage(name);
          break;
        }
        case 'kv': {
          result = await provider.createKeyValueStore(name);
          break;
        }
        case 'queue': {
          result = await provider.createQueue(name, resource.queue);
          break;
        }
        case 'vectorize': {
          const dimensions = resource.vectorize?.dimensions || 1536;
          const metric = resource.vectorize?.metric || 'cosine';
          result = await provider.createVectorIndex(name, { dimensions, metric });
          break;
        }
        case 'secretRef': {
          result = await provider.createSecret(name, binding);
          break;
        }
        case 'analyticsEngine':
        case 'durableObject':
        case 'workflow': {
          result = provider.skipAutoConfigured(name, resourceType);
          break;
        }
        default: {
          results.push({ name, type: resourceType, status: 'failed', error: `Unsupported resource type: ${resourceType}` });
          continue;
        }
      }

      provisioned.set(name, { name: result.name, type: resourceType, id: result.id || name, binding });
      results.push({ name, type: resourceType, status: result.status, id: result.id, error: result.error });
    } catch (error) {
      results.push({ name, type: resourceType, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { provisioned, results };
}
