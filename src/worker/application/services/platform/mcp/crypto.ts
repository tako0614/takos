/**
 * MCP Service - Cryptographic Helpers
 *
 * PKCE (Proof Key for Code Exchange) helpers and token encryption/decryption.
 */

import {
  decryptEnvelope,
  encryptEnvelope,
} from "../../../../shared/utils/crypto.ts";
import { base64UrlEncode } from "../../../../shared/utils/encoding-utils.ts";

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateRandomToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return base64UrlEncode(raw);
}

export function generateCodeVerifier(): string {
  return generateRandomToken();
}

export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState(): string {
  return generateRandomToken();
}

// ---------------------------------------------------------------------------
// Encryption helpers (tokens)
// ---------------------------------------------------------------------------

export function saltFor(
  serverId: string,
  field: "access" | "refresh" | "verifier",
): string {
  return `mcp:token:${field}:${serverId}`;
}

export function encryptToken(
  token: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  return encryptEnvelope(token, masterSecret, salt);
}

export function decryptToken(
  encryptedJson: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  // Validates the EncryptedData shape before decrypting (was a bare cast).
  return decryptEnvelope(encryptedJson, masterSecret, salt);
}
