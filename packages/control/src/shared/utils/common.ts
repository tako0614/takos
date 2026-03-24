// Durable Object URL builder (formerly services/durable-object-url.ts)
const DURABLE_OBJECT_INTERNAL_ORIGIN = 'https://internal.do';

export function buildDurableObjectUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${DURABLE_OBJECT_INTERNAL_ORIGIN}${normalizedPath}`;
}

export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}
