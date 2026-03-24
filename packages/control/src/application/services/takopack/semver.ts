export type SemverParts = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

// Accepts "1.2.3", "v1.2.3", and optional prerelease (e.g. "1.2.3-alpha.1").
// Build metadata is ignored for precedence.
const SEMVER_RE = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemver(version: string): SemverParts | null {
  const trimmed = String(version || '').trim();
  const m = SEMVER_RE.exec(trimmed);
  if (!m) return null;

  const major = Number.parseInt(m[1], 10);
  const minor = Number.parseInt(m[2], 10);
  const patch = Number.parseInt(m[3], 10);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  if (major < 0 || minor < 0 || patch < 0) return null;

  const prereleaseRaw = m[4];
  const prerelease = prereleaseRaw ? prereleaseRaw.split('.') : [];

  return { major, minor, patch, prerelease };
}

function isNumericIdentifier(id: string): boolean {
  return /^[0-9]+$/.test(id);
}

// Compare prerelease identifiers per semver precedence rules.
function comparePrerelease(a: string[], b: string[]): number {
  // No prerelease has higher precedence than prerelease.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1; // shorter prerelease has lower precedence
    if (bi === undefined) return 1;
    if (ai === bi) continue;

    const aNum = isNumericIdentifier(ai);
    const bNum = isNumericIdentifier(bi);

    if (aNum && bNum) {
      const an = Number.parseInt(ai, 10);
      const bn = Number.parseInt(bi, 10);
      if (an < bn) return -1;
      if (an > bn) return 1;
      continue;
    }

    // Numeric identifiers have lower precedence than non-numeric.
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;

    // Both non-numeric: ASCII sort.
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }

  return 0;
}

/**
 * Compare two semver strings.
 * Returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2.
 *
 * If either side isn't semver, falls back to a very conservative comparison:
 * - If equal strings => 0
 * - Otherwise => 0 (treat as unknown ordering)
 */
export function compareSemver(v1: string, v2: string): number {
  if (v1 === v2) return 0;

  const a = parseSemver(v1);
  const b = parseSemver(v2);
  if (!a || !b) return 0;

  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  return comparePrerelease(a.prerelease, b.prerelease);
}

// ---------------------------------------------------------------------------
// Semver range parsing & matching
// ---------------------------------------------------------------------------

type ComparatorOp = '>' | '>=' | '<' | '<=' | '=';

type Comparator = {
  op: ComparatorOp;
  version: string;
};

export type SemverRange = {
  raw: string;
  comparators: Comparator[];
};

function normalizeVersionForRange(version: string): string {
  return String(version || '').trim();
}

function bumpMajor(v: { major: number; minor: number; patch: number }): string {
  return `${v.major + 1}.0.0`;
}

function bumpMinor(v: { major: number; minor: number; patch: number }): string {
  return `${v.major}.${v.minor + 1}.0`;
}

function bumpPatch(v: { major: number; minor: number; patch: number }): string {
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

/**
 * Supported subset:
 * - exact: "1.2.3" (also accepts "v1.2.3" + prerelease)
 * - caret: "^1.2.3"
 * - tilde: "~1.2.3"
 * - comparators: ">=1.2.3", "<2.0.0", "=1.2.3"
 */
export function parseSemverRange(raw: string): SemverRange {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('Empty version range');
  }

  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(trimmed);
  if (!m) {
    throw new Error(`Invalid version range: ${trimmed}`);
  }

  const op = (m[1] || '').trim();
  const version = normalizeVersionForRange(m[2]);
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`Invalid semver in version range: ${trimmed}`);
  }

  if (!op) {
    return { raw: trimmed, comparators: [{ op: '=', version }] };
  }

  if (op === '^') {
    const upper = parsed.major > 0
      ? bumpMajor(parsed)
      : parsed.minor > 0
        ? bumpMinor(parsed)
        : bumpPatch(parsed);
    return {
      raw: trimmed,
      comparators: [
        { op: '>=', version },
        { op: '<', version: upper },
      ],
    };
  }

  if (op === '~') {
    const upper = bumpMinor(parsed);
    return {
      raw: trimmed,
      comparators: [
        { op: '>=', version },
        { op: '<', version: upper },
      ],
    };
  }

  if (op === '>' || op === '>=' || op === '<' || op === '<=' || op === '=') {
    return { raw: trimmed, comparators: [{ op, version }] };
  }

  throw new Error(`Unsupported version range operator: ${op}`);
}

export function satisfiesSemverRange(version: string, range: SemverRange): boolean {
  const v = normalizeVersionForRange(version);
  if (!parseSemver(v)) return false;

  for (const c of range.comparators) {
    if (!parseSemver(c.version)) return false;
    const cmp = compareSemver(v, c.version);
    switch (c.op) {
      case '=':
        if (cmp !== 0) return false;
        break;
      case '>':
        if (!(cmp > 0)) return false;
        break;
      case '>=':
        if (!(cmp >= 0)) return false;
        break;
      case '<':
        if (!(cmp < 0)) return false;
        break;
      case '<=':
        if (!(cmp <= 0)) return false;
        break;
      default: {
        const _exhaustive: never = c.op;
        throw new Error(`Unknown comparator op: ${_exhaustive}`);
      }
    }
  }

  return true;
}
