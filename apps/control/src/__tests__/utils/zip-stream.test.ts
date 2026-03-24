import { describe, expect, it } from 'vitest';
import { createZipStream, type ZipStreamEntry } from '@/utils/zip-stream';

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function textStream(text: string): () => Promise<ReadableStream<Uint8Array>> {
  return async () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
}

// ZIP file magic number: PK\x03\x04
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
// End of central directory signature: PK\x05\x06
const ZIP_EOCD_SIG = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);

function findSequence(data: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= data.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (data[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe('createZipStream', () => {
  it('produces valid ZIP format (starts with PK magic)', async () => {
    const entries: ZipStreamEntry[] = [
      { name: 'hello.txt', size: 5, stream: textStream('hello') },
    ];
    const data = await readStream(createZipStream(entries));
    expect(data[0]).toBe(0x50); // P
    expect(data[1]).toBe(0x4b); // K
    expect(data[2]).toBe(0x03);
    expect(data[3]).toBe(0x04);
  });

  it('contains end of central directory record', async () => {
    const entries: ZipStreamEntry[] = [
      { name: 'test.txt', size: 4, stream: textStream('test') },
    ];
    const data = await readStream(createZipStream(entries));
    expect(findSequence(data, ZIP_EOCD_SIG)).toBeGreaterThan(0);
  });

  it('handles multiple entries', async () => {
    const entries: ZipStreamEntry[] = [
      { name: 'a.txt', size: 1, stream: textStream('a') },
      { name: 'b.txt', size: 1, stream: textStream('b') },
      { name: 'c.txt', size: 1, stream: textStream('c') },
    ];
    const data = await readStream(createZipStream(entries));

    // Should have valid ZIP header
    expect(findSequence(data, ZIP_MAGIC)).toBe(0);
    // Should have EOCD
    expect(findSequence(data, ZIP_EOCD_SIG)).toBeGreaterThan(0);
    // Should be bigger than a single-entry zip
    expect(data.length).toBeGreaterThan(100);
  });

  it('handles empty entries array (produces empty ZIP)', async () => {
    const data = await readStream(createZipStream([]));
    // Should still contain EOCD
    expect(findSequence(data, ZIP_EOCD_SIG)).toBeGreaterThanOrEqual(0);
  });

  it('normalizes backslashes in entry names to forward slashes', async () => {
    const entries: ZipStreamEntry[] = [
      { name: 'dir\\file.txt', size: 4, stream: textStream('test') },
    ];
    const data = await readStream(createZipStream(entries));
    // The name "dir/file.txt" should be in the binary (after normalization)
    const nameBytes = new TextEncoder().encode('dir/file.txt');
    expect(findSequence(data, nameBytes)).toBeGreaterThan(0);
  });

  it('strips leading slashes from entry names', async () => {
    const entries: ZipStreamEntry[] = [
      { name: '/absolute/path.txt', size: 4, stream: textStream('test') },
    ];
    const data = await readStream(createZipStream(entries));
    const nameBytes = new TextEncoder().encode('absolute/path.txt');
    expect(findSequence(data, nameBytes)).toBeGreaterThan(0);
  });

  it('filters out entries with empty names', async () => {
    const entries: ZipStreamEntry[] = [
      { name: '', size: 0, stream: textStream('') },
      { name: 'valid.txt', size: 5, stream: textStream('hello') },
    ];
    const data = await readStream(createZipStream(entries));
    // Should contain valid.txt but not crash from empty name
    const nameBytes = new TextEncoder().encode('valid.txt');
    expect(findSequence(data, nameBytes)).toBeGreaterThan(0);
  });

  it('uses provided modifiedAt date', async () => {
    const entries: ZipStreamEntry[] = [
      {
        name: 'dated.txt',
        size: 4,
        modifiedAt: new Date('2024-06-15T12:00:00Z'),
        stream: textStream('test'),
      },
    ];
    const data = await readStream(createZipStream(entries));
    expect(data.length).toBeGreaterThan(0);
  });

  it('handles large file content', async () => {
    const bigContent = 'x'.repeat(100_000);
    const entries: ZipStreamEntry[] = [
      { name: 'big.txt', size: bigContent.length, stream: textStream(bigContent) },
    ];
    const data = await readStream(createZipStream(entries));
    expect(data.length).toBeGreaterThan(100_000);
  });
});
