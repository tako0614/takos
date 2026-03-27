// --- URL and auth utilities ---

// Durable Object URL builder (formerly services/durable-object-url.ts)
const DURABLE_OBJECT_INTERNAL_ORIGIN = 'https://internal.do';

export function buildDurableObjectUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${DURABLE_OBJECT_INTERNAL_ORIGIN}${normalizedPath}`;
}

/** Length of the 'Bearer ' prefix used when extracting tokens. */
const BEARER_PREFIX_LENGTH = 7;

export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(BEARER_PREFIX_LENGTH).trim();
  return token || null;
}
