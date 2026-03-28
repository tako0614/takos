/**
 * Resource Provisioner for group deploy.
 *
 * Provisions Cloudflare resources (D1, R2, KV) from app.yml resource
 * definitions, and generates secret values for secretRef resources.
 *
 * For D1/R2/KV: delegates to the Cloudflare Management API via CloudflareApiClient.
 * For secretRef with generate: creates a random token value.
 */
import { randomBytes } from 'node:crypto';
import type { AppResource } from './group-deploy-manifest.js';
import type {
  ProvisionedResource,
  ResourceProvisionResult,
} from './group-deploy-types.js';
import type { CloudflareApiClient } from '../cloudflare/api-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function resourceCfName(groupName: string, env: string, resourceName: string): string {
  return `${groupName}-${env}-${resourceName}`;
}

// ── D1 provisioning ──────────────────────────────────────────────────────────

async function provisionD1(
  client: CloudflareApiClient,
  cfName: string,
): Promise<{ id: string }> {
  const result = await client.accountPost<{ uuid: string }>(
    '/d1/database',
    { name: cfName },
  );
  return { id: result.uuid };
}

// ── R2 provisioning ──────────────────────────────────────────────────────────

async function provisionR2(
  client: CloudflareApiClient,
  cfName: string,
): Promise<{ id: string }> {
  // R2 bucket names are the ID
  await client.accountPost('/r2/buckets', { name: cfName });
  return { id: cfName };
}

// ── KV provisioning ──────────────────────────────────────────────────────────

async function provisionKV(
  client: CloudflareApiClient,
  cfName: string,
): Promise<{ id: string }> {
  const result = await client.accountPost<{ id: string }>(
    '/storage/kv/namespaces',
    { title: cfName },
  );
  return { id: result.id };
}

// ── Main provisioner ─────────────────────────────────────────────────────────

export interface ProvisionResourcesOptions {
  accountId: string;
  apiToken: string;
  groupName: string;
  env: string;
  dryRun?: boolean;
}

/**
 * Provision all resources defined in app.yml.
 *
 * Returns a Map<resourceName, ProvisionedResource> for binding resolution,
 * and an array of ResourceProvisionResult for reporting.
 */
export async function provisionResources(
  resources: Record<string, AppResource>,
  options: ProvisionResourcesOptions,
  client?: CloudflareApiClient | null,
): Promise<{
  provisioned: Map<string, ProvisionedResource>;
  results: ResourceProvisionResult[];
}> {
  const provisioned = new Map<string, ProvisionedResource>();
  const results: ResourceProvisionResult[] = [];

  for (const [name, resource] of Object.entries(resources)) {
    const cfName = resourceCfName(options.groupName, options.env, name);
    const binding = resource.binding || name.toUpperCase().replace(/-/g, '_');

    if (options.dryRun) {
      results.push({
        name,
        type: resource.type,
        status: 'provisioned',
        id: `(dry-run) ${cfName}`,
      });
      provisioned.set(name, {
        name: cfName,
        type: resource.type,
        id: `(dry-run) ${cfName}`,
        binding,
      });
      continue;
    }

    try {
      switch (resource.type) {
        case 'd1': {
          if (!client) {
            throw new Error('CloudflareApiClient required for D1 provisioning');
          }
          const d1 = await provisionD1(client, cfName);
          provisioned.set(name, { name: cfName, type: 'd1', id: d1.id, binding });
          results.push({ name, type: 'd1', status: 'provisioned', id: d1.id });
          break;
        }
        case 'r2': {
          if (!client) {
            throw new Error('CloudflareApiClient required for R2 provisioning');
          }
          const r2 = await provisionR2(client, cfName);
          provisioned.set(name, { name: cfName, type: 'r2', id: r2.id, binding });
          results.push({ name, type: 'r2', status: 'provisioned', id: r2.id });
          break;
        }
        case 'kv': {
          if (!client) {
            throw new Error('CloudflareApiClient required for KV provisioning');
          }
          const kv = await provisionKV(client, cfName);
          provisioned.set(name, { name: cfName, type: 'kv', id: kv.id, binding });
          results.push({ name, type: 'kv', status: 'provisioned', id: kv.id });
          break;
        }
        case 'secretRef': {
          // For secretRef with generate: create a random value.
          // The secret will be set via wrangler secret put during worker deploy.
          const secretValue = generateSecretToken();
          provisioned.set(name, {
            name: cfName,
            type: 'secretRef',
            id: secretValue,
            binding,
          });
          results.push({ name, type: 'secretRef', status: 'provisioned', id: '(generated)' });
          break;
        }
        default: {
          results.push({
            name,
            type: resource.type,
            status: 'failed',
            error: `Unsupported resource type: ${resource.type}`,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name,
        type: resource.type,
        status: 'failed',
        error: message,
      });
    }
  }

  return { provisioned, results };
}
