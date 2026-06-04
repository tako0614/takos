/**
 * Canonical SSRF IP-classification primitives, shared across takos.
 *
 * This is the single source of truth for "is this address private / internal /
 * metadata / otherwise unsafe to fetch on a caller's behalf". It used to be
 * re-implemented by hand in several places (the worker's
 * `platform-utils/validation.ts` and the git container's `host-blocklist.ts`),
 * which drifted: each copy blocked ranges the other missed. A security-critical
 * allow/deny classifier replicated by hand is a real divergence risk, so the
 * union (the strictly stronger classification) now lives here and every caller
 * delegates to it.
 *
 * `parseIpv6` turns an IPv6 literal into its 8 16-bit groups (expanding `::`,
 * folding embedded IPv4, stripping zone ids) so equivalent textual forms
 * (`::1`, `0:0:0:0:0:0:0:1`, `0000:…:0001`) classify identically instead of by
 * fragile `startsWith` matching.
 *
 * This module is dependency-free and lives under `src/contracts/` precisely so
 * the standalone git container (whose Docker image copies `src/contracts` but
 * not `src/worker`) can import it without crossing the ecosystem boundary.
 */

/** True for IPv4 dotted-quad shape (`d.d.d.d`); does not validate octet range. */
export function isIpv4Literal(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

/**
 * Classify an IPv4 dotted-quad literal as private / internal / unsafe.
 *
 * Covers RFC1918, loopback, link-local (incl. cloud-metadata 169.254.169.254),
 * carrier-grade NAT, IETF protocol assignments, the three TEST-NET ranges,
 * benchmark range, multicast / reserved high ranges and the limited broadcast
 * address. A malformed literal is treated as blocked (fail closed).
 */
export function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map((segment) => Number.parseInt(segment, 10));
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    // Malformed literal — treat as blocked to fail closed.
    return true;
  }
  const [a, b, c, d] = parts;

  // 0.0.0.0/8 — "this" network.
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918 private.
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (covers AWS/GCP metadata 169.254.169.254).
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918 private.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC1918 private.
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24 — IETF protocol assignments.
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 — documentation (TEST-NET-1).
  if (a === 192 && b === 0 && c === 2) return true;
  // 198.18.0.0/15 — benchmarking.
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 — documentation (TEST-NET-2).
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 — documentation (TEST-NET-3).
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0+ — multicast / reserved high ranges.
  if (a >= 224) return true;
  // 255.255.255.255 — limited broadcast.
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

/**
 * Parse an IPv6 literal into its 8 16-bit groups, expanding `::` and folding
 * any trailing embedded IPv4 (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`). Returns
 * null when `value` is not a syntactically valid IPv6 literal (the caller then
 * treats it as a DNS hostname). This replaces textual shape-matching so
 * equivalent forms (`::1`, `0:0:0:0:0:0:0:1`, `0000:…:0001`) all classify
 * identically.
 */
export function parseIpv6(value: string): readonly number[] | null {
  if (!value.includes(":")) return null;
  // Strip an optional zone id (`fe80::1%eth0`); it never affects classification.
  const zoneSplit = value.indexOf("%");
  const addr = zoneSplit === -1 ? value : value.slice(0, zoneSplit);

  // A literal may end with an embedded IPv4 dotted quad in its last 32 bits.
  // Rewrite it in place to two hex groups so the rest of the parser only ever
  // sees colon-separated hex, which keeps `::` handling unambiguous regardless
  // of whether the quad followed a single colon (`::ffff:1.2.3.4`) or a `::`
  // (`64:ff9b::1.2.3.4`).
  let head = addr;
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIpv4Literal(tail)) return null;
    const octets = tail.split(".").map((o) => Number.parseInt(o, 10));
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    const hi = ((octets[0] << 8) | octets[1]) & 0xffff;
    const lo = ((octets[2] << 8) | octets[3]) & 0xffff;
    head = `${addr.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
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
    const fill = 8 - (left.length + right.length);
    if (fill < 0) return null;
    groups = [
      ...left,
      ...new Array<number>(fill).fill(0),
      ...right,
    ];
  } else {
    groups = [...left, ...right];
  }
  if (groups.length !== 8) return null;
  return groups;
}

function groupsToDotted(high: number, low: number): string {
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${
    low & 0xff
  }`;
}

/**
 * Classify the parsed groups of an IPv6 literal as private / internal / unsafe.
 *
 * Covers the unspecified and loopback addresses, unique-local (fc00::/7),
 * link-local (fe80::/10), multicast (ff00::/8), and every IPv4-embedding form
 * (IPv4-mapped ::ffff:, deprecated IPv4-compatible, NAT64 64:ff9b::/96, 6to4
 * 2002::/16) by re-checking the embedded IPv4 quad.
 */
export function isPrivateIpv6Groups(groups: readonly number[]): boolean {
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
    if (isPrivateIpv4(groupsToDotted(g6, g7))) return true;
  }
  // Deprecated IPv4-compatible ::a.b.c.d (top 96 bits zero). ::/96 is IANA
  // reserved, so rejecting the whole range on a blocked low quad is safe.
  if (
    g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0 && !(g6 === 0 && g7 <= 1)
  ) {
    if (isPrivateIpv4(groupsToDotted(g6, g7))) return true;
  }
  // NAT64 well-known prefix 64:ff9b::/96 wrapping an IPv4 — classify the
  // embedded address (e.g. 64:ff9b::169.254.169.254 -> metadata).
  if (
    g0 === 0x64 && g1 === 0xff9b && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0
  ) {
    if (isPrivateIpv4(groupsToDotted(g6, g7))) return true;
  }
  // 6to4 2002:V4ADDR::/48 embeds an IPv4 in the next 32 bits after 2002.
  if (g0 === 0x2002) {
    if (isPrivateIpv4(groupsToDotted(g1, groups[2]))) return true;
  }
  return false;
}

/**
 * True when `ip` is a private / internal / metadata / otherwise-unsafe address.
 *
 * Accepts IPv4 dotted-quad and IPv6 literals (including bracketed forms and
 * embedded IPv4). A string that is neither a valid IPv4 nor IPv6 literal (e.g.
 * a DNS hostname) returns false; callers that must guard hostnames resolve them
 * to addresses first and classify each result.
 */
export function isPrivateIP(ip: string): boolean {
  const literal = ip.startsWith("[") && ip.endsWith("]")
    ? ip.slice(1, -1)
    : ip;
  if (isIpv4Literal(literal)) return isPrivateIpv4(literal);
  const groups = parseIpv6(literal);
  if (groups !== null) return isPrivateIpv6Groups(groups);
  return false;
}
