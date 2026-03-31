/**
 * HTTP Signature verification for ActivityPub inbox endpoints.
 *
 * Implements draft-cavage-http-signatures verification using the Web Crypto API
 * (compatible with Cloudflare Workers). Fetches the sender's public key via
 * their ActivityPub actor document, reusing `apFetch` for SSRF protection.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
 */

import { apFetch } from '../../application/services/activitypub/remote-store-client.ts';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HttpSignatureResult {
  /** Whether the cryptographic signature is valid. */
  verified: boolean;
  /** The keyId from the Signature header (typically `actorUrl#main-key`). */
  keyId: string;
  /** The actor URL derived from the keyId (everything before `#`). */
  actorUrl: string;
}

interface ParsedSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string; // base64-encoded
}

/* ------------------------------------------------------------------ */
/*  Signature header parsing                                           */
/* ------------------------------------------------------------------ */

/**
 * Parse an HTTP `Signature` header into its constituent fields.
 *
 * Expected format:
 *   keyId="…",algorithm="…",headers="… …",signature="base64…"
 */
function parseSignatureHeader(header: string): ParsedSignature {
  const params: Record<string, string> = {};

  // Match key="value" pairs, handling escaped quotes inside values
  const regex = /(\w+)="([^"]*?)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2];
  }

  const keyId = params.keyId;
  if (!keyId) {
    throw new HttpSignatureError('Signature header missing keyId');
  }

  const signature = params.signature;
  if (!signature) {
    throw new HttpSignatureError('Signature header missing signature value');
  }

  const algorithm = (params.algorithm ?? 'rsa-sha256').toLowerCase();
  const headers = (params.headers ?? 'date').split(/\s+/);

  return { keyId, algorithm, headers, signature };
}

/* ------------------------------------------------------------------ */
/*  Signing string reconstruction                                      */
/* ------------------------------------------------------------------ */

/**
 * Reconstruct the signing string that the sender should have signed.
 *
 * For each header listed in the `headers` parameter:
 *   - `(request-target)` → `method path` (lowercase method)
 *   - `host`             → Host header value
 *   - `date`             → Date header value
 *   - `digest`           → Digest header value
 *   - others             → corresponding header value
 */
function buildSigningString(
  request: Request,
  signedHeaders: string[],
): string {
  const url = new URL(request.url);
  const lines: string[] = [];

  for (const header of signedHeaders) {
    const lower = header.toLowerCase();

    if (lower === '(request-target)') {
      const method = request.method.toLowerCase();
      const target = url.pathname + url.search;
      lines.push(`(request-target): ${method} ${target}`);
    } else {
      const value = request.headers.get(lower);
      if (value === null) {
        throw new HttpSignatureError(`Missing header referenced in signature: ${lower}`);
      }
      lines.push(`${lower}: ${value}`);
    }
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  PEM → CryptoKey conversion (Web Crypto API)                        */
/* ------------------------------------------------------------------ */

/**
 * Import an RSA public key from PEM format into a Web Crypto CryptoKey.
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  // Strip PEM armour and whitespace to get raw base64
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');

  const binaryDer = base64ToArrayBuffer(b64);

  return crypto.subtle.importKey(
    'spki',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['verify'],
  );
}

/* ------------------------------------------------------------------ */
/*  Remote key fetching                                                */
/* ------------------------------------------------------------------ */

/**
 * Fetch the public key PEM from a remote actor's ActivityPub document.
 * Uses `apFetch` which has built-in SSRF protection.
 */
async function fetchActorPublicKey(keyId: string): Promise<{ actorUrl: string; publicKeyPem: string }> {
  // keyId is typically "https://remote.example/ap/stores/alice#main-key"
  // The actor URL is everything before the fragment
  const hashIndex = keyId.indexOf('#');
  const actorUrl = hashIndex >= 0 ? keyId.slice(0, hashIndex) : keyId;

  const response = await apFetch(actorUrl);
  if (!response.ok) {
    throw new HttpSignatureError(`Failed to fetch actor document from ${actorUrl}: HTTP ${response.status}`);
  }

  const actor = await response.json() as Record<string, unknown>;
  const publicKey = actor.publicKey as { id?: string; publicKeyPem?: string } | undefined;

  if (!publicKey?.publicKeyPem) {
    throw new HttpSignatureError('Actor document does not contain a publicKey with publicKeyPem');
  }

  // Verify that the key's id matches the keyId from the signature
  if (publicKey.id && publicKey.id !== keyId) {
    throw new HttpSignatureError(`Key ID mismatch: signature references ${keyId} but actor has ${publicKey.id}`);
  }

  return { actorUrl, publicKeyPem: publicKey.publicKeyPem };
}

/* ------------------------------------------------------------------ */
/*  Base64 helpers                                                     */
/* ------------------------------------------------------------------ */

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/* ------------------------------------------------------------------ */
/*  Error type                                                         */
/* ------------------------------------------------------------------ */

export class HttpSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpSignatureError';
  }
}

/* ------------------------------------------------------------------ */
/*  Main verification function                                         */
/* ------------------------------------------------------------------ */

/**
 * Verify an HTTP Signature on an incoming request.
 *
 * 1. Parse the `Signature` header
 * 2. Fetch the actor's public key from the `keyId` URL (via `apFetch`)
 * 3. Reconstruct the signing string from the specified headers
 * 4. Verify the RSA-SHA256 signature using Web Crypto API
 *
 * @param request - The incoming Request object
 * @returns Verification result with keyId and derived actorUrl
 * @throws {HttpSignatureError} if the signature header is malformed or verification fails structurally
 */
export async function verifyHttpSignature(request: Request): Promise<HttpSignatureResult> {
  const signatureHeader = request.headers.get('signature');
  if (!signatureHeader) {
    throw new HttpSignatureError('No Signature header present');
  }

  // 1. Parse the Signature header
  const parsed = parseSignatureHeader(signatureHeader);

  // 2. Only RSA-SHA256 is supported (by far the most common in ActivityPub)
  if (parsed.algorithm !== 'rsa-sha256' && parsed.algorithm !== 'hs2019') {
    throw new HttpSignatureError(`Unsupported signature algorithm: ${parsed.algorithm}`);
  }

  // 3. Fetch the actor's public key
  const { actorUrl, publicKeyPem } = await fetchActorPublicKey(parsed.keyId);

  // 4. Import the public key
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importPublicKey(publicKeyPem);
  } catch (err) {
    throw new HttpSignatureError(
      `Failed to import public key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 5. Reconstruct the signing string
  const signingString = buildSigningString(request, parsed.headers);

  // 6. Decode the base64 signature
  const signatureBytes = base64ToArrayBuffer(parsed.signature);

  // 7. Encode the signing string as UTF-8
  const signingStringBytes = new TextEncoder().encode(signingString);

  // 8. Verify using Web Crypto API
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    signingStringBytes,
  );

  return {
    verified,
    keyId: parsed.keyId,
    actorUrl,
  };
}
