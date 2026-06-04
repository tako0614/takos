/**
 * Canonical record type-guards for the worker tree.
 *
 * Both guards use the `!Array.isArray(value)` variant so a JSON array never
 * passes as a `Record`. This is the single source these guards must come from
 * within the worker tree; do not re-declare local copies.
 */

/**
 * Narrows `value` to `Record<string, unknown>` when it is a non-null, non-array
 * object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns `value` typed as `Record<string, unknown>` when it is a non-null,
 * non-array object, otherwise `null`.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
