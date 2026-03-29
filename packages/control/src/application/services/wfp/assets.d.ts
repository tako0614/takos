/**
 * Static-asset upload helpers for the WFP (Workers for Platforms) service.
 *
 * Implements the Cloudflare Assets upload flow: create an upload session with
 * a content-hash manifest, upload only the files that are not already cached,
 * and receive a completion JWT that is attached to the worker deployment
 * metadata so the assets are served alongside the worker.
 */
import type { WFPConfig } from './client';
import type { WfpClient } from './client';
/** Manifest entry for static assets upload */
export interface AssetManifestEntry {
    hash: string;
    size: number;
}
/** File data for upload including content type */
export interface AssetUploadFile {
    base64Content: string;
    contentType: string;
}
/** Response from assets upload session creation */
export interface AssetsUploadSession {
    jwt: string;
    /** Files that need to be uploaded (not already cached) */
    uploadNeeded: string[];
}
/** Response from assets upload completion */
export interface AssetsUploadCompletion {
    jwt: string;
}
/**
 * Create an assets upload session for a worker
 * Returns a JWT token and list of files that need uploading
 */
export declare function createAssetsUploadSession(client: WfpClient, config: WFPConfig, workerName: string, manifest: Record<string, AssetManifestEntry>): Promise<AssetsUploadSession>;
/**
 * Upload asset files using the session JWT
 * Files should include content type for proper MIME type when serving
 * Returns the completion JWT from the response
 * S22: Added timeout for upload operations (60 seconds for larger files)
 */
export declare function uploadAssets(config: WFPConfig, sessionJwt: string, files: Record<string, AssetUploadFile>): Promise<string>;
/**
 * Helper: Upload all assets and return completion JWT
 * Combines createAssetsUploadSession and uploadAssets
 *
 * Per Cloudflare docs:
 * - If all assets are cached (buckets empty), session JWT IS the completion token
 * - If files were uploaded, upload response contains completion JWT
 */
export declare function uploadAllAssets(client: WfpClient, config: WFPConfig, workerName: string, files: Array<{
    path: string;
    content: ArrayBuffer;
    contentType?: string;
}>): Promise<string>;
//# sourceMappingURL=assets.d.ts.map