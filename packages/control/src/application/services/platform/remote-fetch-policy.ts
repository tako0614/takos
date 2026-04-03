export function hasRemoteCapability(
  capabilities: string[],
  name: string,
): boolean {
  return capabilities.some((capability) =>
    capability === name ||
    capability.startsWith(`${name}=`)
  );
}

export function supportsRemoteBloblessFallback(
  capabilities: string[],
): boolean {
  return hasRemoteCapability(capabilities, "filter") &&
    hasRemoteCapability(capabilities, "allow-reachable-sha1-in-want");
}

export function shouldTryContentReducingFallback(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /response too large/i.test(message) ||
    /Packfile size .* exceeds limit/i.test(message) ||
    /Pack object count .* exceeds limit/i.test(message) ||
    /Inflated total .* exceeds limit/i.test(message) ||
    /Object inflated size .* exceeds limit/i.test(message) ||
    /Resolved object inflated size exceeds limit/i.test(message) ||
    /Delta result too large/i.test(message) ||
    /Delta chain depth exceeds limit/i.test(message);
}
