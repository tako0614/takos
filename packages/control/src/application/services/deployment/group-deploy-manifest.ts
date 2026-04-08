/**
 * Legacy mirror module retained for deploy-pipeline callers during the
 * Phase 2 cascade fix.
 *
 * The canonical manifest type lives in
 * `../source/app-manifest-types.ts`. Older deploy-pipeline code references
 * the names `AppManifest`, `AppResource`, `WorkerService`, `AppResourceType`
 * and `AppRoute` — we re-export the flat-schema equivalents here so the
 * existing import sites keep compiling while the cascade fix is in flight.
 */
export type {
  AppCompute as WorkerService,
  AppManifest,
  AppRoute,
  AppStorage as AppResource,
  StorageType as AppResourceType,
} from "../source/app-manifest-types.ts";
