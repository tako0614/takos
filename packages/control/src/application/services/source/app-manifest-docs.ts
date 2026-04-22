// ============================================================
// app-manifest-docs.ts
// ============================================================
//
// Historical helper that now forwards to the bundle-doc generator.
// Keeping this file as a thin passthrough so existing imports resolve;
// new code should call `buildBundleDocs` from
// `app-manifest-bundle-docs.ts` directly.
// ============================================================

import type {
  AppManifest,
  BundleDoc,
  GroupDeploymentSnapshotBuildSource,
} from "./app-manifest-types.ts";
import { buildBundleDocs } from "./app-manifest-bundle-docs.ts";

export function emitNewFormatDocs(
  manifest: AppManifest,
  buildSources: Map<string, GroupDeploymentSnapshotBuildSource>,
  docs: BundleDoc[],
): void {
  for (const doc of buildBundleDocs(manifest, buildSources)) {
    docs.push(doc);
  }
}
