import type { R2ChecksumsLike } from './r2-compat-types';

/** Build an empty R2Checksums-compatible object. */
export function emptyChecksums(): R2ChecksumsLike {
  return {
    toJSON() {
      return {};
    },
  };
}
