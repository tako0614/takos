/**
 * Artifact access and cryptographic helpers for deployments.
 *
 * Handles reading bundle/wasm content from object storage, verifying
 * integrity hashes, and encrypting/decrypting env-vars and bindings
 * snapshots.
 */
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { decrypt, decryptEnvVars, maskEnvVars, type EncryptedData } from '../../../shared/utils/crypto';
import { computeSHA256, constantTimeEqual } from '../../../shared/utils/hash';
import type { Deployment, DeploymentEnv } from './models';
import { InternalError, NotFoundError, ValidationError } from 'takos-common/errors';

export async function getBundleContent(env: DeploymentEnv, deployment: Deployment): Promise<string> {
  if (!deployment.bundle_r2_key || !env.WORKER_BUNDLES) {
    throw new NotFoundError('Bundle');
  }

  const object = await env.WORKER_BUNDLES.get(deployment.bundle_r2_key);
  if (!object) {
    throw new NotFoundError(`Bundle at ${deployment.bundle_r2_key}`);
  }

  return object.text();
}

export async function verifyBundleIntegrity(bundleContent: string, deployment: Deployment): Promise<void> {
  if (deployment.bundle_hash) {
    const actual = await computeSHA256(bundleContent);
    if (!constantTimeEqual(actual, deployment.bundle_hash)) {
      throw new ValidationError(`Bundle hash mismatch: expected ${deployment.bundle_hash}, got ${actual}`);
    }
  }

  if (typeof deployment.bundle_size === 'number') {
    const size = new TextEncoder().encode(bundleContent).byteLength;
    if (size !== deployment.bundle_size) {
      throw new ValidationError(`Bundle size mismatch: expected ${deployment.bundle_size}, got ${size}`);
    }
  }
}

export async function getWasmContent(env: DeploymentEnv, deployment: Deployment): Promise<ArrayBuffer | null> {
  if (!deployment.wasm_r2_key || !env.WORKER_BUNDLES) {
    return null;
  }

  const object = await env.WORKER_BUNDLES.get(deployment.wasm_r2_key);
  if (!object) {
    return null;
  }

  return object.arrayBuffer();
}

export async function decryptBindings(encryptionKey: string, deployment: Deployment): Promise<WorkerBinding[]> {
  if (!deployment.bindings_snapshot_encrypted) {
    return [];
  }

  let encryptedParsed: unknown;
  try {
    encryptedParsed = JSON.parse(deployment.bindings_snapshot_encrypted);
  } catch (err) {
    throw new InternalError(`Failed to parse bindings_snapshot_encrypted for deployment ${deployment.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (
    typeof encryptedParsed !== 'object' || encryptedParsed === null ||
    typeof (encryptedParsed as Record<string, unknown>).ciphertext !== 'string' ||
    typeof (encryptedParsed as Record<string, unknown>).iv !== 'string'
  ) {
    throw new InternalError(`Invalid encrypted data structure for deployment ${deployment.id}: missing ciphertext or iv`);
  }
  const encrypted = encryptedParsed as EncryptedData;

  const decrypted = await decrypt(encrypted, encryptionKey, deployment.id);

  let bindingsParsed: unknown;
  try {
    bindingsParsed = JSON.parse(decrypted);
  } catch (err) {
    throw new InternalError(`Failed to parse decrypted bindings for deployment ${deployment.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(bindingsParsed)) {
    throw new InternalError(`Decrypted bindings for deployment ${deployment.id} is not an array`);
  }
  return bindingsParsed as WorkerBinding[];
}

export async function getEnvVars(encryptionKey: string, deployment: Deployment): Promise<Record<string, string>> {
  if (!deployment.env_vars_snapshot_encrypted) {
    return {};
  }

  return decryptEnvVars(
    deployment.env_vars_snapshot_encrypted,
    encryptionKey,
    deployment.id
  );
}

export async function getMaskedEnvVars(encryptionKey: string, deployment: Deployment): Promise<Record<string, string>> {
  const envVars = await getEnvVars(encryptionKey, deployment);
  return maskEnvVars(envVars);
}
