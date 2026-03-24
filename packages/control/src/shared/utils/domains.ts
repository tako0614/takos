const VERIFICATION_TOKEN_LENGTH = 32;

export function generateVerificationToken(): string {
  const buffer = new Uint8Array(VERIFICATION_TOKEN_LENGTH);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateDomainId(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return 'dom_' + Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  const normalized = domain.endsWith('.') ? domain.slice(0, -1) : domain;
  const labels = normalized.split('.');
  if (labels.length < 2) return false;

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) return false;
  }

  return true;
}

export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/\.+$/, '');
}
