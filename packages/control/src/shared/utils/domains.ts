const VERIFICATION_TOKEN_LENGTH = 32;

/** Byte length of a generated domain ID (produces a 32-char hex string). */
const DOMAIN_ID_BYTE_LENGTH = 16;

/** Maximum total length of a valid domain name (RFC 1035). */
const MAX_DOMAIN_LENGTH = 253;

/** Maximum length of a single DNS label (RFC 1035). */
const MAX_DNS_LABEL_LENGTH = 63;

/** Minimum number of labels required for a valid domain (e.g. "example.com"). */
const MIN_DOMAIN_LABELS = 2;

export function generateVerificationToken(): string {
  const buffer = new Uint8Array(VERIFICATION_TOKEN_LENGTH);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateDomainId(): string {
  const buffer = new Uint8Array(DOMAIN_ID_BYTE_LENGTH);
  crypto.getRandomValues(buffer);
  return 'dom_' + Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return false;
  const normalized = domain.endsWith('.') ? domain.slice(0, -1) : domain;
  const labels = normalized.split('.');
  if (labels.length < MIN_DOMAIN_LABELS) return false;

  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_DNS_LABEL_LENGTH) return false;
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) return false;
  }

  return true;
}

export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/\.+$/, '');
}
