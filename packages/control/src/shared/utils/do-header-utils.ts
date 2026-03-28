/**
 * Header sanitization for Durable Object requests.
 *
 * This utility is shared across routes, application, and runtime layers.
 */

/**
 * Headers that only trusted Worker code may set.
 * Any value arriving from an external source (container, client) is stripped
 * before the request is forwarded to a Durable Object.
 */
const INTERNAL_ONLY_HEADERS = [
  'X-Takos-Internal',
  'X-WS-Auth-Validated',
  'X-WS-User-Id',
] as const;

/**
 * Build a sanitized header record for forwarding requests to Durable Objects.
 *
 * 1. Copies all headers from `source`.
 * 2. Strips every header in INTERNAL_ONLY_HEADERS (untrusted input cannot set them).
 * 3. Applies `trustedOverrides` — values that the calling Worker has verified.
 *
 * Returns a plain `Record<string, string>` ready for `fetch()` init.
 */
export function buildSanitizedDOHeaders(
  source: HeadersInit | undefined,
  trustedOverrides: Record<string, string>,
): Record<string, string> {
  const headers = new Headers(source);
  for (const name of INTERNAL_ONLY_HEADERS) {
    headers.delete(name);
  }
  for (const [key, value] of Object.entries(trustedOverrides)) {
    headers.set(key, value);
  }
  const result: Record<string, string> = {};
  headers.forEach((v, k) => { result[k] = v; });
  return result;
}
