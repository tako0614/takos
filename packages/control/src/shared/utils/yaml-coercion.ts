/**
 * YAML/JSON Value Coercion Utilities.
 *
 * Shared helpers for safely extracting typed values from parsed
 * YAML/JSON objects. Used by app-manifest and takopack manifest parsers.
 */

/**
 * Assert that `value` is a plain object and return it as a `Record`.
 * Returns an empty record when `value` is `null` or `undefined`.
 *
 * @throws {TypeError} when `value` is a non-object type (number, string, etc.)
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Expected an object but received ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Extract an optional string field from a record-like value.
 *
 * @returns the string value, or `undefined` if the field is absent or `null`.
 * @throws {TypeError} when the field exists but is not a string.
 */
export function asString(value: unknown, field: string): string | undefined {
  const record = asRecord(value);
  const v = record[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new TypeError(`Field "${field}" must be a string, got ${typeof v}`);
  }
  return v;
}

/**
 * Extract a required string field from a record-like value.
 *
 * @throws {TypeError} when the field is missing, null, or not a string.
 */
export function asRequiredString(value: unknown, field: string): string {
  const v = asString(value, field);
  if (v === undefined) {
    throw new TypeError(`Field "${field}" is required`);
  }
  return v;
}

/**
 * Extract an optional string-array field.
 *
 * @returns the array, or an empty array if the field is absent.
 * @throws {TypeError} when the field exists but is not an array of strings.
 */
export function asStringArray(value: unknown, field: string): string[] {
  const record = asRecord(value);
  const v = record[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new TypeError(`Field "${field}" must be an array, got ${typeof v}`);
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') {
      throw new TypeError(`Field "${field}[${i}]" must be a string, got ${typeof v[i]}`);
    }
  }
  return v as string[];
}

/**
 * Extract an optional `Record<string, string>` field.
 *
 * @returns the map, or an empty record if the field is absent.
 * @throws {TypeError} when the field exists but is not a valid string map.
 */
export function asStringMap(value: unknown, field: string): Record<string, string> {
  const record = asRecord(value);
  const v = record[field];
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new TypeError(`Field "${field}" must be an object, got ${Array.isArray(v) ? 'array' : typeof v}`);
  }
  const result: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'string') {
      throw new TypeError(`Field "${field}.${k}" must be a string, got ${typeof val}`);
    }
    result[k] = val;
  }
  return result;
}

/**
 * Extract an optional numeric field.
 *
 * @returns the number, or `undefined` if absent.
 * @throws {TypeError} when the field exists but is not a finite number.
 */
export function asNumber(value: unknown, field: string): number | undefined {
  const record = asRecord(value);
  const v = record[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new TypeError(`Field "${field}" must be a finite number, got ${v}`);
  }
  return v;
}

/**
 * Extract an optional boolean field.
 *
 * @returns the boolean, or `undefined` if absent.
 * @throws {TypeError} when the field exists but is not a boolean.
 */
export function asBoolean(value: unknown, field: string): boolean | undefined {
  const record = asRecord(value);
  const v = record[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') {
    throw new TypeError(`Field "${field}" must be a boolean, got ${typeof v}`);
  }
  return v;
}

/**
 * Extract an optional array field, coercing each element via a callback.
 *
 * @param coerce  Callback invoked for every element. Receives the raw item
 *                and its index.
 * @returns the coerced array, or an empty array if the field is absent.
 * @throws {TypeError} when the field exists but is not an array, or when
 *         `coerce` throws.
 */
export function asOptionalArray<T>(
  value: unknown,
  field: string,
  coerce: (item: unknown, index: number) => T,
): T[] {
  const record = asRecord(value);
  const v = record[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new TypeError(`Field "${field}" must be an array, got ${typeof v}`);
  }
  return v.map((item, i) => coerce(item, i));
}
