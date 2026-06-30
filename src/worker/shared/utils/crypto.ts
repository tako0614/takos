import { base64ToBytes, bytesToBase64, hexToBytes } from "./encoding-utils.ts";

/** Number of PBKDF2 iterations for key derivation. */
const PBKDF2_ITERATIONS = 100_000;

/** Byte length of the AES-GCM initialization vector. */
const AES_GCM_IV_BYTE_LENGTH = 12;

/** AES key length in bits. */
const AES_KEY_LENGTH_BITS = 256;

/** Expected length of a hex-encoded 32-byte secret (without 0x prefix). */
const HEX_ENCODED_SECRET_LENGTH = 64;

/** Length of the '0x' hex prefix. */
const HEX_PREFIX_LENGTH = 2;

/** Fixed mask for any non-empty value (never reveals length or any plaintext). */
const MASK_PLACEHOLDER = "********";

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  alg: "AES-256-GCM";
  v: 1;
}

async function deriveKey(
  masterSecret: string,
  salt: string,
): Promise<CryptoKey> {
  const secretBytesRaw = masterSecret.startsWith("0x")
    ? hexToBytes(masterSecret.slice(HEX_PREFIX_LENGTH))
    : masterSecret.length === HEX_ENCODED_SECRET_LENGTH
    ? hexToBytes(masterSecret)
    : new TextEncoder().encode(masterSecret);

  const secretBytes = new Uint8Array(secretBytesRaw).buffer as ArrayBuffer;

  const saltBytes = new TextEncoder().encode(salt);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(
  plaintext: string,
  masterSecret: string,
  salt: string,
): Promise<EncryptedData> {
  const key = await deriveKey(masterSecret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTE_LENGTH));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    alg: "AES-256-GCM",
    v: 1,
  };
}

export async function decrypt(
  encrypted: EncryptedData,
  masterSecret: string,
  salt: string,
): Promise<string> {
  if (encrypted.alg !== "AES-256-GCM" || encrypted.v !== 1) {
    throw new Error(
      `Unsupported encryption format: ${encrypted.alg} v${encrypted.v}`,
    );
  }

  const key = await deriveKey(masterSecret, salt);
  const ivRaw = base64ToBytes(encrypted.iv);
  const ciphertextRaw = base64ToBytes(encrypted.ciphertext);
  const iv = new Uint8Array(ivRaw).buffer as ArrayBuffer;
  const ciphertext = new Uint8Array(ciphertextRaw).buffer as ArrayBuffer;

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintextBytes);
}

/**
 * Strict shape guard for a parsed {@link EncryptedData} envelope. Matches what
 * {@link decrypt} accepts (alg + v), so callers can validate a stored value
 * before decryption instead of a bare `JSON.parse(...) as EncryptedData` cast.
 */
export function isEncryptedData(raw: unknown): raw is EncryptedData {
  if (typeof raw !== "object" || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  return typeof candidate.ciphertext === "string" &&
    typeof candidate.iv === "string" &&
    candidate.alg === "AES-256-GCM" &&
    candidate.v === 1;
}

/**
 * Single-value envelope encrypt: AES-256-GCM, serialized to the canonical
 * `JSON.stringify(EncryptedData)` at-rest format. Companion of
 * {@link decryptEnvelope}; use these instead of re-rolling
 * `JSON.stringify(await encrypt(...))` per domain.
 */
export async function encryptEnvelope(
  value: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  return JSON.stringify(await encrypt(value, masterSecret, salt));
}

/**
 * Single-value envelope decrypt with strict shape validation. Rejects a
 * malformed stored value up front with a clear error rather than relying on
 * `decrypt`'s internal alg/v guard after a bare cast.
 */
export async function decryptEnvelope(
  stored: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    throw new Error("decryptEnvelope: stored value is not valid JSON");
  }
  if (!isEncryptedData(raw)) {
    throw new Error(
      "decryptEnvelope: stored value is not a valid EncryptedData envelope",
    );
  }
  return decrypt(raw, masterSecret, salt);
}

export async function encryptEnvVars(
  envVars: Record<string, string>,
  masterSecret: string,
  salt: string,
): Promise<string> {
  const plaintext = JSON.stringify(envVars);
  const encrypted = await encrypt(plaintext, masterSecret, salt);
  return JSON.stringify(encrypted);
}

export async function decryptEnvVars(
  encryptedJson: string,
  masterSecret: string,
  salt: string,
): Promise<Record<string, string>> {
  let encrypted: EncryptedData;
  try {
    const raw = JSON.parse(encryptedJson);
    if (
      typeof raw !== "object" || raw === null ||
      typeof raw.ciphertext !== "string" ||
      typeof raw.iv !== "string" ||
      raw.alg !== "AES-256-GCM"
    ) {
      throw new Error(
        "decryptEnvVars: encryptedJson does not have expected EncryptedData shape (ciphertext, iv, alg)",
      );
    }
    encrypted = raw as EncryptedData;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("decryptEnvVars: encryptedJson is not valid JSON");
    }
    throw err;
  }
  const plaintext = await decrypt(encrypted, masterSecret, salt);
  let parsed: Record<string, string>;
  try {
    const raw = JSON.parse(plaintext);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(
        "decryptEnvVars: decrypted plaintext is not a valid key-value object",
      );
    }
    parsed = raw as Record<string, string>;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("decryptEnvVars: decrypted plaintext is not valid JSON");
    }
    throw err;
  }
  return parsed;
}

function maskValue(value: string): string {
  // This masked map mixes plain_text and secret_text values without a secret
  // flag, so it must never reveal any plaintext — a prefix/suffix-revealing
  // mask leaked the leading/trailing chars of API keys. Full-mask everything,
  // matching the `bindings[]` secret projection.
  return value.length > 0 ? MASK_PLACEHOLDER : "";
}

export function maskEnvVars(
  envVars: Record<string, string>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    masked[key] = maskValue(value);
  }
  return masked;
}
