/**
 * WFP (Workers for Platforms) -- public barrel export.
 *
 * WFP is Cloudflare's multi-tenant worker isolation product. This module wraps
 * the Cloudflare API to let Takos provision and manage per-tenant workers
 * inside a dispatch namespace, together with their resource bindings (D1, R2,
 * KV, Queues, Vectorize) and static-asset uploads.
 *
 * @see https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
 */

export {
  type WorkerBinding,
  type CloudflareBindingRecord,
  createWfpService,
  WFPService,
} from './service.ts';
export { getTakosWorkerScript, getTakosMigrationSQL } from './orchestrator.ts';
export type { AssetManifestEntry, AssetUploadFile, AssetsUploadSession, AssetsUploadCompletion } from './assets.ts';
export {
  CF_API_BASE,
  WfpClient,
  resolveWfpConfig,
  createWfpConfig,
  type WfpEnv,
  type WFPConfig,
  type CFAPIResponse,
  type CloudflareAPIError,
} from './client.ts';
export {
  createAssetsUploadSession,
  uploadAssets,
  uploadAllAssets,
} from './assets.ts';
