/**
 * SSRF host blocklist for takos-git external-import / external-fetch egress.
 *
 * takos-git accepts a caller-supplied `remoteUrl` and reaches out over the
 * network on the operator's behalf (`git fetch` / `git ls-remote`). To avoid
 * the service being used as a confused deputy against loopback / RFC1918 /
 * link-local / cloud-metadata addresses, every host is classified here before
 * any `git` subprocess runs:
 *
 *   1. IP literals (IPv4 / IPv6, including bracketed and embedded-IPv4 forms)
 *      are parsed and range-checked.
 *   2. DNS hostnames are resolved (A + AAAA) and every resolved address is
 *      range-checked. A hostname that resolves to a blocked address — or that
 *      fails to resolve at all — is rejected (fail-closed).
 *
 * DUPLICATION NOTE: this is a deliberate, near-verbatim copy of the
 * canonicalizing blocklist in takosumi `packages/installer/src/host-blocklist.ts`.
 * The two live in separate git repositories and the ecosystem boundary rules
 * forbid takos-git importing OSS source paths from takosumi, so the IP
 * classification logic is duplicated rather than shared. Keep the two parsers
 * in sync: the `host-blocklist` unit tests in both repos exercise the same
 * vector set so a divergence is caught. takos-git additionally performs DNS
 * resolution here (takosumi delegates that to operator egress policy), so only
 * the IP-classification half is shared.
 *
 * Re-resolution at `git fetch` time (DNS rebinding) is NOT prevented here — git
 * re-resolves the hostname itself. Operators must still constrain takos-git
 * network egress for full rebinding protection; this module closes the common
 * "hostname pointing at an internal IP" hole that egress policy alone is
 * awkward to express, and fails closed when resolution is unavailable.
 */
import { getEnv, isNotFoundError, resolveDns } from "./runtime.ts";

/** Outcome of classifying a host string. */
export type HostClassification =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Opt-out for environments where DNS resolution is unavailable or undesirable
 * (e.g. the resolver itself is internal-only) and the operator instead relies
 * on a hardened egress network policy. When set to "true", DNS hostnames are
 * NOT resolved and pass the host check, matching the takosumi behaviour where
 * only IP literals are blocked. IP literals are still always range-checked.
 */
function dnsResolutionDisabled(): boolean {
  return getEnv("TAKOS_GIT_SSRF_SKIP_DNS_RESOLUTION") === "true";
}

/**
 * Classify `host` (an IPv4 literal, bracketed/unbracketed IPv6 literal, or DNS
 * hostname) and reject it when it resolves to a blocked address range.
 */
export async function classifyHost(host: string): Promise<HostClassification> {
  const literal = stripIpv6Brackets(host);
  if (isIpv4Literal(literal)) {
    return isBlockedIpv4(literal)
      ? { ok: false, reason: `blocked IPv4 address: ${host}` }
      : { ok: true };
  }
  const groups = parseIpv6(literal);
  if (groups !== null) {
    return isBlockedIpv6(groups)
      ? { ok: false, reason: `blocked IPv6 address: ${host}` }
      : { ok: true };
  }

  // DNS hostname.
  if (dnsResolutionDisabled()) return { ok: true };
  return await classifyResolvedHostname(literal);
}

async function classifyResolvedHostname(
  hostname: string,
): Promise<HostClassification> {
  const addresses: string[] = [];
  let resolveError: unknown;
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const records = await resolveDns(hostname, recordType);
      addresses.push(...records);
    } catch (error) {
      // NotFound for one record type is expected (e.g. IPv4-only host has no
      // AAAA); remember the last error in case BOTH lookups fail.
      if (!isNotFoundError(error)) resolveError = error;
    }
  }
  if (addresses.length === 0) {
    // Fail closed: a host we cannot resolve to any address must not be fetched,
    // because git would resolve it through some other path we did not vet.
    const detail = resolveError instanceof Error
      ? `: ${resolveError.message}`
      : "";
    return {
      ok: false,
      reason: `host did not resolve to any address: ${hostname}${detail}`,
    };
  }
  for (const address of addresses) {
    const literal = stripIpv6Brackets(address);
    if (isIpv4Literal(literal) && isBlockedIpv4(literal)) {
      return {
        ok: false,
        reason: `host ${hostname} resolves to blocked IPv4 ${address}`,
      };
    }
    const groups = parseIpv6(literal);
    if (groups !== null && isBlockedIpv6(groups)) {
      return {
        ok: false,
        reason: `host ${hostname} resolves to blocked IPv6 ${address}`,
      };
    }
  }
  return { ok: true };
}

function stripIpv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function isIpv4Literal(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isBlockedIpv4(value: string): boolean {
  const parts = value.split(".").map((segment) => Number.parseInt(segment, 10));
  if (
    parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    // Malformed literal — treat as blocked to fail closed.
    return true;
  }
  const [a, b, c, d] = parts;
  // Loopback 127.0.0.0/8
  if (a === 127) return true;
  // RFC1918 private 10/8, 172.16/12, 192.168/16
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Link-local 169.254.0.0/16 (covers AWS/GCP metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  // Multicast / reserved high ranges
  if (a >= 224) return true;
  // Carrier-grade NAT 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Broadcast
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

/**
 * Parse an IPv6 literal into its 8 16-bit groups, expanding `::` and folding
 * any trailing embedded IPv4 (`::ffff:1.2.3.4`). Returns null when `value` is
 * not a syntactically valid IPv6 literal (the caller then treats it as a DNS
 * hostname). This replaces textual shape-matching so equivalent forms
 * (`::1`, `0:0:0:0:0:0:0:1`, `0000:...:0001`) all classify identically.
 */
export function parseIpv6(value: string): readonly number[] | null {
  if (!value.includes(":")) return null;
  // Strip an optional zone id (`fe80::1%eth0`); it never affects classification.
  const zoneSplit = value.indexOf("%");
  const addr = zoneSplit === -1 ? value : value.slice(0, zoneSplit);

  // A literal may end with an embedded IPv4 dotted quad in its last 32 bits.
  let head = addr;
  let tailGroups: number[] = [];
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIpv4Literal(tail)) return null;
    const octets = tail.split(".").map((o) => Number.parseInt(o, 10));
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    tailGroups = [
      ((octets[0] << 8) | octets[1]) & 0xffff,
      ((octets[2] << 8) | octets[3]) & 0xffff,
    ];
    head = addr.slice(0, lastColon + 1); // keep trailing ':' for splitting
  }

  const doubleColon = head.indexOf("::");
  let leftPart: string;
  let rightPart: string;
  let hasDoubleColon = false;
  if (doubleColon !== -1) {
    if (head.indexOf("::", doubleColon + 1) !== -1) return null; // only one `::`
    hasDoubleColon = true;
    leftPart = head.slice(0, doubleColon);
    rightPart = head.slice(doubleColon + 2);
  } else {
    leftPart = head.replace(/:$/, "");
    rightPart = "";
  }

  const parseGroups = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const out: number[] = [];
    for (const token of part.split(":")) {
      if (token.length === 0 || token.length > 4) return null;
      if (!/^[0-9a-f]+$/i.test(token)) return null;
      out.push(Number.parseInt(token, 16) & 0xffff);
    }
    return out;
  };

  const left = parseGroups(leftPart);
  const right = parseGroups(rightPart);
  if (left === null || right === null) return null;

  let groups: number[];
  if (hasDoubleColon) {
    const fill = 8 - (left.length + right.length + tailGroups.length);
    if (fill < 0) return null;
    groups = [
      ...left,
      ...new Array<number>(fill).fill(0),
      ...right,
      ...tailGroups,
    ];
  } else {
    groups = [...left, ...right, ...tailGroups];
  }
  if (groups.length !== 8) return null;
  return groups;
}

function isBlockedIpv6(groups: readonly number[]): boolean {
  const [g0, g1, , , , g5, g6, g7] = groups;
  // Unspecified ::
  if (groups.every((g) => g === 0)) return true;
  // Loopback ::1
  if (
    g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0 && g6 === 0 && g7 === 1
  ) {
    return true;
  }
  // fc00::/7 unique local (fc.. or fd..)
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((g0 & 0xff00) === 0xff00) return true;
  // IPv4-mapped ::ffff:a.b.c.d (g0..g4 == 0, g5 == 0xffff): re-check IPv4.
  if (
    g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0xffff
  ) {
    if (isBlockedIpv4(groupsToDotted(g6, g7))) return true;
  }
  // Deprecated IPv4-compatible ::a.b.c.d (top 96 bits zero). ::/96 is IANA
  // reserved, so rejecting the whole range on a blocked low quad is safe.
  if (
    g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0 && !(g6 === 0 && g7 <= 1)
  ) {
    if (isBlockedIpv4(groupsToDotted(g6, g7))) return true;
  }
  // NAT64 well-known prefix 64:ff9b::/96 wrapping an IPv4 — classify the
  // embedded address (e.g. 64:ff9b::169.254.169.254 -> metadata).
  if (
    g0 === 0x64 && g1 === 0xff9b && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0
  ) {
    if (isBlockedIpv4(groupsToDotted(g6, g7))) return true;
  }
  // 6to4 2002:V4ADDR::/48 embeds an IPv4 in the next 32 bits after 2002.
  if (g0 === 0x2002) {
    if (isBlockedIpv4(groupsToDotted(g1, groups[2]))) return true;
  }
  return false;
}

function groupsToDotted(high: number, low: number): string {
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${
    low & 0xff
  }`;
}
