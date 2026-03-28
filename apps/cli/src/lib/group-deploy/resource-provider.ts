/**
 * Group Deploy -- ResourceProvider interface.
 *
 * Defines a provider-agnostic API for provisioning infrastructure resources.
 * Each cloud/platform provider (Cloudflare, AWS, GCP, K8s, Docker) implements
 * this interface so the orchestrator can work identically across environments.
 */

// ── Result type ──────────────────────────────────────────────────────────────

export interface ProvisionResult {
  name: string;
  type: string;
  status: 'provisioned' | 'exists' | 'skipped' | 'failed';
  id?: string;
  error?: string;
}

// ── Provider interface ───────────────────────────────────────────────────────

export interface ResourceProvider {
  /** Human-readable provider name (e.g. "cloudflare", "aws", "docker") */
  readonly name: string;

  // ── Resource provisioning ────────────────────────────────────────────────

  createDatabase(name: string, opts?: { migrations?: string }): Promise<ProvisionResult>;
  createObjectStorage(name: string): Promise<ProvisionResult>;
  createKeyValueStore(name: string): Promise<ProvisionResult>;
  createQueue(name: string, opts?: { maxRetries?: number; deadLetterQueue?: string }): Promise<ProvisionResult>;
  createVectorIndex(name: string, opts: { dimensions: number; metric: string }): Promise<ProvisionResult>;
  createSecret(name: string, binding: string): Promise<ProvisionResult>;

  // ── Auto-configured resources (no provisioning required) ─────────────────

  skipAutoConfigured(name: string, type: string): ProvisionResult;
}

// ── Provider options ─────────────────────────────────────────────────────────

export interface ProviderOptions {
  /** Cloudflare account ID */
  accountId?: string;
  /** Cloudflare API token */
  apiToken?: string;
  /** Group name for resource naming */
  groupName: string;
  /** Target environment */
  env: string;
  /** Dry-run mode */
  dryRun?: boolean;
}
