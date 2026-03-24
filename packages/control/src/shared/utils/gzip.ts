export async function gzipCompressString(data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const stream = new Blob([encoder.encode(data)]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
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

export async function gzipDecompressToString(
  data: ArrayBuffer,
  options: { maxDecompressedBytes?: number } = {}
): Promise<string> {
  const maxDecompressedBytes = options.maxDecompressedBytes ?? 50 * 1024 * 1024; // 50 MiB

  const stream = new Blob([data]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  let totalDecompressedSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalDecompressedSize += value.length;
    if (totalDecompressedSize > maxDecompressedBytes) {
      try { reader.cancel(); } catch { /* ignore */ }
      throw new Error(
        `Decompressed content exceeds limit (${Math.round(maxDecompressedBytes / 1024 / 1024)}MiB)`
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

