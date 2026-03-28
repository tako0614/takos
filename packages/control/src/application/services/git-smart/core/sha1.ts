/**
 * SHA-1 hashing using Web Crypto API (crypto.subtle).
 * Used for standard git object ID computation.
 */

import {
  bytesToHex,
  hexToBytes,
} from '../../../../shared/utils/encoding-utils';

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function sha1(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', toBufferSource(data));
  return hexFromBuffer(hashBuffer);
}

export function sha1Bytes(data: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-1', toBufferSource(data));
}

export function hexFromBuffer(buffer: ArrayBuffer): string {
  return bytesToHex(new Uint8Array(buffer));
}

export { hexToBytes };

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
