// At-rest encryption for resource SECRET values, mirroring the AES-256-GCM
// protection that common-env secrets already use (common-env/crypto.ts). The raw
// secret token of a secret-typed resource lives in the portable marker file
// (and, on the Cloudflare backend, in `backing_resource_id`); without this it is
// persisted in plaintext, so anyone with backup/snapshot/disk access reads every
// resource secret even without ENCRYPTION_KEY.
//
// Decryption is intentionally legacy-tolerant: a value that is not
// encrypted-JSON (a pre-encryption plaintext secret, or one written when no key
// was configured) is returned unchanged, so existing secrets never break and the
// rollout is gradual — values become ciphertext on next write/rotation.
import {
  decrypt,
  encrypt,
  type EncryptedData,
} from "../../../shared/utils/crypto.ts";

function buildSalt(resourceId: string): string {
  return `resource-secret:${resourceId}`;
}

function isEncryptedData(value: unknown): value is EncryptedData {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.ciphertext === "string" &&
    typeof obj.iv === "string" &&
    obj.alg === "AES-256-GCM" &&
    obj.v === 1
  );
}

/** True when a stored value is already an at-rest ciphertext envelope. */
export function isEncryptedResourceSecret(stored: string): boolean {
  try {
    return isEncryptedData(JSON.parse(stored));
  } catch {
    return false;
  }
}

/**
 * Encrypt a resource secret for at-rest storage. Returns the value unchanged
 * when no encryption key is configured (the matching decrypt passthrough reads
 * it back), so a deployment without ENCRYPTION_KEY keeps working.
 */
export async function encryptResourceSecretValue(
  encryptionKey: string | undefined,
  resourceId: string,
  plaintext: string,
): Promise<string> {
  if (!encryptionKey || !plaintext) return plaintext;
  const encrypted = await encrypt(
    plaintext,
    encryptionKey,
    buildSalt(resourceId),
  );
  return JSON.stringify(encrypted);
}

/**
 * Decrypt a value stored by {@link encryptResourceSecretValue}. Legacy-tolerant:
 * non-ciphertext input (plaintext, or written without a key) is returned as-is.
 */
export async function decryptResourceSecretValue(
  encryptionKey: string | undefined,
  resourceId: string,
  stored: string,
): Promise<string> {
  if (!stored) return stored;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return stored; // not JSON → legacy plaintext
  }
  if (!isEncryptedData(parsed)) return stored; // JSON but not a ciphertext envelope
  if (!encryptionKey) return stored; // cannot decrypt without the key
  return decrypt(parsed, encryptionKey, buildSalt(resourceId));
}
