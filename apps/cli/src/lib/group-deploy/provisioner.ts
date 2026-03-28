/**
 * Group Deploy — resource provisioner.
 */
import { randomBytes } from 'node:crypto';

import type { ProvisionedResource, ResourceProvisionResult } from './types.js';
import { cfApi, resourceCfName, toBinding } from './helpers.js';

// ── Resource Provisioner ─────────────────────────────────────────────────────

export async function provisionResources(
  resources: Record<string, { type: string; binding?: string }>,
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
