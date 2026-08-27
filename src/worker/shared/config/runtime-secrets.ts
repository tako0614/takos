/**
 * Validate the private runtime-secret JSON consumed by the Takos Worker.
 *
 * This contract belongs to the Worker runtime, not to a release or install
 * helper.  Keep the accepted names deliberately narrow so an accidental
 * binding or credential cannot be smuggled into the runtime bundle.
 */

export const REQUIRED_RUNTIME_SECRET_NAMES = [
  "ENCRYPTION_KEY",
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
  "TAKOS_AGENT_START_TOKEN",
  "TAKOS_INTERNAL_API_SECRET",
] as const;

const ALLOWED_RUNTIME_SECRET_NAMES = new Set<string>([
  ...REQUIRED_RUNTIME_SECRET_NAMES,
  "OIDC_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "AUDIT_IP_HASH_KEY",
  "CF_API_TOKEN",
  "GOOGLE_API_KEY",
  "OCI_ORCHESTRATOR_TOKEN",
  "OPENAI_API_KEY",
  "TAKOSUMI_ACCOUNTS_TOKEN",
  "TAKOS_FEATURED_APP_INSTALL_TOKEN",
  "TAKOS_INTERNAL_SERVICE_SECRET",
  "TAKOS_NOTIFICATION_PUSH_GATEWAY_TOKEN",
  "TURNSTILE_SECRET_KEY",
]);

function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("runtime secret file must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Return a stable, validated copy of a runtime secret map.
 *
 * Values are intentionally not logged or included in validation errors.
 */
export function validateRuntimeSecrets(value: unknown): Record<string, string> {
  const input = assertRecord(value);
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!ALLOWED_RUNTIME_SECRET_NAMES.has(name)) {
      throw new Error(`runtime secret ${name} is not in the Takos secret contract`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`runtime secret ${name} must be a non-empty string`);
    }
    if (value.length > 64 * 1024) {
      throw new Error(`runtime secret ${name} is too large`);
    }
    output[name] = value;
  }
  for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
    if (!output[name]) {
      throw new Error(`runtime secret ${name} is required`);
    }
  }
  return Object.fromEntries(
    Object.entries(output).sort(([left], [right]) => left.localeCompare(right)),
  );
}
