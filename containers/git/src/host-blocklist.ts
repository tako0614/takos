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
 * IP-CLASSIFICATION SOURCE: the range checks live in the canonical takos
 * classifier `src/contracts/public/ip-classification.ts` and are shared here
 * rather than re-derived. The classifier is dependency-free and lives under
 * `src/contracts/`, which the git container's Docker image copies, so this
 * standalone container imports it without crossing the ecosystem boundary.
 * This module keeps only the git-specific concerns: stripping IPv6 brackets,
 * the DNS-resolution wrapper (takos-git resolves A/AAAA and range-checks every
 * result; takosumi delegates that to operator egress policy) and the
 * fail-closed behaviour when resolution is unavailable.
 *
 * The takosumi reference blocklist (`src/contract/reference/host-blocklist.ts`)
 * is a separate copy in a separate repository; the `host-blocklist` unit tests
 * in both repos exercise the same vector set so a divergence is caught.
 *
 * Re-resolution at `git fetch` time (DNS rebinding) is NOT prevented here — git
 * re-resolves the hostname itself. Operators must still constrain takos-git
 * network egress for full rebinding protection; this module closes the common
 * "hostname pointing at an internal IP" hole that egress policy alone is
 * awkward to express, and fails closed when resolution is unavailable.
 */
import { getEnv, isNotFoundError, resolveDns } from "./runtime.ts";
import {
  isIpv4Literal,
  isPrivateIpv4 as isBlockedIpv4,
  isPrivateIpv6Groups as isBlockedIpv6,
  parseIpv6,
} from "../../../src/contracts/public/ip-classification.ts";

// Host-blocklist tests and callers use this module as the parseIpv6 entrypoint.
export { parseIpv6 };

/** Outcome of classifying a host string. */
export type HostClassification = { ok: true } | { ok: false; reason: string };

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
    const detail =
      resolveError instanceof Error ? `: ${resolveError.message}` : "";
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
