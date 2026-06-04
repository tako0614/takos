import { bytesToHex } from "./encoding-utils.ts";

export async function computeSHA256(
  content: string | ArrayBuffer | Uint8Array,
): Promise<string> {
  let data: Uint8Array;
  if (typeof content === "string") {
    data = new TextEncoder().encode(content);
  } else if (content instanceof Uint8Array) {
    data = content;
  } else {
    data = new Uint8Array(content);
  }

  const digestInput = new Uint8Array(data.byteLength);
  digestInput.set(data);
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    digestInput.buffer.slice(0),
  );
  return bytesToHex(new Uint8Array(hashBuffer));
}
