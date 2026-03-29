/**
 * Static-asset upload helpers for the WFP (Workers for Platforms) service.
 *
 * Implements the Cloudflare Assets upload flow: create an upload session with
 * a content-hash manifest, upload only the files that are not already cached,
 * and receive a completion JWT that is attached to the worker deployment
 * metadata so the assets are served alongside the worker.
 */

import type { WFPConfig, CFAPIResponse } from './client';
import { CF_API_BASE, sanitizeErrorMessage } from './client';
import type { WfpClient } from './client';
import { bytesToHex, bytesToBase64 } from '../../../shared/utils/encoding-utils';

const ASSET_UPLOAD_TIMEOUT_MS = 60_000;

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
export async function createAssetsUploadSession(
  client: WfpClient,
  config: WFPConfig,
  workerName: string,
  manifest: Record<string, AssetManifestEntry>
): Promise<AssetsUploadSession> {
  const response = await client.fetch<{
    jwt: string;
    buckets?: Array<Array<string>>;
  }>(
    `/accounts/${config.accountId}/workers/dispatch/namespaces/${config.dispatchNamespace}/scripts/${workerName}/assets-upload-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest }),
    }
  );

  // buckets contains arrays of hashes that need uploading
  const uploadNeeded: string[] = [];
  if (response.result.buckets) {
    for (const bucket of response.result.buckets) {
      uploadNeeded.push(...bucket);
    }
  }

  return {
    jwt: response.result.jwt,
    uploadNeeded,
  };
}

/**
 * Upload asset files using the session JWT
 * Files should include content type for proper MIME type when serving
 * Returns the completion JWT from the response
 * S22: Added timeout for upload operations (60 seconds for larger files)
 */
export async function uploadAssets(
  config: WFPConfig,
  sessionJwt: string,
  files: Record<string, AssetUploadFile>  // hash -> { base64Content, contentType }
): Promise<string> {
  const formData = new FormData();
  for (const [hash, file] of Object.entries(files)) {
    // Create Blob with correct content type - CF uses this for serving
    const blob = new Blob([file.base64Content], { type: file.contentType });
    formData.append(hash, blob, hash);
  }

  // S22: 60 second timeout for uploads (files can be large)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ASSET_UPLOAD_TIMEOUT_MS);

  try {
    // This endpoint uses the session JWT for auth, not the API token
    const url = `${CF_API_BASE}/accounts/${config.accountId}/workers/assets/upload?base64=true`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionJwt}`,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // S7 Fix: Sanitize error message before throwing
      throw new Error(`Assets upload failed: ${sanitizeErrorMessage(errorText)}`);
    }

    // Parse response to get completion JWT
    const data = await response.json() as CFAPIResponse<{ jwt: string }>;
    if (!data.success || !data.result?.jwt) {
      throw new Error('Assets upload succeeded but no completion JWT in response');
    }

    return data.result.jwt;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Assets upload timeout after 60 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper: Upload all assets and return completion JWT
 * Combines createAssetsUploadSession and uploadAssets
 *
 * Per Cloudflare docs:
 * - If all assets are cached (buckets empty), session JWT IS the completion token
 * - If files were uploaded, upload response contains completion JWT
 */
export async function uploadAllAssets(
  client: WfpClient,
  config: WFPConfig,
  workerName: string,
  files: Array<{ path: string; content: ArrayBuffer; contentType?: string }>
): Promise<string> {
  // Build manifest with hashes
  // Hash must be first 32 hex characters of SHA-256 (per CF docs)
  const manifest: Record<string, AssetManifestEntry> = {};
  const fileMap: Record<string, { path: string; content: ArrayBuffer; contentType: string }> = {};

  for (const file of files) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', file.content);
    const fullHash = bytesToHex(new Uint8Array(hashBuffer));
    // Use first 32 hex characters as required by Cloudflare
    const hash = fullHash.slice(0, 32);

    manifest[file.path] = {
      hash,
      size: file.content.byteLength,
    };
    fileMap[hash] = {
      ...file,
      contentType: file.contentType || getContentTypeFromPath(file.path),
    };
  }

  // Create upload session
  const session = await createAssetsUploadSession(client, config, workerName, manifest);

  // If no files need uploading (all cached), session JWT IS the completion token
  if (session.uploadNeeded.length === 0) {
    return session.jwt;
  }

  // Upload files that need uploading
  const toUpload: Record<string, AssetUploadFile> = {};
  for (const hash of session.uploadNeeded) {
    const file = fileMap[hash];
    if (file) {
      // Convert ArrayBuffer to base64
      toUpload[hash] = {
        base64Content: bytesToBase64(new Uint8Array(file.content)),
        contentType: file.contentType,
      };
    }
  }

  if (Object.keys(toUpload).length === 0) {
    // Edge case: needed uploads but files not found - use session JWT
    return session.jwt;
  }

  // Upload returns the completion JWT
  return await uploadAssets(config, session.jwt, toUpload);
}

function getContentTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    'html': 'text/html',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'css': 'text/css',
    'json': 'application/json',
    'svg': 'image/svg+xml',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'eot': 'application/vnd.ms-fontobject',
    'webp': 'image/webp',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'wasm': 'application/wasm',
  };
  return types[ext || ''] || 'application/octet-stream';
}
