/**
 * Group Deploy -- Docker provider.
 *
 * Implements ResourceProvider for self-hosted / local development using
 * Docker Compose. Assumes PostgreSQL, Redis, and MinIO are already running
 * (or will be started) via docker compose.
 *
 * Resource creation = creating databases / buckets / tables within the
 * already-running containers.
 *
 * Requires: docker CLI available.
 */
import type { ResourceProvider, ProvisionResult } from '../resource-provider.js';
import { execCommand } from '../cloudflare-helpers.js';

export class DockerProvider implements ResourceProvider {
  readonly name = 'docker';

  private readonly composeProject: string;

  constructor(opts?: { composeProject?: string }) {
    this.composeProject = opts?.composeProject || process.env.COMPOSE_PROJECT_NAME || 'takos';
  }

  /** Run a docker exec command against a running container. */
  private async dockerExec(
    service: string,
    command: string[],
    resourceName: string,
    type: string,
  ): Promise<{ ok: boolean; stdout: string; error?: string }> {
    try {
      const { stdout, stderr, exitCode } = await execCommand(
        'docker', ['compose', '-p', this.composeProject, 'exec', '-T', service, ...command],
      );
      if (exitCode !== 0) {
        if (stderr.includes('already exists') || stderr.includes('duplicate key') || stdout.includes('already exists')) {
          return { ok: true, stdout, error: 'already exists' };
        }
        return { ok: false, stdout, error: stderr || `docker exec exited with code ${exitCode}` };
      }
      return { ok: true, stdout };
    } catch (error) {
      return { ok: false, stdout: '', error: `docker CLI not available: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── PostgreSQL database ──────────────────────────────────────────────────

  async createDatabase(name: string, _opts?: { migrations?: string }): Promise<ProvisionResult> {
    const dbName = name.replace(/-/g, '_');
    const result = await this.dockerExec(
      'postgres',
      ['psql', '-U', 'postgres', '-c', `CREATE DATABASE "${dbName}";`],
      name, 'database',
    );
    if (!result.ok) {
      return { name, type: 'database', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'database', status: 'exists', id: dbName };
    }
    return { name, type: 'database', status: 'provisioned', id: dbName };
  }

  // ── MinIO bucket ─────────────────────────────────────────────────────────

  async createObjectStorage(name: string): Promise<ProvisionResult> {
    const bucketName = name;
    const result = await this.dockerExec(
      'minio',
      ['mc', 'mb', `local/${bucketName}`, '--ignore-existing'],
      name, 'object-storage',
    );
    if (!result.ok) {
      // Fallback: try using the MinIO client directly if mc alias isn't set up
      return { name, type: 'object-storage', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'object-storage', status: 'exists', id: bucketName };
    }
    return { name, type: 'object-storage', status: 'provisioned', id: bucketName };
  }

  // ── Redis key-value ──────────────────────────────────────────────────────

  async createKeyValueStore(name: string): Promise<ProvisionResult> {
    // Redis doesn't need explicit "database" creation; selecting a DB index
    // or using key prefixes is sufficient. We verify connectivity instead.
    const result = await this.dockerExec(
      'redis',
      ['redis-cli', 'ping'],
      name, 'kv',
    );
    if (!result.ok) {
      return { name, type: 'kv', status: 'failed', error: result.error };
    }
    return { name, type: 'kv', status: 'provisioned', id: name };
  }

  // ── Redis-based queue ────────────────────────────────────────────────────

  async createQueue(name: string, _opts?: { maxRetries?: number; deadLetterQueue?: string }): Promise<ProvisionResult> {
    // Queue backed by Redis -- verify the Redis service is reachable
    const result = await this.dockerExec(
      'redis',
      ['redis-cli', 'ping'],
      name, 'queue',
    );
    if (!result.ok) {
      return { name, type: 'queue', status: 'failed', error: result.error };
    }
    return { name, type: 'queue', status: 'provisioned', id: name };
  }

  // ── Vector index -- not supported in Docker mode ─────────────────────────

  async createVectorIndex(name: string, _opts: { dimensions: number; metric: string }): Promise<ProvisionResult> {
    return { name, type: 'vectorize', status: 'skipped', error: 'Vector index provisioning is not supported on Docker provider' };
  }

  // ── Secret (local .env style) ────────────────────────────────────────────

  async createSecret(name: string, _binding: string): Promise<ProvisionResult> {
    const { randomBytes } = await import('node:crypto');
    const secretValue = randomBytes(32).toString('hex');
    // In Docker/local mode, secrets are generated but stored in-memory only.
    // The caller should persist them to a .env file or secrets manager.
    return { name, type: 'secretRef', status: 'provisioned', id: secretValue };
  }

  // ── Auto-configured ──────────────────────────────────────────────────────

  skipAutoConfigured(name: string, type: string): ProvisionResult {
    return { name, type, status: 'skipped', error: `${type} is auto-configured at deploy time` };
  }
}
