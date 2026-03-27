/**
 * Worker bundle hash normalisation and integrity verification.
 */

import type { ManifestWorkerConfig } from './types';
import { computeSHA256, constantTimeEqual } from '../../../shared/utils/hash';

export function normalizeManifestBundleHash(workerConfig: ManifestWorkerConfig): string {
  const rawHash = workerConfig.bundleHash.trim().toLowerCase();
  if (!rawHash) {
    throw new Error(
      `Invalid worker bundle hash for ${workerConfig.name} (${workerConfig.bundle}): hash is empty`
    );
  }

  let digest = rawHash;
  if (rawHash.includes(':')) {
    const [algorithm, value = ''] = rawHash.split(':', 2);
    if (algorithm !== 'sha256') {
      throw new Error(
        `Invalid worker bundle hash for ${workerConfig.name} (${workerConfig.bundle}): unsupported algorithm ${algorithm}`
      );
    }
    digest = value;
  }

  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(
      `Invalid worker bundle hash for ${workerConfig.name} (${workerConfig.bundle}): expected 64-char SHA-256 hex`
    );
  }

  return digest;
}

export async function assertManifestWorkerBundleIntegrity(
  workerConfig: ManifestWorkerConfig,
  workerScriptBuffer: ArrayBuffer
): Promise<void> {
  if (!Number.isInteger(workerConfig.bundleSize) || workerConfig.bundleSize < 0) {
    throw new Error(
      `Invalid worker bundle size for ${workerConfig.name} (${workerConfig.bundle}): ${workerConfig.bundleSize}`
    );
  }

  const actualSize = workerScriptBuffer.byteLength;
  if (actualSize !== workerConfig.bundleSize) {
    throw new Error(
      `Worker bundle integrity check failed for ${workerConfig.name} (${workerConfig.bundle}): size mismatch (expected ${workerConfig.bundleSize}, got ${actualSize})`
    );
  }

  const expectedHash = normalizeManifestBundleHash(workerConfig);
  const actualHash = await computeSHA256(workerScriptBuffer);
  if (!constantTimeEqual(actualHash, expectedHash)) {
    throw new Error(
      `Worker bundle integrity check failed for ${workerConfig.name} (${workerConfig.bundle}): hash mismatch`
    );
  }
}
