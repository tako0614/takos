import type { CodeChallengeMethod } from '../../../shared/types/oauth';
import { constantTimeEqual } from '../../../shared/utils/hash';
import { base64UrlEncode } from '../../../shared/utils';

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function generateCodeChallenge(
  verifier: string,
  method: CodeChallengeMethod = 'S256'
): Promise<string> {
  if (method !== 'S256') {
    throw new Error('Unsupported PKCE code challenge method');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: CodeChallengeMethod = 'S256'
): Promise<boolean> {
  const computedChallenge = await generateCodeChallenge(codeVerifier, method);
  return constantTimeEqual(computedChallenge, codeChallenge);
}

export function isValidCodeVerifier(verifier: string): boolean {
  if (verifier.length < 43 || verifier.length > 128) {
    return false;
  }
  return /^[A-Za-z0-9\-._~]+$/.test(verifier);
}

export function isValidCodeChallenge(challenge: string): boolean {
  if (challenge.length !== 43) {
    return false;
  }
  return /^[A-Za-z0-9\-_]+$/.test(challenge);
}

export { base64UrlEncode, base64UrlDecode } from '../../../shared/utils';

export function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
