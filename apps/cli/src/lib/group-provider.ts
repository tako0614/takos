export const VALID_GROUP_PROVIDERS = [
  "cloudflare",
  "local",
  "aws",
  "gcp",
  "k8s",
] as const;

export type GroupProviderName = (typeof VALID_GROUP_PROVIDERS)[number];

export function parseGroupProvider(
  raw?: string,
): GroupProviderName | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if ((VALID_GROUP_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as GroupProviderName;
  }
  throw new Error(`Invalid provider: ${raw}`);
}
