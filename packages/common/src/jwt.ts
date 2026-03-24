/**
 * JWT utilities for service-to-service authentication
 * Uses RS256 (RSA with SHA-256) for asymmetric signing
 */

import * as crypto from 'crypto';

/**
 * Service token JWT payload structure
 */
export interface ServiceTokenPayload {
  iss: string;  // issuer service name
  sub: string;  // subject (service or user id)
  aud: string;  // audience (target service)
  exp: number;  // expiration timestamp
  iat: number;  // issued at
  jti: string;  // unique token ID
}

/**
 * Extended payload with optional custom claims
 */
export interface ServiceTokenPayloadWithClaims extends ServiceTokenPayload {
  [key: string]: unknown;
}

/**
 * Options for verifying a service token
 */
export interface VerifyServiceTokenOptions {
  /** JWT token string */
  token: string;
  /** Public key in PEM format (used as default/fallback) */
  publicKey: string;
  /** Additional public keys for rotation, keyed by kid (optional) */
  publicKeys?: Record<string, string>;
  /** Expected audience (required) */
  expectedAudience: string;
  /** Expected issuer (required) */
  expectedIssuer: string;
  /** Clock tolerance in seconds for exp/iat checks (default: 30) */
  clockToleranceSeconds?: number;
}

/**
 * Result of token verification
 */
export interface VerifyServiceTokenResult {
  valid: boolean;
  payload?: ServiceTokenPayloadWithClaims;
  error?: string;
}

// Base64URL encoding/decoding utilities
function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): Buffer {
  // Add padding back
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  padded += '='.repeat(padding);
  const buf = Buffer.from(padded, 'base64');
  if (buf.length === 0 && str.length > 0) {
    throw new Error('Invalid base64url encoding');
  }
  return buf;
}

/**
 * Generate a unique JWT ID (jti)
 */
function generateJTI(): string {
  const bytes = crypto.randomBytes(16);
  return base64UrlEncode(bytes);
}

/**
 * Verify a service token using RS256 algorithm
 *
 * @param options - Verification options including token and public key
 * @returns Verification result with payload if valid
 */
export function verifyServiceToken(options: VerifyServiceTokenOptions): VerifyServiceTokenResult {
  const {
    token,
    publicKey,
    publicKeys = {},
    expectedAudience,
    expectedIssuer,
    clockToleranceSeconds = 30,
  } = options;

  try {
    // Split token
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    // Decode header
    let header: { alg?: string; typ?: string; kid?: string };
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf-8'));
    } catch {
      return { valid: false, error: 'Invalid header encoding' };
    }

    // Verify algorithm
    if (header.alg !== 'RS256') {
      return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
    }

    // Resolve which public key(s) to try based on kid.
    // When kid is present, use only the matching key (strict rotation).
    // When kid is absent, use only the default public key (latest/current key)
    // to prevent accepting tokens signed with any older rotation key.
    const keysToTry: string[] = [];
    if (header.kid) {
      if (publicKeys[header.kid]) {
        // Token has a kid and we have a matching key - use it exclusively
        keysToTry.push(publicKeys[header.kid]);
      } else {
        // kid is present but unknown - reject immediately
        return { valid: false, error: `Unknown key ID: ${header.kid}` };
      }
    } else {
      // No kid: only try the default (latest) public key
      keysToTry.push(publicKey);
    }

    // Try each key for signature verification
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = base64UrlDecode(encodedSignature);

    let isValidSignature = false;
    for (const key of keysToTry) {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(signingInput);
      verify.end();

      if (verify.verify(key, signature)) {
        isValidSignature = true;
        break;
      }
    }

    if (!isValidSignature) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Decode payload
    let payload: ServiceTokenPayloadWithClaims;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf-8'));
    } catch {
      return { valid: false, error: 'Invalid payload encoding' };
    }

    // Required verification config
    if (!expectedAudience || !expectedIssuer) {
      return { valid: false, error: 'expectedAudience and expectedIssuer are required' };
    }

    // Required claims
    if (typeof payload.iss !== 'string' || payload.iss.length === 0) {
      return { valid: false, error: 'Missing or invalid iss claim' };
    }
    if (typeof payload.aud !== 'string' || payload.aud.length === 0) {
      return { valid: false, error: 'Missing or invalid aud claim' };
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return { valid: false, error: 'Missing or invalid sub claim' };
    }
    if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
      return { valid: false, error: 'Missing or invalid jti claim' };
    }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { valid: false, error: 'Missing or invalid exp claim' };
    }
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
      return { valid: false, error: 'Missing or invalid iat claim' };
    }

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp + clockToleranceSeconds < now) {
      return { valid: false, error: 'Token has expired' };
    }

    // Verify not-before (iat - tolerance)
    if (payload.iat - clockToleranceSeconds > now) {
      return { valid: false, error: 'Token issued in the future' };
    }

    // Verify audience
    if (payload.aud !== expectedAudience) {
      return { valid: false, error: `Invalid audience: expected ${expectedAudience}, got ${payload.aud}` };
    }

    // Verify issuer
    if (payload.iss !== expectedIssuer) {
      return { valid: false, error: `Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}` };
    }

    return { valid: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: `Verification failed: ${message}` };
  }
}
