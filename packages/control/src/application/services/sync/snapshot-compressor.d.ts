/**
 * Handles gzip compression/decompression with decompression bomb protection.
 */
export declare class SnapshotCompressor {
    private maxDecompressedSize;
    private compressionRatioLimit;
    constructor(maxDecompressedSize?: number, compressionRatioLimit?: number);
    compress(data: string): Promise<ArrayBuffer>;
    decompress(data: ArrayBuffer): Promise<string>;
}
//# sourceMappingURL=snapshot-compressor.d.ts.map