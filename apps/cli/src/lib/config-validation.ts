/**
 * URL and domain validation for takos-cli
 */

export interface ApiUrlValidationResult {
  valid: boolean;
  error?: string;
  insecureLocalhostHttp?: boolean;
}

/**
 * Check if a hostname is a localhost address.
 * Supports localhost, IPv4 loopback range (127.0.0.0/8), and IPv6 loopback.
 */
export function isLocalhostAddress(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost'
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
    || h === '::1'
    || h === '0:0:0:0:0:0:0:1';
}

/** Trusted API domains */
const ALLOWED_API_DOMAINS = [
  'takos.jp',
  'yurucommu.com',
  'takos.dev',
  'takos.io',
] as const;

function isAllowedApiDomain(hostname: string): boolean {
  return ALLOWED_API_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * Validate API URL against allowed domains and transport requirements.
 * Returns validation result with error message if invalid.
 */
export function validateApiUrl(apiUrl: string): ApiUrlValidationResult {
  try {
    const parsed = new URL(apiUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (!hostname) {
      return { valid: false, error: 'Invalid hostname in API URL' };
    }

    if (parsed.username || parsed.password) {
      return { valid: false, error: 'API URL must not contain credentials' };
    }

    const isLocalhost = isLocalhostAddress(hostname);
    if (!isLocalhost && !isAllowedApiDomain(hostname)) {
      return {
        valid: false,
        error: `API URL domain must be one of: ${ALLOWED_API_DOMAINS.join(', ')}`,
      };
    }

    if (parsed.protocol !== 'https:') {
      if (!isLocalhost) {
        return {
          valid: false,
          error: 'API URL must use HTTPS for non-localhost connections',
        };
      }
      return { valid: true, insecureLocalhostHttp: true };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid API URL format' };
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIMPLE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidId(id: string, minLength = 1): boolean {
  if (typeof id !== 'string' || id.length === 0) {
    return false;
  }
  return UUID_V4_PATTERN.test(id) || (id.length >= minLength && SIMPLE_ID_PATTERN.test(id));
}
