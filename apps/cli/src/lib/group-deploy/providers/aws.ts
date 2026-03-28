/**
 * Group Deploy -- AWS provider.
 *
 * Implements ResourceProvider using the AWS CLI.
 * Requires: aws CLI installed, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION set.
 *
 * Commands are executed via the CLI rather than the SDK to avoid adding
 * aws-sdk as a dependency. When the CLI is not available the provider
 * returns a graceful 'failed' result rather than throwing.
 */
import type { ResourceProvider, ProvisionResult } from '../resource-provider.js';
import { execCommand } from '../cloudflare-helpers.js';

export class AWSProvider implements ResourceProvider {
  readonly name = 'aws';

  private readonly region: string;

  constructor(opts?: { region?: string }) {
    this.region = opts?.region || process.env.AWS_REGION || 'us-east-1';
  }

  /** Run an aws CLI command, returning a graceful result on failure. */
  private async aws(args: string[], resourceName: string, type: string): Promise<{ ok: boolean; stdout: string; error?: string }> {
    try {
      const { stdout, stderr, exitCode } = await execCommand('aws', args, {
        env: {
          AWS_DEFAULT_REGION: this.region,
        },
      });
      if (exitCode !== 0) {
        // "already exists" patterns from AWS CLI
        if (stderr.includes('already exists') || stderr.includes('BucketAlreadyOwnedByYou') || stderr.includes('ResourceInUseException') || stderr.includes('QueueAlreadyExists')) {
          return { ok: true, stdout, error: 'already exists' };
        }
        return { ok: false, stdout, error: stderr || `aws exited with code ${exitCode}` };
      }
      return { ok: true, stdout };
    } catch (error) {
      return { ok: false, stdout: '', error: `aws CLI not available: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── RDS / DynamoDB ───────────────────────────────────────────────────────

  async createDatabase(name: string, _opts?: { migrations?: string }): Promise<ProvisionResult> {
    const tableName = name;
    const result = await this.aws(
      ['dynamodb', 'create-table',
        '--table-name', tableName,
        '--attribute-definitions', 'AttributeName=pk,AttributeType=S',
        '--key-schema', 'AttributeName=pk,KeyType=HASH',
        '--billing-mode', 'PAY_PER_REQUEST',
        '--output', 'json'],
      name, 'database',
    );
    if (!result.ok) {
      return { name, type: 'database', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'database', status: 'exists', id: tableName };
    }
    return { name, type: 'database', status: 'provisioned', id: tableName };
  }

  // ── S3 bucket ────────────────────────────────────────────────────────────

  async createObjectStorage(name: string): Promise<ProvisionResult> {
    const bucketName = name;
    const result = await this.aws(
      ['s3', 'mb', `s3://${bucketName}`, '--region', this.region],
      name, 'object-storage',
    );
    if (!result.ok) {
      return { name, type: 'object-storage', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'object-storage', status: 'exists', id: bucketName };
    }
    return { name, type: 'object-storage', status: 'provisioned', id: bucketName };
  }

  // ── DynamoDB (key-value) ─────────────────────────────────────────────────

  async createKeyValueStore(name: string): Promise<ProvisionResult> {
    const tableName = `${name}-kv`;
    const result = await this.aws(
      ['dynamodb', 'create-table',
        '--table-name', tableName,
        '--attribute-definitions', 'AttributeName=key,AttributeType=S',
        '--key-schema', 'AttributeName=key,KeyType=HASH',
        '--billing-mode', 'PAY_PER_REQUEST',
        '--output', 'json'],
      name, 'kv',
    );
    if (!result.ok) {
      return { name, type: 'kv', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'kv', status: 'exists', id: tableName };
    }
    return { name, type: 'kv', status: 'provisioned', id: tableName };
  }

  // ── SQS queue ────────────────────────────────────────────────────────────

  async createQueue(name: string, _opts?: { maxRetries?: number; deadLetterQueue?: string }): Promise<ProvisionResult> {
    const queueName = name;
    const result = await this.aws(
      ['sqs', 'create-queue', '--queue-name', queueName, '--output', 'json'],
      name, 'queue',
    );
    if (!result.ok) {
      return { name, type: 'queue', status: 'failed', error: result.error };
    }
    // SQS create-queue is idempotent — always returns the URL
    let queueUrl: string | undefined;
    try {
      const parsed = JSON.parse(result.stdout);
      queueUrl = parsed.QueueUrl;
    } catch { /* ignore parse errors */ }
    return { name, type: 'queue', status: 'provisioned', id: queueUrl || queueName };
  }

  // ── Vectorize — not supported on AWS ─────────────────────────────────────

  async createVectorIndex(name: string, _opts: { dimensions: number; metric: string }): Promise<ProvisionResult> {
    return { name, type: 'vectorize', status: 'skipped', error: 'Vector index provisioning is not supported on AWS provider' };
  }

  // ── Secret (Secrets Manager) ─────────────────────────────────────────────

  async createSecret(name: string, _binding: string): Promise<ProvisionResult> {
    const { randomBytes } = await import('node:crypto');
    const secretValue = randomBytes(32).toString('hex');
    const result = await this.aws(
      ['secretsmanager', 'create-secret',
        '--name', name,
        '--secret-string', secretValue,
        '--output', 'json'],
      name, 'secret',
    );
    if (!result.ok) {
      if (result.error?.includes('already exists')) {
        return { name, type: 'secretRef', status: 'exists', id: '(existing)' };
      }
      return { name, type: 'secretRef', status: 'failed', error: result.error };
    }
    return { name, type: 'secretRef', status: 'provisioned', id: secretValue };
  }

  // ── Auto-configured ──────────────────────────────────────────────────────

  skipAutoConfigured(name: string, type: string): ProvisionResult {
    return { name, type, status: 'skipped', error: `${type} is auto-configured at deploy time` };
  }
}
