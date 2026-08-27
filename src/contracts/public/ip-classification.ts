/**
 * Dependency-free SSRF IP-classification primitives owned by Takos.
 *
 * This is the single source of truth for the Takos worker's egress, web-fetch,
 * MCP, and standalone git-container host checks. The union of special-use
 * ranges is intentionally conservative: malformed literals are blocked, while
 * DNS names are left for the caller to resolve and classify.
 *
 * `parseIpv6` turns an IPv6 literal into its 8 16-bit groups (expanding `::`,
 * folding embedded IPv4, and stripping zone ids) so equivalent textual forms
 * classify identically instead of relying on fragile prefix matching.
 */

/** True for IPv4 dotted-quad shape (`d.d.d.d`); does not validate octet range. */
export function isIpv4Literal(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

/**
 * Classify an IPv4 dotted-quad literal as private / internal / unsafe.
 *
 * Covers RFC1918, loopback, link-local (including cloud metadata), carrier-
 * grade NAT, IETF protocol assignments, documentation ranges, benchmarking,
 * multicast / reserved high ranges, and limited broadcast. A malformed literal
 * is treated as blocked to fail closed.
 */
export function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map((segment) => Number.parseInt(segment, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b, c, d] = parts;

  // 0.0.0.0/8 — "this" network.
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918 private.
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (covers cloud metadata).
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
 * null for a syntactically invalid IPv6 value, which lets callers treat the
 * input as a DNS hostname instead.
 */
export function parseIpv6(value: string): readonly number[] | null {
  if (!value.includes(":")) return null;
  // Strip an optional zone id (`fe80::1%eth0`); it never affects classification.
  const zoneSplit = value.indexOf("%");
  const addr = zoneSplit === -1 ? value : value.slice(0, zoneSplit);

  // Rewrite an embedded IPv4 quad into two hexadecimal groups so `::` handling
  // stays unambiguous regardless of how the quad was written.
  let head = addr;
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIpv4Literal(tail)) return null;
    const octets = tail.split(".").map((octet) => Number.parseInt(octet, 10));
    if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    const hi = ((octets[0] << 8) | octets[1]) & 0xffff;
    const lo = ((octets[2] << 8) | octets[3]) & 0xffff;
    head = `${addr.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const doubleColon = head.indexOf("::");
  let leftPart: string;
  let rightPart: string;
  let hasDoubleColon = false;
  if (doubleColon !== -1) {
    if (head.indexOf("::", doubleColon + 1) !== -1) return null;
    hasDoubleColon = true;
    leftPart = head.slice(0, doubleColon);
    rightPart = head.slice(doubleColon + 2);
  } else {
    leftPart = head.replace(/:$/, "");
    rightPart = "";
  }

  const parseGroups = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const token of part.split(":")) {
      if (token.length === 0 || token.length > 4) return null;
      if (!/^[0-9a-f]+$/i.test(token)) return null;
      groups.push(Number.parseInt(token, 16) & 0xffff);
    }
    return groups;
  };

  const left = parseGroups(leftPart);
  const right = parseGroups(rightPart);
  if (left === null || right === null) return null;

  let groups: number[];
  if (hasDoubleColon) {
    const fill = 8 - (left.length + right.length);
    if (fill < 0) return null;
    groups = [...left, ...new Array<number>(fill).fill(0), ...right];
  } else {
    groups = [...left, ...right];
  }
  if (groups.length !== 8) return null;
  return groups;
}

function groupsToDotted(high: number, low: number): string {
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * Classify parsed IPv6 groups as private / internal / unsafe.
 *
 * Covers unspecified, loopback, unique-local, link-local, multicast, and
 * IPv4-embedding forms (mapped, compatible, NAT64, and 6to4) by re-checking
 * the embedded IPv4 address.
 */
export function isPrivateIpv6Groups(groups: readonly number[]): boolean {
  const [g0, g1, , , , g5, g6, g7] = groups;
  // Unspecified ::
  if (groups.every((group) => group === 0)) return true;
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
  // IPv4-mapped ::ffff:a.b.c.d; re-check IPv4.
  if (
    g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0xffff
  ) {
    if (isPrivateIpv4(groupsToDotted(g6, g7))) return true;
  }
  // Deprecated IPv4-compatible ::a.b.c.d; ::/96 itself is reserved.
  if (
    g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0 && !(g6 === 0 && g7 <= 1)
  ) {
    if (isPrivateIpv4(groupsToDotted(g6, g7))) return true;
  }
  // NAT64 well-known prefix 64:ff9b::/96.
  if (
    g0 === 0x64 && g1 === 0xff9b && groups[2] === 0 && groups[3] === 0 &&
    groups[4] === 0 && g5 === 0
  ) {
    if (isPrivateIpv4(groupsToDotted(g6, g7))) return true;
  }
  // 6to4 2002:V4ADDR::/48.
  if (g0 === 0x2002) {
    if (isPrivateIpv4(groupsToDotted(g1, groups[2]))) return true;
  }
  return false;
}

/**
 * True when an IPv4 or IPv6 literal is private / internal / unsafe.
 * Hostnames are not resolved here and therefore return false.
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
