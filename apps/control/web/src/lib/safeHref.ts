const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'vbscript']);
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

export function toSafeHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;

  const trimmed = href.trim();
  if (!trimmed) return null;

  // Strip control characters and whitespace to prevent obfuscated schemes.
  // eslint-disable-next-line no-control-regex
  const compact = trimmed.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();

  for (const scheme of BLOCKED_SCHEMES) {
    if (compact.startsWith(`${scheme}:`)) {
      return null;
    }
  }

  const schemeMatch = compact.match(/^([a-z][a-z0-9+.-]*):/);
  if (!schemeMatch) {
    return trimmed;
  }

  return ALLOWED_SCHEMES.has(schemeMatch[1]) ? trimmed : null;
}
