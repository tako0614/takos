/**
 * Group Deploy — resource provisioner.
 */
import { randomBytes } from 'node:crypto';

import type { ProvisionedResource, ResourceProvisionResult } from './deploy-models.js';
import { cfApi, execCommand, resourceCfName, toBinding } from './cloudflare-helpers.js';

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

  for (const [name, resource] of Object.entries(resources)) {
    const cfName = resourceCfName(options.groupName, options.env, name);
    const binding = resource.binding || toBinding(name);

    if (options.dryRun) {
      provisioned.set(name, { name: cfName, type: resource.type, id: `(dry-run) ${cfName}`, binding });
      results.push({ name, type: resource.type, status: 'provisioned', id: `(dry-run) ${cfName}` });
      continue;
    }

    try {
      switch (resource.type) {
        case 'd1': {
          const d1 = await cfApi<{ uuid: string }>(options.accountId, options.apiToken, 'POST', '/d1/database', { name: cfName });
          provisioned.set(name, { name: cfName, type: 'd1', id: d1.uuid, binding });
          results.push({ name, type: 'd1', status: 'provisioned', id: d1.uuid });
          break;
        }
        case 'r2': {
          await cfApi<unknown>(options.accountId, options.apiToken, 'POST', '/r2/buckets', { name: cfName });
          provisioned.set(name, { name: cfName, type: 'r2', id: cfName, binding });
          results.push({ name, type: 'r2', status: 'provisioned', id: cfName });
          break;
        }
        case 'kv': {
          const kv = await cfApi<{ id: string }>(options.accountId, options.apiToken, 'POST', '/storage/kv/namespaces', { title: cfName });
          provisioned.set(name, { name: cfName, type: 'kv', id: kv.id, binding });
          results.push({ name, type: 'kv', status: 'provisioned', id: kv.id });
          break;
        }
        case 'secretRef': {
          const secretValue = randomBytes(32).toString('hex');
          provisioned.set(name, { name: cfName, type: 'secretRef', id: secretValue, binding });
          results.push({ name, type: 'secretRef', status: 'provisioned', id: '(generated)' });
          break;
        }
        case 'queue': {
          const queueName = cfName;
          const { exitCode } = await execCommand(
            'npx', ['wrangler', 'queues', 'create', queueName],
            { env: { CLOUDFLARE_ACCOUNT_ID: options.accountId, CLOUDFLARE_API_TOKEN: options.apiToken } },
          );
          provisioned.set(name, { name: queueName, type: 'queue', id: queueName, binding });
          results.push({ name, type: 'queue', status: exitCode === 0 ? 'provisioned' : 'exists', id: queueName });
          break;
        }
        case 'vectorize': {
          const indexName = cfName;
          const dimensions = resource.vectorize?.dimensions || 1536;
          const metric = resource.vectorize?.metric || 'cosine';
          const { exitCode } = await execCommand(
            'npx', ['wrangler', 'vectorize', 'create', indexName, '--dimensions', String(dimensions), '--metric', metric],
            { env: { CLOUDFLARE_ACCOUNT_ID: options.accountId, CLOUDFLARE_API_TOKEN: options.apiToken } },
          );
          provisioned.set(name, { name: indexName, type: 'vectorize', id: indexName, binding });
          results.push({ name, type: 'vectorize', status: exitCode === 0 ? 'provisioned' : 'exists', id: indexName });
          break;
        }
        case 'analyticsEngine':
        case 'durableObject':
        case 'workflow': {
          provisioned.set(name, { name: cfName, type: resource.type, id: name, binding });
          results.push({ name, type: resource.type, status: 'skipped',
            error: `${resource.type} は wrangler deploy 時に自動設定されます` });
          break;
        }
        default: {
          results.push({ name, type: resource.type, status: 'failed', error: `Unsupported resource type: ${resource.type}` });
        }
      }
    } catch (error) {
      results.push({ name, type: resource.type, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { provisioned, results };
}
