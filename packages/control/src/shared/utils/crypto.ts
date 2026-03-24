export interface EncryptedData {
  ciphertext: string;
  iv: string;
  alg: 'AES-256-GCM';
  v: 1;
}

async function deriveKey(masterSecret: string, salt: string): Promise<CryptoKey> {
  const secretBytesRaw = masterSecret.startsWith('0x')
    ? hexToBytes(masterSecret.slice(2))
    : masterSecret.length === 64
      ? hexToBytes(masterSecret)
      : new TextEncoder().encode(masterSecret);

  const secretBytes = new Uint8Array(secretBytesRaw).buffer as ArrayBuffer;

  const saltBytes = new TextEncoder().encode(salt);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(
  plaintext: string,
  masterSecret: string,
  salt: string
): Promise<EncryptedData> {
  const key = await deriveKey(masterSecret, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    alg: 'AES-256-GCM',
    v: 1,
  };
}

export async function decrypt(
  encrypted: EncryptedData,
  masterSecret: string,
  salt: string
): Promise<string> {
  if (encrypted.alg !== 'AES-256-GCM' || encrypted.v !== 1) {
    throw new Error(`Unsupported encryption format: ${encrypted.alg} v${encrypted.v}`);
  }

  const key = await deriveKey(masterSecret, salt);
  const ivRaw = base64ToBytes(encrypted.iv);
  const ciphertextRaw = base64ToBytes(encrypted.ciphertext);
  const iv = new Uint8Array(ivRaw).buffer as ArrayBuffer;
  const ciphertext = new Uint8Array(ciphertextRaw).buffer as ArrayBuffer;

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintextBytes);
}

export async function encryptEnvVars(
  envVars: Record<string, string>,
  masterSecret: string,
  salt: string
): Promise<string> {
  const plaintext = JSON.stringify(envVars);
  const encrypted = await encrypt(plaintext, masterSecret, salt);
  return JSON.stringify(encrypted);
}

export async function decryptEnvVars(
  encryptedJson: string,
  masterSecret: string,
  salt: string
): Promise<Record<string, string>> {
  let encrypted: EncryptedData;
  try {
    const raw = JSON.parse(encryptedJson);
    if (
      typeof raw !== 'object' || raw === null ||
      typeof raw.ciphertext !== 'string' ||
      typeof raw.iv !== 'string' ||
      raw.alg !== 'AES-256-GCM'
    ) {
      throw new Error('decryptEnvVars: encryptedJson does not have expected EncryptedData shape (ciphertext, iv, alg)');
    }
    encrypted = raw as EncryptedData;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('decryptEnvVars: encryptedJson is not valid JSON');
    }
    throw err;
  }
  const plaintext = await decrypt(encrypted, masterSecret, salt);
  let parsed: Record<string, string>;
  try {
    const raw = JSON.parse(plaintext);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('decryptEnvVars: decrypted plaintext is not a valid key-value object');
    }
    parsed = raw as Record<string, string>;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('decryptEnvVars: decrypted plaintext is not valid JSON');
    }
    throw err;
  }
  return parsed;
}

function maskValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 2)}${'*'.repeat(4)}${value.slice(-2)}`;
}

export function maskEnvVars(envVars: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(envVars)) {
    masked[key] = maskValue(value);
  }
  return masked;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

