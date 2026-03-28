/**
 * DNS Constants
 *
 * Shared constants for DNS-over-HTTPS (DoH) resolution used across
 * the control package (egress filtering, web tools, custom domain verification).
 */

/** Cloudflare DNS-over-HTTPS JSON API endpoint. */
export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/** Timeout (ms) for individual DoH resolution requests. */
export const DNS_RESOLVE_TIMEOUT_MS = 5000;
