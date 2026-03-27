/**
 * MCP Service - Cryptographic Helpers
 *
 * PKCE (Proof Key for Code Exchange) helpers and token encryption/decryption.
 */

import { encrypt, decrypt, type EncryptedData } from '../../../../shared/utils/crypto';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

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
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState(): string {
  return generateRandomToken();
}

// ---------------------------------------------------------------------------
// Encryption helpers (tokens)
// ---------------------------------------------------------------------------

export function saltFor(serverId: string, field: 'access' | 'refresh' | 'verifier'): string {
  return `mcp:token:${field}:${serverId}`;
}

export async function encryptToken(
  token: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  const encrypted = await encrypt(token, masterSecret, salt);
  return JSON.stringify(encrypted);
}

export async function decryptToken(
  encryptedJson: string,
  masterSecret: string,
  salt: string,
): Promise<string> {
  let parsed: EncryptedData;
  try {
    parsed = JSON.parse(encryptedJson) as EncryptedData;
  } catch (err) {
    throw new Error(`Failed to parse encrypted token JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return decrypt(parsed, masterSecret, salt);
}
