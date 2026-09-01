export function normalizeHttpMetadata(
  metadata?: Record<string, string> | Headers,
): Record<string, string> {
  if (!metadata) return {};
  if (metadata instanceof Headers) {
    return Object.fromEntries(metadata.entries());
  }
  return { ...metadata };
}
