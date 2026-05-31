/**
 * Cloudflare provider adapter -- public barrel export.
 *
 * This module wraps the Cloudflare API to let Takos provision and manage
 * per-tenant runtimes inside a dispatch namespace, together with SQL,
 * object-store, KV, message-queue, vector-search, and static-asset bindings.
 *
 * @see https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
 */

export {
  type CloudflareBindingRecord,
  createWfpService,
  WFPService,
  type WorkerBinding,
} from "./service.ts";
export { getTakosMigrationSQL, getTakosWorkerScript } from "./orchestrator.ts";
export type {
  AssetManifestEntry,
  AssetsUploadCompletion,
  AssetsUploadSession,
  AssetUploadFile,
} from "./assets.ts";
export {
  CF_API_BASE,
  type CFAPIResponse,
  type CloudflareAPIError,
  createWfpConfig,
  resolveWfpConfig,
  WfpClient,
  type WFPConfig,
  type WfpEnv,
} from "./client.ts";
export {
  createAssetsUploadSession,
  uploadAllAssets,
  uploadAssets,
} from "./assets.ts";
