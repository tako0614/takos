const MAX_OPAQUE_ID_LENGTH = 128;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_LOOKUP_EMAIL_LENGTH = 320;
const LOOKUP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isInvalidArrayBufferError(error: unknown): boolean {
  const message = (() => {
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
      const value = (error as { message?: unknown }).message;
      if (typeof value === "string") return value;
    }
    try {
      return String(error);
    } catch {
      return "";
    }
  })();
  return (
    /Invalid array buffer length/i.test(message) ||
    /does not exist in the current database/i.test(message)
  );
}

export function isValidOpaqueId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.length > MAX_OPAQUE_ID_LENGTH) return false;
  return OPAQUE_ID_PATTERN.test(normalized);
}

/**
 * Normalise a Drizzle text-column value to a plain string.
 *
 * SQLite `text()` columns always return strings at runtime, but Drizzle's
 * type inference sometimes widens them to `string | Date` or even `never`
 * when column definitions are composed via object spread.
 * This helper safely narrows the type so callers don't need inline casts.
 */
export function textDate(value: string | Date | unknown): string {
  return typeof value === "string"
    ? value
    : value instanceof Date
    ? value.toISOString()
    : String(value);
}

/** Nullable variant of {@link textDate}. */
export function textDateNullable(
  value: string | Date | null | undefined | unknown,
): string | null {
  return value == null ? null : textDate(value);
}

export function isValidLookupEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.length > MAX_LOOKUP_EMAIL_LENGTH) return false;
  return LOOKUP_EMAIL_PATTERN.test(normalized);
}
