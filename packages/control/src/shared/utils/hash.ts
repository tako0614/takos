import { bytesToHex } from './encoding-utils';

export async function computeSHA256(
  content: string | ArrayBuffer | Uint8Array
): Promise<string> {
  let data: Uint8Array;
  if (typeof content === 'string') {
    data = new TextEncoder().encode(content);
  } else if (content instanceof Uint8Array) {
    data = content;
  } else {
    data = new Uint8Array(content);
  }

  const digestInput = new Uint8Array(data.byteLength);
  digestInput.set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', digestInput.buffer.slice(0));
  return bytesToHex(new Uint8Array(hashBuffer));
}

export async function verifyBundleHash(
  content: string | ArrayBuffer,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await computeSHA256(content);
  return constantTimeEqual(actualHash, expectedHash);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}
