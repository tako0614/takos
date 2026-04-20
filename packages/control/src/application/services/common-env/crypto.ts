import type { Env } from "../../../shared/types/index.ts";
import {
  decrypt,
  encrypt,
  type EncryptedData,
} from "../../../shared/utils/crypto.ts";
import {
  bytesToHex,
  hexToBytes,
  sha256Hex,
} from "../../../shared/utils/encoding-utils.ts";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseSecretBytes(secret: string): Uint8Array {
  const normalized = secret.startsWith("0x") ? secret.slice(2) : secret;
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return hexToBytes(normalized);
  }
  const encoded = new TextEncoder().encode(secret);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toBufferSource(parseSecretBytes(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function normalizeEnvName(name: string): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Environment variable name is required");
  if (!ENV_NAME_PATTERN.test(trimmed)) {
    throw new Error(`Invalid environment variable name: ${trimmed}`);
  }
  return trimmed.toUpperCase();
}

export function uniqueEnvNames(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    out.add(normalizeEnvName(name));
  }
  return Array.from(out.values());
}

export function getCommonEnvSecret(env: Pick<Env, "ENCRYPTION_KEY">): string {
  const secret = env.ENCRYPTION_KEY || "";
  if (!secret) {
    throw new Error("ENCRYPTION_KEY must be set");
  }
  return secret;
}

function buildSalt(spaceId: string, envName: string): string {
  return `common-env:${spaceId}:${normalizeEnvName(envName)}`;
}

function buildLegacySalt(spaceId: string, envName: string): string {
  return `common-env:${spaceId}:${String(envName || "").trim()}`;
}

export async function encryptCommonEnvValue(
  env: Pick<Env, "ENCRYPTION_KEY">,
  spaceId: string,
  envName: string,
  value: string,
): Promise<string> {
  const encrypted = await encrypt(
    value,
    getCommonEnvSecret(env),
    buildSalt(spaceId, envName),
  );
  return JSON.stringify(encrypted);
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

export async function decryptCommonEnvValue(
  env: Pick<Env, "ENCRYPTION_KEY">,
  row: { space_id: string; name: string; value_encrypted: string },
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value_encrypted);
  } catch (err) {
    throw new Error(
      `Failed to parse encrypted value for env var "${row.name}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!isEncryptedData(parsed)) {
    throw new Error(
      `Invalid encrypted data structure for env var "${row.name}": missing or invalid ciphertext/iv/alg/v fields`,
    );
  }
  try {
    return await decrypt(
      parsed,
      getCommonEnvSecret(env),
      buildSalt(row.space_id, row.name),
    );
  } catch {
    // Backward compatibility for rows encrypted before canonical env-name normalization.
    return decrypt(
      parsed,
      getCommonEnvSecret(env),
      buildLegacySalt(row.space_id, row.name),
    );
  }
}

function buildFingerprintInput(
  spaceId: string,
  envName: string,
  type: "plain_text" | "secret_text",
  text: string,
): string {
  return `takos.common-env.fp.v2\n${spaceId}\n${
    normalizeEnvName(envName)
  }\n${type}\n${text}`;
}

export async function createBindingFingerprint(params: {
  env: Pick<Env, "ENCRYPTION_KEY">;
  spaceId: string;
  envName: string;
  type: "plain_text" | "secret_text";
  text?: string;
}): Promise<string | null> {
  if (typeof params.text !== "string") return null;
  const hmac = await hmacSha256Hex(
    getCommonEnvSecret(params.env),
    buildFingerprintInput(
      params.spaceId,
      params.envName,
      params.type,
      params.text,
    ),
  );
  return `v2:${hmac}`;
}

export async function fingerprintMatches(params: {
  env: Pick<Env, "ENCRYPTION_KEY">;
  stored: string | null | undefined;
  spaceId: string;
  envName: string;
  type: "plain_text" | "secret_text";
  text?: string;
}): Promise<boolean> {
  if (!params.stored || typeof params.text !== "string") return false;
  if (params.stored.startsWith("v2:")) {
    const candidate = await createBindingFingerprint({
      env: params.env,
      spaceId: params.spaceId,
      envName: params.envName,
      type: params.type,
      text: params.text,
    });
    return params.stored === candidate;
  }
  if (
    params.stored.startsWith("plain_text:") ||
    params.stored.startsWith("secret_text:")
  ) {
    const legacy = `${params.type}:${await sha256Hex(params.text)}`;
    return params.stored === legacy;
  }
  return false;
}

// --- Policy constants & helpers (merged from policy.ts) ---

export const MANAGED_COMMON_ENV_KEYS = new Set([
  "APP_BASE_URL",
  "TAKOS_API_URL",
  "TAKOS_ACCESS_TOKEN",
]);
export const RESERVED_SPACE_COMMON_ENV_KEYS = new Set([
  "TAKOS_API_URL",
  "TAKOS_ACCESS_TOKEN",
]);

export function normalizeCommonEnvName(name: string): string | null {
  try {
    return normalizeEnvName(name);
  } catch {
    return null;
  }
}

export function isManagedCommonEnvKey(name: string): boolean {
  const normalized = normalizeCommonEnvName(name);
  return Boolean(normalized && MANAGED_COMMON_ENV_KEYS.has(normalized));
}

export function isReservedSpaceCommonEnvKey(name: string): boolean {
  const normalized = normalizeCommonEnvName(name);
  return Boolean(normalized && RESERVED_SPACE_COMMON_ENV_KEYS.has(normalized));
}
