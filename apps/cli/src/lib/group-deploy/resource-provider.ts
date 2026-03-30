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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate a resource name to prevent injection in shell commands,
 * YAML templates, and SQL statements.
 *
 * Allows: lowercase alphanumeric, hyphens, underscores, dots.
 * Max length: 63 (Kubernetes label constraint).
 */
const SAFE_RESOURCE_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export function validateResourceName(name: string): void {
  if (!SAFE_RESOURCE_NAME.test(name)) {
    throw new Error(
      `Invalid resource name "${name}": must match ${SAFE_RESOURCE_NAME} `
      + `(lowercase alphanumeric, hyphens, underscores, dots; 1-63 chars)`,
    );
  }
}

/**
 * Check if CLI stderr/stdout indicates the resource already exists.
 * Each provider passes its vendor-specific patterns.
 */
export function isAlreadyExistsError(patterns: string[], stderr: string, stdout = ''): boolean {
  const combined = stderr + stdout;
  return patterns.some((p) => combined.includes(p));
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
