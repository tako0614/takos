/**
 * Resource Provisioner for group deploy.
 *
 * Provisions Cloudflare resources (D1, R2, KV) from the flat-schema
 * `storage` block and generates secret values for `secret` entries.
 *
 * For D1/R2/KV: delegates to the Cloudflare Management API via
 * `CloudflareApiClient`. For `secret` with `generate: true`: creates a
 * random token value.
 */
import { randomBytes } from 'node:crypto';
import type { AppStorage } from '../source/app-manifest-types.ts';
import type {
  ProvisionedResource,
  ResourceProvisionResult,
} from './group-deploy-types.ts';
import type { CloudflareApiClient } from '../cloudflare/api-client.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function resourceProviderName(groupName: string, env: string, resourceName: string): string {
  return `${groupName}-${env}-${resourceName}`;
}

function defaultBindingName(resourceName: string): string {
  return resourceName.toUpperCase().replace(/-/g, '_');
}

// ── D1 provisioning ──────────────────────────────────────────────────────────

async function provisionD1(
  client: CloudflareApiClient,
  providerResourceName: string,
): Promise<{ id: string }> {
  const result = await client.accountPost<{ uuid: string }>(
    '/d1/database',
    { name: providerResourceName },
  );
  return { id: result.uuid };
}

// ── R2 provisioning ──────────────────────────────────────────────────────────

async function provisionR2(
  client: CloudflareApiClient,
  providerResourceName: string,
): Promise<{ id: string }> {
  await client.accountPost('/r2/buckets', { name: providerResourceName });
  return { id: providerResourceName };
}

// ── KV provisioning ──────────────────────────────────────────────────────────

async function provisionKV(
  client: CloudflareApiClient,
  providerResourceName: string,
): Promise<{ id: string }> {
  const result = await client.accountPost<{ id: string }>(
    '/storage/kv/namespaces',
    { title: providerResourceName },
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
 * Provision all storage entries declared in the flat manifest.
 *
 * Returns a `Map<resourceName, ProvisionedResource>` for binding resolution,
 * and an array of `ResourceProvisionResult` for reporting.
 */
export async function provisionResources(
  storage: Record<string, AppStorage>,
  options: ProvisionResourcesOptions,
  client?: CloudflareApiClient | null,
): Promise<{
  provisioned: Map<string, ProvisionedResource>;
  results: ResourceProvisionResult[];
}> {
  const provisioned = new Map<string, ProvisionedResource>();
  const results: ResourceProvisionResult[] = [];

  for (const [name, resource] of Object.entries(storage)) {
    const providerResourceName = resourceProviderName(options.groupName, options.env, name);
    const binding = resource.bind || defaultBindingName(name);

    if (options.dryRun) {
      results.push({
        name,
        type: resource.type,
        status: 'provisioned',
        id: `(dry-run) ${providerResourceName}`,
      });
      provisioned.set(name, {
        name: providerResourceName,
        type: resource.type,
        id: `(dry-run) ${providerResourceName}`,
        binding,
      });
      continue;
    }

    try {
      switch (resource.type) {
        case 'sql': {
          if (!client) {
            throw new Error('CloudflareApiClient required for sql (d1) provisioning');
          }
          const d1 = await provisionD1(client, providerResourceName);
          provisioned.set(name, { name: providerResourceName, type: 'sql', id: d1.id, binding });
          results.push({ name, type: 'sql', status: 'provisioned', id: d1.id });
          break;
        }
        case 'object-store': {
          if (!client) {
            throw new Error('CloudflareApiClient required for object-store (r2) provisioning');
          }
          const r2 = await provisionR2(client, providerResourceName);
          provisioned.set(name, { name: providerResourceName, type: 'object-store', id: r2.id, binding });
          results.push({ name, type: 'object-store', status: 'provisioned', id: r2.id });
          break;
        }
        case 'key-value': {
          if (!client) {
            throw new Error('CloudflareApiClient required for key-value (kv) provisioning');
          }
          const kv = await provisionKV(client, providerResourceName);
          provisioned.set(name, { name: providerResourceName, type: 'key-value', id: kv.id, binding });
          results.push({ name, type: 'key-value', status: 'provisioned', id: kv.id });
          break;
        }
        case 'secret': {
          // For `secret` with generate: create a random value. The secret
          // will be set via `wrangler secret put` during worker deploy.
          const secretValue = resource.generate ? generateSecretToken() : '';
          provisioned.set(name, {
            name: providerResourceName,
            type: 'secret',
            id: secretValue,
            binding,
          });
          results.push({
            name,
            type: 'secret',
            status: 'provisioned',
            id: resource.generate ? '(generated)' : '(external)',
          });
          break;
        }
        case 'queue':
        case 'vector-index': {
          // Queue and vector-index are provisioned via wrangler CLI, not
          // the Cloudflare Management API.
          provisioned.set(name, {
            name: providerResourceName,
            type: resource.type,
            id: providerResourceName,
            binding,
          });
          results.push({
            name,
            type: resource.type,
            status: 'skipped',
            error: `${resource.type} provisioning requires wrangler CLI`,
          });
          break;
        }
        case 'analytics-engine':
        case 'durable-object':
        case 'workflow': {
          // Auto-configured during wrangler deploy.
          provisioned.set(name, {
            name: providerResourceName,
            type: resource.type,
            id: name,
            binding,
          });
          results.push({
            name,
            type: resource.type,
            status: 'skipped',
            error: `${resource.type} は wrangler deploy 時に自動設定されます`,
          });
          break;
        }
        default: {
          const unknownResource = resource as { type: string };
          results.push({
            name,
            type: unknownResource.type,
            status: 'failed',
            error: `Unsupported resource type: ${unknownResource.type}`,
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
