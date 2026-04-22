import { lookup } from "node:dns/promises";

export const MAX_ALLOWED_DOMAINS = 128;
export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function isValidDomainPattern(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false;
  const normalized = domain.toLowerCase();
  const pattern =
    /^\*?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$|^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
  if (!pattern.test(normalized)) return false;
  if (normalized.startsWith("*") && !normalized.startsWith("*.")) return false;
  return true;
}

export function normalizeAllowedDomains(domains: unknown): string[] {
  if (!Array.isArray(domains)) return [];
  if (domains.length > MAX_ALLOWED_DOMAINS) {
    throw new Error(`Too many allowed domains (max ${MAX_ALLOWED_DOMAINS})`);
  }

  const normalized = new Set<string>();
  for (const rawDomain of domains) {
    if (typeof rawDomain !== "string") {
      throw new Error("Allowed domains must be strings");
    }
    const domain = rawDomain.trim().toLowerCase();
    if (!isValidDomainPattern(domain)) {
      throw new Error(`Invalid allowed domain pattern: ${rawDomain}`);
    }
    normalized.add(domain);
  }

  return Array.from(normalized);
}

export function isPrivateIPv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((o) => !Number.isFinite(o) || o < 0 || o > 255)
  ) {
    return true; // treat malformed as private (deny by default)
  }
  const [a, b] = octets;
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31);
}

export function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase();
  // Unspecified address
  if (normalized === "::") return true;
  // Loopback (::1 and expanded forms like 0:0:0:0:0:0:0:1)
  if (normalized === "::1") return true;
  const collapsed = normalized.replace(/(^|:)0+(?=\d)/g, "$1").replace(
    /(:0)+:/,
    "::",
  );
  if (collapsed === "::1") return true;
  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) — check the embedded IPv4 part
  const v4MappedMatch = normalized.match(
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (v4MappedMatch) {
    return isPrivateIPv4(v4MappedMatch[1]);
  }
  // IPv4-compatible IPv6 addresses (::x.x.x.x, deprecated but still seen)
  const v4CompatMatch = normalized.match(
    /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (v4CompatMatch) {
    return isPrivateIPv4(v4CompatMatch[1]);
  }
  // Unique local addresses fc00::/7
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // Link-local fe80::/10
  if (
    normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb")
  ) {
    return true;
  }
  // Multicast ff00::/8
  if (normalized.startsWith("ff")) return true;
  // 6to4 addresses 2002::/16 — embedded IPv4 in bits 16-47
  if (normalized.startsWith("2002:")) {
    const parts = normalized.split(":");
    if (parts.length >= 3) {
      const hi = parseInt(parts[1], 16);
      const lo = parseInt(parts[2], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        const embeddedIp = `${(hi >> 8) & 0xff}.${hi & 0xff}.${
          (lo >> 8) & 0xff
        }.${lo & 0xff}`;
        if (isPrivateIPv4(embeddedIp)) return true;
      }
    }
  }
  // Teredo addresses 2001:0000::/32 — embedded IPv4 in last 32 bits (obfuscated)
  if (normalized.startsWith("2001:0000:") || normalized.startsWith("2001:0:")) {
    return true; // Block all Teredo addresses as they embed arbitrary IPv4
  }
  return false;
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    return isPrivateIPv6(host);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return isPrivateIPv4(host);
  }
  return false;
}

export function isDomainAllowed(
  hostname: string,
  allowedDomains: string[],
): boolean {
  const normalizedHost = hostname.toLowerCase();
  return allowedDomains.some((domain) => {
    if (domain.startsWith("*.")) {
      const suffix = domain.slice(2);
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
    }
    return normalizedHost === domain;
  });
}

export async function resolveHostnameIPs(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  const addresses = records
    .map((r) => r.address)
    .filter((addr): addr is string =>
      typeof addr === "string" && addr.length > 0
    );
  return [...new Set(addresses)];
}

export function parseFetchUrl(url: unknown): URL {
  if (url instanceof URL) return url;
  if (typeof url === "string") return new URL(url);

  const maybeUrl = url && typeof url === "object"
    ? (url as { url?: unknown }).url
    : undefined;
  if (typeof maybeUrl === "string") return new URL(maybeUrl);

  throw new Error("Invalid fetch URL");
}

export async function assertOutboundUrlAllowed(
  targetUrl: URL,
  allowedDomains: string[],
): Promise<void> {
  if (!ALLOWED_PROTOCOLS.has(targetUrl.protocol)) {
    throw new Error(
      `Network access denied: protocol ${targetUrl.protocol} is not allowed`,
    );
  }

  const hostname = targetUrl.hostname.toLowerCase();
  if (isPrivateOrLocalHost(hostname)) {
    throw new Error(`Network access denied: private/local host ${hostname}`);
  }

  if (!isDomainAllowed(hostname, allowedDomains)) {
    throw new Error(
      `Network access denied: ${hostname} not in allowed domains`,
    );
  }

  const resolvedIps = await resolveHostnameIPs(hostname);
  if (resolvedIps.length === 0) {
    throw new Error(`Network access denied: failed to resolve ${hostname}`);
  }

  for (const ip of resolvedIps) {
    if (isPrivateOrLocalHost(ip)) {
      throw new Error(
        `Network access denied: ${hostname} resolved to private/local IP ${ip}`,
      );
    }
  }
}
