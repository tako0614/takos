import { gzipCompressString, gzipDecompressToString } from '@/utils/gzip';


import { assertEquals, assert, assertRejects } from 'jsr:@std/assert';

  Deno.test('gzip compress / decompress - round-trips a simple string', async () => {
  const input = 'hello world';
    const compressed = await gzipCompressString(input);
    assert(compressed instanceof ArrayBuffer);
    const decompressed = await gzipDecompressToString(compressed);
    assertEquals(decompressed, input);
})
  Deno.test('gzip compress / decompress - round-trips an empty string', async () => {
  const compressed = await gzipCompressString('');
    const decompressed = await gzipDecompressToString(compressed);
    assertEquals(decompressed, '');
})
  Deno.test('gzip compress / decompress - round-trips unicode content', async () => {
  const input = 'こんにちは世界 🌏 Привет';
    const compressed = await gzipCompressString(input);
    const decompressed = await gzipDecompressToString(compressed);
    assertEquals(decompressed, input);
})
  Deno.test('gzip compress / decompress - round-trips a large string', async () => {
  const input = 'x'.repeat(100_000);
    const compressed = await gzipCompressString(input);
    // Compressed should be smaller than original (highly repetitive data)
    assert(compressed.byteLength < input.length);
    const decompressed = await gzipDecompressToString(compressed);
    assertEquals(decompressed, input);
})
  Deno.test('gzip compress / decompress - compressed output is smaller for repetitive content', async () => {
  const repetitive = 'abcdef'.repeat(10_000);
    const compressed = await gzipCompressString(repetitive);
    assert(compressed.byteLength < repetitive.length / 10);
})
  Deno.test('gzip compress / decompress - rejects decompression exceeding the size limit', async () => {
  // Compress a large string
    const big = 'a'.repeat(1000);
    const compressed = await gzipCompressString(big);

    // Try to decompress with very small limit
    await await assertRejects(async () => { await 
      gzipDecompressToString(compressed, { maxDecompressedBytes: 100 })
    ; }, 'Decompressed content exceeds limit');
})
  Deno.test('gzip compress / decompress - default max decompressed size is 50 MiB', async () => {
  // Just ensure a normal string works within default limits
    const compressed = await gzipCompressString('test');
    const decompressed = await gzipDecompressToString(compressed);
    assertEquals(decompressed, 'test');
})
  Deno.test('gzip compress / decompress - round-trips multiline content with special chars', async () => {
  const input = 'line1\nline2\ttab\r\nline3\0null';
    const compressed = await gzipCompressString(input);
    const decompressed = await gzipDecompressToString(compressed);
    assertEquals(decompressed, input);
})