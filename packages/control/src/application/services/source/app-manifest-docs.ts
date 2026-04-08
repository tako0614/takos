// ============================================================
// app-manifest-docs.ts
// ============================================================
//
// Historical helper that emitted bundle docs from the envelope manifest
// schema. Phase 1 retired the envelope in favor of the flat schema and
// the bundle generation logic was absorbed into
// `app-manifest-bundle-docs.ts`. Keeping this file as a thin passthrough
// so existing imports resolve — any new code should call
// `buildBundleDocs` from `app-manifest-bundle-docs.ts` directly.
// ============================================================

import type {
  AppDeploymentBuildSource,
  AppManifest,
  BundleDoc,
} from "./app-manifest-types.ts";
import { buildBundleDocs } from "./app-manifest-bundle-docs.ts";

export function emitNewFormatDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppDeploymentBuildSource>,
  docs: BundleDoc[],
): void {
  for (const doc of buildBundleDocs(manifest, buildSources)) {
    docs.push(doc);
  }
}
