import { logWarn } from "./logger.ts";

export async function gzipCompressString(data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const stream = new Blob([encoder.encode(data)]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  const reader = compressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

/** Default maximum decompressed size (50 MiB) to prevent zip-bomb attacks. */
const DEFAULT_MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

export async function gzipDecompressToString(
  data: ArrayBuffer,
  options: { maxDecompressedBytes?: number } = {},
): Promise<string> {
  const maxDecompressedBytes = options.maxDecompressedBytes ??
    DEFAULT_MAX_DECOMPRESSED_BYTES;

  const stream = new Blob([data]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  let totalDecompressedSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalDecompressedSize += value.length;
    if (totalDecompressedSize > maxDecompressedBytes) {
      try {
        reader.cancel();
      } catch (err) {
        logWarn(
          "Failed to cancel reader after size limit exceeded (non-critical)",
          {
            module: "gzip",
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      throw new Error(
        `Decompressed content exceeds limit (${
          Math.round(maxDecompressedBytes / 1024 / 1024)
        }MiB)`,
      );
    }

    chunks.push(value);
  }

  const decoder = new TextDecoder();
  const result = new Uint8Array(totalDecompressedSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(result);
}
