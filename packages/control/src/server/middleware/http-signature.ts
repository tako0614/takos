/**
 * HTTP Signature verification for ActivityPub inbox endpoints.
 *
 * Implements draft-cavage-http-signatures verification using the Web Crypto API
 * (compatible with Cloudflare Workers). Fetches the sender's public key via
 * their ActivityPub actor document, reusing `apFetch` for SSRF protection.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
 */

import { apFetch } from "../../application/services/activitypub/remote-store-client.ts";

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
    throw new HttpSignatureError("Signature header missing keyId");
  }

  const signature = params.signature;
  if (!signature) {
    throw new HttpSignatureError("Signature header missing signature value");
  }

  const algorithm = (params.algorithm ?? "rsa-sha256").toLowerCase();
  const headers = (params.headers ?? "date").split(/\s+/);

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

    if (lower === "(request-target)") {
      const method = request.method.toLowerCase();
      const target = url.pathname + url.search;
      lines.push(`(request-target): ${method} ${target}`);
    } else {
      const value = request.headers.get(lower);
      if (value === null) {
        throw new HttpSignatureError(
          `Missing header referenced in signature: ${lower}`,
        );
      }
      lines.push(`${lower}: ${value}`);
    }
  }

  return lines.join("\n");
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
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");

  const binaryDer = base64ToArrayBuffer(b64);

  return crypto.subtle.importKey(
    "spki",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["verify"],
  );
}

/* ------------------------------------------------------------------ */
/*  Remote key fetching                                                */
/* ------------------------------------------------------------------ */

// ---------------------------------------------------------------------------
// Actor public-key cache
// ---------------------------------------------------------------------------
//
// Without this cache, every signed inbound request triggers an `apFetch` to
// the sender's actor URL — including replayed signatures that hit the same
// actor, which makes a forged signature flood trivially fan out to N upstream
// fetches against remote servers (Round 11 audit ActivityPub finding #6).
//
// In CF Workers the cache is per-worker-instance memory, so it doesn't survive
// cold-starts and is not shared across regions; this is acceptable for hot-
// actor amortization. For stronger durability across instances, consider
// promoting this to the routing KV.
//
// TTL is 24 hours to match Mastodon's actor cache window. Entries are bounded
// by `ACTOR_CACHE_MAX_ENTRIES` so a malicious flood of distinct keyIds cannot
// blow memory; oldest entries are evicted in insertion order via the Map.

const ACTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const ACTOR_CACHE_MAX_ENTRIES = 512;

type ActorCacheEntry = {
  actorUrl: string;
  publicKeyPem: string;
  expiresAt: number;
};

const actorKeyCache = new Map<string, ActorCacheEntry>();

function getCachedActorKey(keyId: string): ActorCacheEntry | null {
  const cached = actorKeyCache.get(keyId);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    actorKeyCache.delete(keyId);
    return null;
  }
  return cached;
}

function setCachedActorKey(
  keyId: string,
  entry: Omit<ActorCacheEntry, "expiresAt">,
): void {
  if (actorKeyCache.size >= ACTOR_CACHE_MAX_ENTRIES) {
    // Drop the oldest entry (insertion order via Map iterator).
    const oldestKey = actorKeyCache.keys().next().value;
    if (oldestKey !== undefined) {
      actorKeyCache.delete(oldestKey);
    }
  }
  actorKeyCache.set(keyId, {
    ...entry,
    expiresAt: Date.now() + ACTOR_CACHE_TTL_MS,
  });
}

/** Test helper — clear the cache between unit tests so they start clean. */
export function _resetActorKeyCacheForTests(): void {
  actorKeyCache.clear();
}

/**
 * Evict cached public keys for a specific actor URL.
 *
 * Called by the inbox handler when it receives an `Update` activity for a
 * remote actor, so that subsequent signed deliveries from that actor are
 * verified against the fresh key rather than the stale 24h-TTL cache copy
 * (Round 11 audit ActivityPub finding #17).
 *
 * Walks the entire cache because multiple `keyId`s can resolve to the same
 * actor URL (e.g. `#main-key` vs `#secondary-key`).
 */
export function evictActorKeyByActorUrl(actorUrl: string): void {
  for (const [keyId, entry] of actorKeyCache) {
    if (entry.actorUrl === actorUrl) {
      actorKeyCache.delete(keyId);
    }
  }
}

/**
 * Fetch the public key PEM from a remote actor's ActivityPub document.
 * Uses `apFetch` which has built-in SSRF protection. Results are cached for
 * 24 h per `keyId`; cache misses fall through to the network.
 */
async function fetchActorPublicKey(
  keyId: string,
): Promise<{ actorUrl: string; publicKeyPem: string }> {
  const cached = getCachedActorKey(keyId);
  if (cached) {
    return { actorUrl: cached.actorUrl, publicKeyPem: cached.publicKeyPem };
  }

  // keyId is typically "https://remote.example/ap/stores/alice#main-key"
  // The actor URL is everything before the fragment
  const hashIndex = keyId.indexOf("#");
  const actorUrl = hashIndex >= 0 ? keyId.slice(0, hashIndex) : keyId;

  const response = await apFetch(actorUrl);
  if (!response.ok) {
    throw new HttpSignatureError(
      `Failed to fetch actor document from ${actorUrl}: HTTP ${response.status}`,
    );
  }

  const actor = await response.json() as Record<string, unknown>;
  const publicKey = actor.publicKey as
    | { id?: string; publicKeyPem?: string }
    | undefined;

  if (!publicKey?.publicKeyPem) {
    throw new HttpSignatureError(
      "Actor document does not contain a publicKey with publicKeyPem",
    );
  }

  // Verify that the key's id matches the keyId from the signature
  if (publicKey.id && publicKey.id !== keyId) {
    throw new HttpSignatureError(
      `Key ID mismatch: signature references ${keyId} but actor has ${publicKey.id}`,
    );
  }

  setCachedActorKey(keyId, { actorUrl, publicKeyPem: publicKey.publicKeyPem });
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
    this.name = "HttpSignatureError";
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
 * 5. If a `Digest` header is present, recompute SHA-256 over `body` and
 *    compare with the header value so a forged / replayed signature over a
 *    mutated body is rejected (Round 11 audit ActivityPub finding #7).
 *
 * @param request - The incoming Request object. Because Hono consumes the
 *                  body before handing it off, callers MUST pass `body`
 *                  separately — we do NOT read `request.body` here.
 * @param body    - Raw request body bytes. Required if the request carries a
 *                  `Digest` header (i.e. any signed POST in ActivityPub); may
 *                  be omitted only for GET-style flows that don't have one.
 * @returns Verification result with keyId and derived actorUrl
 * @throws {HttpSignatureError} if the signature header is malformed,
 *         verification fails structurally, or the digest does not match.
 */
export async function verifyHttpSignature(
  request: Request,
  body?: Uint8Array,
): Promise<HttpSignatureResult> {
  const signatureHeader = request.headers.get("signature");
  if (!signatureHeader) {
    throw new HttpSignatureError("No Signature header present");
  }

  // 1. Parse the Signature header
  const parsed = parseSignatureHeader(signatureHeader);

  // 2. Only RSA-SHA256 is supported (by far the most common in ActivityPub)
  if (parsed.algorithm !== "rsa-sha256" && parsed.algorithm !== "hs2019") {
    throw new HttpSignatureError(
      `Unsupported signature algorithm: ${parsed.algorithm}`,
    );
  }

  // 3. Fetch the actor's public key
  const { actorUrl, publicKeyPem } = await fetchActorPublicKey(parsed.keyId);

  // 4. Import the public key
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await importPublicKey(publicKeyPem);
  } catch (err) {
    throw new HttpSignatureError(
      `Failed to import public key: ${
        err instanceof Error ? err.message : String(err)
      }`,
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
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signatureBytes,
    signingStringBytes,
  );

  if (!verified) {
    return {
      verified,
      keyId: parsed.keyId,
      actorUrl,
    };
  }

  // 9. Digest binding check.
  //
  // The signing string for an ActivityPub POST includes the `digest` header
  // value, but that only proves the sender _attested_ to that digest — it
  // does NOT prove the body received matches. Without re-hashing the body
  // an attacker could swap the body after capturing a valid signed delivery
  // (digest header still matches the signing string, body does not match
  // the digest). Re-hash and compare on every request that carries a
  // `Digest` header. Missing Digest is accepted (not yet mandatory per our
  // docs/platform/activitypub.md).
  const digestHeader = request.headers.get("digest");
  if (digestHeader) {
    if (!body) {
      throw new HttpSignatureError(
        "Digest header present but body was not provided to the verifier",
      );
    }
    await verifyDigestHeader(digestHeader, body);
  }

  return {
    verified,
    keyId: parsed.keyId,
    actorUrl,
  };
}

/**
 * Parse a `Digest: SHA-256=<base64>` header and confirm that recomputing
 * SHA-256 over the body yields the same base64 value.
 *
 * Only SHA-256 is accepted — other algorithms listed in RFC 3230 are not
 * used in practice in ActivityPub and would require more code paths. A
 * malformed header or mismatched digest is a hard failure.
 */
async function verifyDigestHeader(
  digestHeader: string,
  body: Uint8Array,
): Promise<void> {
  // Digest header MAY list multiple algorithms separated by comma, e.g.
  //   SHA-256=xyz, SHA-512=abc
  // We only check SHA-256. If none of the entries is SHA-256, reject.
  const entries = digestHeader.split(",").map((e) => e.trim());
  const sha256Entry = entries.find((e) => /^sha-256=/i.test(e));
  if (!sha256Entry) {
    throw new HttpSignatureError(
      "Digest header does not contain a SHA-256 value",
    );
  }

  const expectedB64 = sha256Entry.slice("sha-256=".length);
  if (!expectedB64) {
    throw new HttpSignatureError("Digest header SHA-256 value is empty");
  }

  // Copy into a fresh ArrayBuffer so the type system is happy with
  // `SharedArrayBuffer | ArrayBuffer` unions on `body.buffer`.
  const ab = new ArrayBuffer(body.byteLength);
  new Uint8Array(ab).set(body);
  const actualHash = await crypto.subtle.digest("SHA-256", ab);
  const actualB64 = arrayBufferToBase64(actualHash);

  if (actualB64 !== expectedB64) {
    throw new HttpSignatureError(
      "Digest header does not match SHA-256 of body",
    );
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
