// --- Date/time utilities ---

export function now(): string {
  return new Date().toISOString();
}

export function toIsoString(value: string | Date): string;
export function toIsoString(value: string | Date | null | undefined): string | null;
export function toIsoString(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

export function toRequiredIsoString(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}
