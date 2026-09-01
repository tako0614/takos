/**
 * Serialize JSON with object keys in a stable order. Arrays retain their
 * caller-defined order, while JSON.stringify still owns toJSON/undefined/null
 * semantics and cycle rejection.
 */
export function stringifyCanonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return current;
    }
    const record = current as Record<string, unknown>;
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      sorted[key] = record[key];
    }
    return sorted;
  });
}
