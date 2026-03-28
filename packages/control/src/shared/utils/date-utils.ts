// --- Date/time utilities ---

export function toIsoString(value: string | Date): string;
export function toIsoString(value: string | Date | null | undefined): string | null;
export function toIsoString(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

