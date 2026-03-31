/**
 * Group Deploy -- GCP provider.
 *
 * Implements ResourceProvider using the gcloud / gsutil CLI.
 * Requires: gcloud CLI installed, GOOGLE_APPLICATION_CREDENTIALS or gcloud auth configured.
 *
 * Commands are executed via the CLI to avoid adding @google-cloud/* SDKs
 * as dependencies. When the CLI is not available the provider returns a
 * graceful 'failed' result rather than throwing.
 */
import type { ResourceProvider, ProvisionResult } from '../resource-provider.ts';
import { isAlreadyExistsError } from '../resource-provider.ts';
import { execCommand } from '../cloudflare-utils.ts';

const GCP_ALREADY_EXISTS_PATTERNS = [
  'already exists',
  'ALREADY_EXISTS',
  '409',
];

export class GCPProvider implements ResourceProvider {
  readonly name = 'gcp';

  private readonly project: string;
  private readonly region: string;

  constructor(opts?: { project?: string; region?: string }) {
    this.project = opts?.project || Deno.env.get('GOOGLE_CLOUD_PROJECT') || Deno.env.get('GCLOUD_PROJECT') || '';
    this.region = opts?.region || Deno.env.get('GOOGLE_CLOUD_REGION') || 'us-central1';
  }

  /** Run a gcloud CLI command with graceful failure handling. */
  private async gcloud(args: string[], resourceName: string, type: string): Promise<{ ok: boolean; stdout: string; error?: string }> {
    try {
      const fullArgs = [...args];
      if (this.project) {
        fullArgs.push('--project', this.project);
      }
      const { stdout, stderr, exitCode } = await execCommand('gcloud', fullArgs);
      if (exitCode !== 0) {
        if (isAlreadyExistsError(GCP_ALREADY_EXISTS_PATTERNS, stderr)) {
          return { ok: true, stdout, error: 'already exists' };
        }
        return { ok: false, stdout, error: stderr || `gcloud exited with code ${exitCode}` };
      }
      return { ok: true, stdout };
    } catch (error) {
      return { ok: false, stdout: '', error: `gcloud CLI not available: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── Cloud SQL instance ───────────────────────────────────────────────────

  async createDatabase(name: string, _opts?: { migrations?: string }): Promise<ProvisionResult> {
    const instanceName = name;
    const result = await this.gcloud(
      ['sql', 'instances', 'create', instanceName,
        '--database-version=POSTGRES_15',
        '--tier=db-f1-micro',
        `--region=${this.region}`,
        '--format=json'],
      name, 'database',
    );
    if (!result.ok) {
      return { name, type: 'database', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'database', status: 'exists', id: instanceName };
    }
    return { name, type: 'database', status: 'provisioned', id: instanceName };
  }

  // ── Cloud Storage bucket ─────────────────────────────────────────────────

  async createObjectStorage(name: string): Promise<ProvisionResult> {
    const bucketName = name;
    try {
      const { stdout, stderr, exitCode } = await execCommand(
        'gsutil', ['mb', '-l', this.region, `gs://${bucketName}`],
      );
      if (exitCode !== 0) {
        if (isAlreadyExistsError(GCP_ALREADY_EXISTS_PATTERNS, stderr)) {
          return { name, type: 'object-storage', status: 'exists', id: bucketName };
        }
        return { name, type: 'object-storage', status: 'failed', error: stderr || `gsutil exited with code ${exitCode}` };
      }
      return { name, type: 'object-storage', status: 'provisioned', id: bucketName };
    } catch (error) {
      return { name, type: 'object-storage', status: 'failed', error: `gsutil not available: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── Firestore (key-value) ────────────────────────────────────────────────

  async createKeyValueStore(name: string): Promise<ProvisionResult> {
    const result = await this.gcloud(
      ['firestore', 'databases', 'create',
        `--database=${name}`,
        `--location=${this.region}`,
        '--type=firestore-native',
        '--format=json'],
      name, 'kv',
    );
    if (!result.ok) {
      return { name, type: 'kv', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'kv', status: 'exists', id: name };
    }
    return { name, type: 'kv', status: 'provisioned', id: name };
  }

  // ── Pub/Sub topic ────────────────────────────────────────────────────────

  async createQueue(name: string, _opts?: { maxRetries?: number; deadLetterQueue?: string }): Promise<ProvisionResult> {
    const topicName = name;
    const result = await this.gcloud(
      ['pubsub', 'topics', 'create', topicName, '--format=json'],
      name, 'queue',
    );
    if (!result.ok) {
      return { name, type: 'queue', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'queue', status: 'exists', id: topicName };
    }
    return { name, type: 'queue', status: 'provisioned', id: topicName };
  }

  // ── Vector index -- not supported via gcloud CLI ─────────────────────────

  async createVectorIndex(name: string, _opts: { dimensions: number; metric: string }): Promise<ProvisionResult> {
    return { name, type: 'vectorize', status: 'skipped', error: 'Vector index provisioning is not supported on GCP provider' };
  }

  // ── Secret Manager ───────────────────────────────────────────────────────

  async createSecret(name: string, _binding: string): Promise<ProvisionResult> {
    const { randomBytes } = await import('node:crypto');
    const secretValue = randomBytes(32).toString('hex');

    // Create the secret
    const createResult = await this.gcloud(
      ['secrets', 'create', name, '--replication-policy=automatic', '--format=json'],
      name, 'secret',
    );
    if (!createResult.ok && createResult.error !== 'already exists') {
      return { name, type: 'secretRef', status: 'failed', error: createResult.error };
    }

    // Add a version with the generated value
    try {
      const { exitCode, stderr } = await execCommand(
        'gcloud', [
          'secrets', 'versions', 'add', name, '--data-file=-',
          ...(this.project ? ['--project', this.project] : []),
        ],
        { stdin: secretValue },
      );
      if (exitCode !== 0) {
        return { name, type: 'secretRef', status: 'failed', error: stderr };
      }
    } catch (error) {
      return { name, type: 'secretRef', status: 'failed', error: `Failed to set secret value: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (createResult.error === 'already exists') {
      return { name, type: 'secretRef', status: 'exists', id: '(updated)' };
    }
    return { name, type: 'secretRef', status: 'provisioned', id: secretValue };
  }

  // ── Auto-configured ──────────────────────────────────────────────────────

  skipAutoConfigured(name: string, type: string): ProvisionResult {
    return { name, type, status: 'skipped', error: `${type} is auto-configured at deploy time` };
  }
}
