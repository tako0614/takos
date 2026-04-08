// ============================================================
// parse-common.ts
// ============================================================
//
// Flat-schema shared helpers. Phase 1 only exposes semver
// validation; lifecycle/update-strategy/dependsOn helpers were
// removed when the envelope schema retired. Phase 2 adds any
// flat-schema equivalents the deploy pipeline needs.
// ============================================================

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;

export function validateSemver(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`version must be valid semver (got "${version}")`);
  }
}
