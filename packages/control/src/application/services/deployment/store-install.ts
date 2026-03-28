/**
 * Store Install / Update / Uninstall -- types and helpers.
 *
 * Defines the request/response shapes for store-based app lifecycle
 * operations and provides lightweight semver comparison utilities
 * so the control plane can determine update availability without
 * pulling in a full semver library.
 */

// ── Install ─────────────────────────────────────────────────────────────────

export interface InstallRequest {
  repoId: string;
  ref?: string; // default: latest release
}

export interface InstallResult {
  installationId: string;
  version: string;
  status: 'installed' | 'failed';
  entities: {
    resources: Array<{ name: string; type: string; id: string }>;
    workers: Array<{ name: string; scriptName: string }>;
    containers: Array<{ name: string }>;
    services: Array<{ name: string }>;
  };
}

// ── Update ──────────────────────────────────────────────────────────────────

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateType: 'patch' | 'minor' | 'major' | null;
}

export interface UpdateRequest {
  targetVersion?: string; // default: latest
  autoApprove?: boolean;
}

// ── Uninstall ───────────────────────────────────────────────────────────────

export interface UninstallResult {
  deleted: Array<{ name: string; category: string }>;
}

// ── Semver helpers ──────────────────────────────────────────────────────────

/**
 * Parse a semver string into its numeric components.
 * Accepts optional `v` prefix (e.g. `v1.2.3`).
 * Returns `[major, minor, patch]` or throws on invalid input.
 */
function parseSemver(version: string): [number, number, number] {
  const cleaned = version.startsWith('v') ? version.slice(1) : version;
  const parts = cleaned.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid semver: "${version}"`);
  }
  const nums = parts.map(Number) as [number, number, number];
  if (nums.some((n) => Number.isNaN(n) || n < 0)) {
    throw new Error(`Invalid semver: "${version}"`);
  }
  return nums;
}

/**
 * Compare two semver strings.
 *
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * Determine the update type between two semver versions.
 *
 * @returns 'major' | 'minor' | 'patch'
 * @throws if current >= latest (no update available)
 */
export function getUpdateType(current: string, latest: string): 'patch' | 'minor' | 'major' {
  const [cMajor, cMinor] = parseSemver(current);
  const [lMajor, lMinor] = parseSemver(latest);

  if (lMajor !== cMajor) return 'major';
  if (lMinor !== cMinor) return 'minor';
  return 'patch';
}
