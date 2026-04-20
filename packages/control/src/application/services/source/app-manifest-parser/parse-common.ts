// ============================================================
// parse-common.ts
// ============================================================
//
// Flat-schema shared helpers.
// ============================================================

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;

export function validateSemver(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`version must be valid semver (got "${version}")`);
  }
}
