/**
 * Group Deploy -- resource provisioner.
 *
 * Orchestrates resource provisioning through a provider-agnostic
 * ResourceProvider interface. The provider is resolved automatically
 * from the supplied options and environment variables.
 */
import type { ProvisionedResource, ResourceProvisionResult } from './deploy-models.js';
import { toBinding } from './cloudflare-utils.js';
import type { ResourceProvider, ProviderOptions } from './resource-provider.js';
import { CloudflareProvider } from './providers/cloudflare.js';
import { AWSProvider } from './providers/aws.js';
import { GCPProvider } from './providers/gcp.js';
import { K8sProvider } from './providers/kubernetes.js';
import { DockerProvider } from './providers/docker.js';

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
  if (process.env.AWS_ACCESS_KEY_ID) {
    return new AWSProvider();
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new GCPProvider();
  }
  if (process.env.KUBECONFIG) {
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
  console.log(`[INFO] Detected provider: ${provider.name}${providerLabel === 'CLOUDFLARE' ? ' (CLOUDFLARE_ACCOUNT_ID set)' : ''}`);

  for (const [name, resource] of Object.entries(resources)) {
    const binding = resource.binding || toBinding(name);

    if (options.dryRun) {
      const dryId = `(dry-run) ${name}`;
      provisioned.set(name, { name, type: resource.type, id: dryId, binding });
      results.push({ name, type: resource.type, status: 'provisioned', id: dryId });
      continue;
    }

    try {
      let result;

      switch (resource.type) {
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
          result = provider.skipAutoConfigured(name, resource.type);
          break;
        }
        default: {
          results.push({ name, type: resource.type, status: 'failed', error: `Unsupported resource type: ${resource.type}` });
          continue;
        }
      }

      provisioned.set(name, { name: result.name, type: resource.type, id: result.id || name, binding });
      results.push({ name, type: resource.type, status: result.status, id: result.id, error: result.error });
    } catch (error) {
      results.push({ name, type: resource.type, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { provisioned, results };
}
