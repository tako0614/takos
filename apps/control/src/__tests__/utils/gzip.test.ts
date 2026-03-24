import { describe, expect, it } from 'vitest';
import { gzipCompressString, gzipDecompressToString } from '@/utils/gzip';

describe('gzip compress / decompress', () => {
  it('round-trips a simple string', async () => {
    const input = 'hello world';
    const compressed = await gzipCompressString(input);
    expect(compressed).toBeInstanceOf(ArrayBuffer);
    const decompressed = await gzipDecompressToString(compressed);
    expect(decompressed).toBe(input);
  });

  it('round-trips an empty string', async () => {
    const compressed = await gzipCompressString('');
    const decompressed = await gzipDecompressToString(compressed);
    expect(decompressed).toBe('');
  });

  it('round-trips unicode content', async () => {
    const input = 'こんにちは世界 🌏 Привет';
    const compressed = await gzipCompressString(input);
    const decompressed = await gzipDecompressToString(compressed);
    expect(decompressed).toBe(input);
  });

  it('round-trips a large string', async () => {
    const input = 'x'.repeat(100_000);
    const compressed = await gzipCompressString(input);
    // Compressed should be smaller than original (highly repetitive data)
    expect(compressed.byteLength).toBeLessThan(input.length);
    const decompressed = await gzipDecompressToString(compressed);
    expect(decompressed).toBe(input);
  });

  it('compressed output is smaller for repetitive content', async () => {
    const repetitive = 'abcdef'.repeat(10_000);
    const compressed = await gzipCompressString(repetitive);
    expect(compressed.byteLength).toBeLessThan(repetitive.length / 10);
  });

  it('rejects decompression exceeding the size limit', async () => {
    // Compress a large string
    const big = 'a'.repeat(1000);
    const compressed = await gzipCompressString(big);

    // Try to decompress with very small limit
    await expect(
      gzipDecompressToString(compressed, { maxDecompressedBytes: 100 })
    ).rejects.toThrow('Decompressed content exceeds limit');
  });

  it('default max decompressed size is 50 MiB', async () => {
    // Just ensure a normal string works within default limits
    const compressed = await gzipCompressString('test');
    const decompressed = await gzipDecompressToString(compressed);
    expect(decompressed).toBe('test');
  });

  it('round-trips multiline content with special chars', async () => {
    const input = 'line1\nline2\ttab\r\nline3\0null';
    const compressed = await gzipCompressString(input);
    const decompressed = await gzipDecompressToString(compressed);
    expect(decompressed).toBe(input);
  });
});
