/**
 * Validate the private runtime-secret JSON consumed by the Takos Worker.
 *
 * This contract belongs to the Worker runtime, not to a release or install
 * helper.  Keep the accepted names deliberately narrow so an accidental
 * binding or credential cannot be smuggled into the runtime bundle.
 */

/**
 * The runtime secrets a Takos deployment must hold.
 *
 * This is the only place the set is written down. `scripts/generate-runtime-secret-names.ts`
 * projects it into the OpenTofu modules, and every script that used to retype
 * it imports it instead.
 */
export const REQUIRED_RUNTIME_SECRET_NAMES = [
  "ENCRYPTION_KEY",
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
  "TAKOS_AGENT_START_TOKEN",
  "TAKOS_INTERNAL_API_SECRET",
] as const;

/**
 * Required runtime secrets that `validate-env.ts` deliberately does not
 * require at boot, with the reason.
 *
 * These two lists disagreeing is not automatically a defect, but an
 * undocumented disagreement is: it reads as an oversight and invites someone
 * to "fix" it in either direction. Every difference is named here, and
 * `runtime-secrets.test.ts` refuses an unnamed one.
 */
export const RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT: Readonly<
  Record<string, string>
> = {
  TAKOS_INTERNAL_API_SECRET:
    "internal-access.ts treats it as optional by design: unset means /internal/* is reachable from genuine loopback only, which is what the local stack runs on. A production Worker missing it therefore boots clean and silently refuses every external cron caller, so the operator-facing documentation still lists it as required.",
};

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
