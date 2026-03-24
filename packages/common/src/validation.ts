/**
 * Validation Utilities
 *
 * Provides common validation functions for input sanitization
 * and security across all takos packages.
 */

/**
 * Check if a hostname is localhost or a local address.
 *
 * @param hostname - Hostname to check
 * @returns true if the hostname is local
 */
export function isLocalhost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localdomain') ||
    lower.endsWith('.internal')
  );
}

/**
 * Check if an IP address is a private/internal address.
 *
 * @param ip - IP address to check
 * @returns true if the IP is private
 */
export function isPrivateIP(ip: string): boolean {
  // Check for IPv4 private ranges
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c] = ipv4Match.map(Number);

    // 0.0.0.0/8 - Current network
    if (a === 0) return true;

    // 10.0.0.0/8 - Private network
    if (a === 10) return true;

    // 127.0.0.0/8 - Loopback
    if (a === 127) return true;

    // 169.254.0.0/16 - Link-local
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 - Private network
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 - Private network
    if (a === 192 && b === 168) return true;

    // 100.64.0.0/10 - Carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 192.0.0.0/24 - IETF Protocol Assignments
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 - Documentation (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;

    // 198.18.0.0/15 - Benchmarking
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 - Documentation (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 - Documentation (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0+ - Multicast and reserved
    if (a >= 224) return true;
  }

  // IPv6 private ranges
  if (ip.startsWith('::1')) return true; // Loopback
  if (ip.startsWith('fe80:')) return true; // Link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // Unique local

  // IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1 or ::ffff:0a00:0001)
  const ipLower = ip.toLowerCase();
  if (ipLower.startsWith('::ffff:')) {
    const rest = ipLower.slice('::ffff:'.length);
    // Handle dotted-decimal form: ::ffff:192.168.1.1
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest)) {
      return isPrivateIP(rest);
    }
    // Handle hex form: ::ffff:c0a8:0101 → convert to dotted-decimal
    const hexParts = rest.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIP(dotted);
      }
    }
  }

  return false;
}
