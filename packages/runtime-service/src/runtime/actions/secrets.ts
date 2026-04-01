const SECRET_MASK = '***';

/**
 * Maximum length for a single secret value to prevent ReDoS.
 * Secrets longer than this are handled via string replacement only (no regex).
 */
const MAX_SECRET_REGEX_LENGTH = 4096;

export class SecretsSanitizer {
  private secretValues: Set<string> = new Set();
  private secretPatterns: RegExp[] = [];
  /** Secrets too long for safe regex conversion — handled via string replacement only. */
  private longSecrets: Set<string> = new Set();

  private addValues(values: Iterable<string>): void {
    for (const value of values) {
      if (value.length > 0) {
        this.secretValues.add(value);
      }
    }
    this.buildPatterns();
  }

  registerSecrets(secrets: Record<string, string>): void {
    this.addValues(Object.values(secrets));
  }

  registerSecretValues(values: string[]): void {
    this.addValues(values);
  }

  private buildPatterns(): void {
    this.secretPatterns = [];
    this.longSecrets = new Set();
    for (const secret of this.secretValues) {
      // Skip regex for long secrets to prevent ReDoS
      if (secret.length > MAX_SECRET_REGEX_LENGTH) {
        this.longSecrets.add(secret);
        continue;
      }
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        this.secretPatterns.push(new RegExp(escaped, 'g'));
      } catch {
        // Regex construction failed — fall back to string replacement
        this.longSecrets.add(secret);
      }
    }
  }

  sanitize(text: string): string {
    if (!text || this.secretValues.size === 0) return text;

    let sanitized = text;
    for (const pattern of this.secretPatterns) {
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, SECRET_MASK);
    }
    // String replacement fallback for long secrets and regex-failed secrets
    for (const secret of this.longSecrets) {
      if (sanitized.includes(secret)) {
        sanitized = sanitized.split(secret).join(SECRET_MASK);
      }
    }
    return sanitized;
  }

  sanitizeLogs(logs: string[]): string[] {
    return logs.map(log => this.sanitize(log));
  }

  clear(): void {
    this.secretValues.clear();
    this.secretPatterns = [];
    this.longSecrets.clear();
  }
}

/**
 * Commands that would directly dump environment variables containing secrets.
 * These are blocked (not just warned) to prevent secret leakage.
 */
const SECRET_EXPOSING_COMMANDS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /^\s*env\s*$/, description: 'bare "env" dumps all environment variables' },
  { pattern: /^\s*printenv\s*$/, description: 'bare "printenv" dumps all environment variables' },
  { pattern: /^\s*export\s+-p\s*$/, description: '"export -p" dumps all exported variables' },
];

/**
 * Detect if a shell command might expose secrets via env/printenv/set.
 * Returns a description of the risk if detected, or null if safe.
 */
export function mightExposeSecrets(command: string): string | null {
  for (const line of command.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const { pattern, description } of SECRET_EXPOSING_COMMANDS) {
      if (pattern.test(trimmed)) {
        return description;
      }
    }
  }
  return null;
}

/**
 * Check if a command should be blocked because it would expose secrets.
 * Unlike mightExposeSecrets(), this returns true only for commands that
 * would definitely dump all environment variables.
 */
export function shouldBlockForSecretExposure(command: string): boolean {
  return mightExposeSecrets(command) !== null;
}

export function createSecretsSanitizer(
  secrets: Record<string, string>,
  extraValues: string[] = []
): SecretsSanitizer {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets(secrets);
  if (extraValues.length > 0) {
    sanitizer.registerSecretValues(extraValues);
  }
  return sanitizer;
}

// ---------------------------------------------------------------------------
// --- Sensitive environment detection ---
// ---------------------------------------------------------------------------

const EXTRA_SENSITIVE_ENV_PATTERNS = [
  /SECRET/i,
  /PASSWORD/i,
  /TOKEN/i,
  /API_KEY/i,
  /PRIVATE_KEY/i,
  /ACCESS_KEY/i,
  /AUTH/i,
];

const EXTRA_SENSITIVE_ENV_KEYS = new Set([
  'TAKOS_TOKEN',
  'TAKOS_SESSION_ID',
]);

export function collectSensitiveEnvValues(env?: Record<string, string>): string[] {
  if (!env) return [];
  const values: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (EXTRA_SENSITIVE_ENV_KEYS.has(key)) {
      values.push(value);
      continue;
    }
    if (EXTRA_SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key))) {
      values.push(value);
    }
  }

  return values;
}
