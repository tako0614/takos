/**
 * Shared helpers for worker management scripts.
 */

const DISPATCH_NAMESPACE_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;
const MAX_DISPATCH_NAMESPACE_LENGTH = 63;

/**
 * Filter sensitive information from error responses before logging.
 */
export function filterSensitiveData(text: string): string {
  return text
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer [REDACTED]')
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token": "[REDACTED]"')
    .replace(/"key"\s*:\s*"[^"]+"/gi, '"key": "[REDACTED]"')
    .replace(/"secret"\s*:\s*"[^"]+"/gi, '"secret": "[REDACTED]"')
    .replace(/"password"\s*:\s*"[^"]+"/gi, '"password": "[REDACTED]"')
    .replace(/"api_key"\s*:\s*"[^"]+"/gi, '"api_key": "[REDACTED]"');
}

/**
 * Require an environment variable and exit with a consistent message if missing.
 */
export function requireEnvVar(name: string, value: string | undefined, setInstruction: string): string {
  if (!value) {
    console.error(`Error: ${name} environment variable is required`);
    console.log(`\nSet it with: ${setInstruction}`);
    process.exit(1);
  }

  return value;
}

/**
 * Validate that a URL uses HTTPS protocol.
 */
export function validateHttpsUrl(url: string, urlName: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      console.error(`Error: ${urlName} must use HTTPS protocol. Got: ${parsed.protocol}`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: Invalid URL for ${urlName}: ${url}`);
    process.exit(1);
  }
}

/**
 * Validate dispatch namespace format and length.
 */
export function validateDispatchNamespace(namespace: string): void {
  if (
    !DISPATCH_NAMESPACE_PATTERN.test(namespace) ||
    namespace.length > MAX_DISPATCH_NAMESPACE_LENGTH
  ) {
    console.error('Error: Invalid DISPATCH_NAMESPACE format.');
    console.error('Namespace must start and end with alphanumeric characters,');
    console.error('can only contain alphanumeric characters, underscores, and hyphens,');
    console.error(`and must be ${MAX_DISPATCH_NAMESPACE_LENGTH} characters or less.`);
    process.exit(1);
  }
}

/**
 * Validate a Cloudflare Worker name format and length.
 * Worker names must start and end with alphanumeric characters,
 * can only contain alphanumeric characters, underscores, and hyphens,
 * and must be 63 characters or less (DNS compatibility).
 */
export function validateWorkerName(workerName: string): void {
  if (
    !DISPATCH_NAMESPACE_PATTERN.test(workerName) ||
    workerName.length > MAX_DISPATCH_NAMESPACE_LENGTH
  ) {
    console.error('Error: Invalid worker name format.');
    console.error('Worker name must start and end with alphanumeric characters,');
    console.error('can only contain alphanumeric characters, underscores, and hyphens,');
    console.error('and must be 63 characters or less.');
    process.exit(1);
  }
}
