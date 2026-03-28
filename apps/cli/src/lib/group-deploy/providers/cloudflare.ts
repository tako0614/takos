/**
 * Group Deploy -- Cloudflare provider.
 *
 * Implements ResourceProvider using the Cloudflare API and wrangler CLI.
 * This is a direct extraction of the Cloudflare-specific logic that was
 * previously inlined in provisioner.ts.
 */
import { randomBytes } from 'node:crypto';

import type { ResourceProvider, ProvisionResult } from '../resource-provider.js';
import { cfApi, execCommand, resourceCfName } from '../cloudflare-helpers.js';

export class CloudflareProvider implements ResourceProvider {
  readonly name = 'cloudflare';

  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly groupName: string;
  private readonly env: string;

  constructor(opts: { accountId: string; apiToken: string; groupName: string; env: string }) {
    this.accountId = opts.accountId;
    this.apiToken = opts.apiToken;
    this.groupName = opts.groupName;
    this.env = opts.env;
  }

  /** Build the Cloudflare resource name from group/env/resource. */
  private cfName(resourceName: string): string {
    return resourceCfName(this.groupName, this.env, resourceName);
  }

  // ── D1 database ──────────────────────────────────────────────────────────

  async createDatabase(name: string, _opts?: { migrations?: string }): Promise<ProvisionResult> {
    const cfName = this.cfName(name);
    const d1 = await cfApi<{ uuid: string }>(
      this.accountId, this.apiToken, 'POST', '/d1/database', { name: cfName },
    );
    return { name: cfName, type: 'd1', status: 'provisioned', id: d1.uuid };
  }

  // ── R2 bucket ────────────────────────────────────────────────────────────

  async createObjectStorage(name: string): Promise<ProvisionResult> {
    const cfName = this.cfName(name);
    await cfApi<unknown>(
      this.accountId, this.apiToken, 'POST', '/r2/buckets', { name: cfName },
    );
    return { name: cfName, type: 'r2', status: 'provisioned', id: cfName };
  }

  // ── KV namespace ─────────────────────────────────────────────────────────

  async createKeyValueStore(name: string): Promise<ProvisionResult> {
    const cfName = this.cfName(name);
    const kv = await cfApi<{ id: string }>(
      this.accountId, this.apiToken, 'POST', '/storage/kv/namespaces', { title: cfName },
    );
    return { name: cfName, type: 'kv', status: 'provisioned', id: kv.id };
  }

  // ── Queue (via wrangler CLI) ─────────────────────────────────────────────

  async createQueue(name: string, _opts?: { maxRetries?: number; deadLetterQueue?: string }): Promise<ProvisionResult> {
    const queueName = this.cfName(name);
    const { exitCode } = await execCommand(
      'npx', ['wrangler', 'queues', 'create', queueName],
      { env: { CLOUDFLARE_ACCOUNT_ID: this.accountId, CLOUDFLARE_API_TOKEN: this.apiToken } },
    );
    return { name: queueName, type: 'queue', status: exitCode === 0 ? 'provisioned' : 'exists', id: queueName };
  }

  // ── Vectorize index (via wrangler CLI) ───────────────────────────────────

  async createVectorIndex(name: string, opts: { dimensions: number; metric: string }): Promise<ProvisionResult> {
    const indexName = this.cfName(name);
    const dimensions = opts.dimensions || 1536;
    const metric = opts.metric || 'cosine';
    const { exitCode } = await execCommand(
      'npx', ['wrangler', 'vectorize', 'create', indexName, '--dimensions', String(dimensions), '--metric', metric],
      { env: { CLOUDFLARE_ACCOUNT_ID: this.accountId, CLOUDFLARE_API_TOKEN: this.apiToken } },
    );
    return { name: indexName, type: 'vectorize', status: exitCode === 0 ? 'provisioned' : 'exists', id: indexName };
  }

  // ── Secret (random token generation) ─────────────────────────────────────

  async createSecret(name: string, _binding: string): Promise<ProvisionResult> {
    const cfName = this.cfName(name);
    const secretValue = randomBytes(32).toString('hex');
    return { name: cfName, type: 'secretRef', status: 'provisioned', id: secretValue };
  }

  // ── Auto-configured resources ────────────────────────────────────────────

  skipAutoConfigured(name: string, type: string): ProvisionResult {
    return {
      name,
      type,
      status: 'skipped',
      error: `${type} は wrangler deploy 時に自動設定されます`,
    };
  }
}
