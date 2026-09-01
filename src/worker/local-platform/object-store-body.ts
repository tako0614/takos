export type ObjectStoreBodyInput =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | Blob
  | null;

export async function toBuffer(
  value: ObjectStoreBodyInput,
): Promise<ArrayBuffer> {
  if (value === null) return new ArrayBuffer(0);
  if (typeof value === "string") return new TextEncoder().encode(value).buffer;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  if (value instanceof Blob) return value.arrayBuffer();
  return new Response(value).arrayBuffer();
}
