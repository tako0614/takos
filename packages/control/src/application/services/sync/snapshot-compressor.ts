/** Concatenate an array of Uint8Array chunks into a single Uint8Array. */
function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

const MAX_DECOMPRESSED_SIZE = 512 * 1024 * 1024; // 512MB
const COMPRESSION_RATIO_LIMIT = 100; // 100:1 ratio limit

/**
 * Handles gzip compression/decompression with decompression bomb protection.
 */
export class SnapshotCompressor {
    constructor(
        private maxDecompressedSize: number = MAX_DECOMPRESSED_SIZE,
        private compressionRatioLimit: number = COMPRESSION_RATIO_LIMIT,
    ) {}

    async compress(data: string): Promise<ArrayBuffer> {
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
        return concatChunks(chunks, totalLength).buffer as ArrayBuffer;
    }

    async decompress(data: ArrayBuffer): Promise<string> {
        const stream = new Blob([data]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const reader = decompressedStream.getReader();
        const chunks: Uint8Array[] = [];
        let totalDecompressedSize = 0;
        const compressedSize = data.byteLength;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                totalDecompressedSize += value.length;

                if (totalDecompressedSize > this.maxDecompressedSize) {
                    reader.cancel();
                    throw new Error(`Decompression bomb detected: decompressed size exceeds ${this.maxDecompressedSize / 1024 / 1024}MB limit`);
                }

                const currentRatio = totalDecompressedSize / compressedSize;
                if (currentRatio > this.compressionRatioLimit && compressedSize > 1024) {
                    reader.cancel();
                    throw new Error(`Decompression bomb detected: compression ratio ${currentRatio.toFixed(0)}:1 exceeds limit of ${this.compressionRatioLimit}:1`);
                }

                chunks.push(value);
            }
        } catch (error) {
            try { reader.releaseLock(); } catch (err) { console.warn('[snapshot-compressor] failed to release reader lock (non-critical)', err); }
            throw error;
        }

        const decoder = new TextDecoder();
        return decoder.decode(concatChunks(chunks, totalDecompressedSize));
    }
}
