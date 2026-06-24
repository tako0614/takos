// Binary-safe base64 helpers for the browser.
//
// `btoa`/`atob` operate on "binary strings" (one char per byte), so raw bytes
// must be funneled through `String.fromCharCode`/`charCodeAt`. These helpers
// chunk the conversion to avoid call-stack overflow on large buffers.

const CHUNK_SIZE = 0x8000;

/** Encode raw bytes to a standard base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Decode a standard base64 string back to raw bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
