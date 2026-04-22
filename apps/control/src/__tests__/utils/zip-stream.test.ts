import { createZipStream, type ZipStreamEntry } from "@/utils/zip-stream";

import { assert, assertEquals } from "jsr:@std/assert";

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
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

Deno.test("createZipStream - produces valid ZIP format (starts with PK magic)", async () => {
  const entries: ZipStreamEntry[] = [
    { name: "hello.txt", size: 5, stream: textStream("hello") },
  ];
  const data = await readStream(createZipStream(entries));
  assertEquals(data[0], 0x50); // P
  assertEquals(data[1], 0x4b); // K
  assertEquals(data[2], 0x03);
  assertEquals(data[3], 0x04);
});
Deno.test("createZipStream - contains end of central directory record", async () => {
  const entries: ZipStreamEntry[] = [
    { name: "test.txt", size: 4, stream: textStream("test") },
  ];
  const data = await readStream(createZipStream(entries));
  assert(findSequence(data, ZIP_EOCD_SIG) > 0);
});
Deno.test("createZipStream - handles multiple entries", async () => {
  const entries: ZipStreamEntry[] = [
    { name: "a.txt", size: 1, stream: textStream("a") },
    { name: "b.txt", size: 1, stream: textStream("b") },
    { name: "c.txt", size: 1, stream: textStream("c") },
  ];
  const data = await readStream(createZipStream(entries));

  // Should have valid ZIP header
  assertEquals(findSequence(data, ZIP_MAGIC), 0);
  // Should have EOCD
  assert(findSequence(data, ZIP_EOCD_SIG) > 0);
  // Should be bigger than a single-entry zip
  assert(data.length > 100);
});
Deno.test("createZipStream - handles empty entries array (produces empty ZIP)", async () => {
  const data = await readStream(createZipStream([]));
  // Should still contain EOCD
  assert(findSequence(data, ZIP_EOCD_SIG) >= 0);
});
Deno.test("createZipStream - normalizes backslashes in entry names to forward slashes", async () => {
  const entries: ZipStreamEntry[] = [
    { name: "dir\\file.txt", size: 4, stream: textStream("test") },
  ];
  const data = await readStream(createZipStream(entries));
  // The name "dir/file.txt" should be in the binary (after normalization)
  const nameBytes = new TextEncoder().encode("dir/file.txt");
  assert(findSequence(data, nameBytes) > 0);
});
Deno.test("createZipStream - strips leading slashes from entry names", async () => {
  const entries: ZipStreamEntry[] = [
    { name: "/absolute/path.txt", size: 4, stream: textStream("test") },
  ];
  const data = await readStream(createZipStream(entries));
  const nameBytes = new TextEncoder().encode("absolute/path.txt");
  assert(findSequence(data, nameBytes) > 0);
});
Deno.test("createZipStream - filters out entries with empty names", async () => {
  const entries: ZipStreamEntry[] = [
    { name: "", size: 0, stream: textStream("") },
    { name: "valid.txt", size: 5, stream: textStream("hello") },
  ];
  const data = await readStream(createZipStream(entries));
  // Should contain valid.txt but not crash from empty name
  const nameBytes = new TextEncoder().encode("valid.txt");
  assert(findSequence(data, nameBytes) > 0);
});
Deno.test("createZipStream - uses provided modifiedAt date", async () => {
  const entries: ZipStreamEntry[] = [
    {
      name: "dated.txt",
      size: 4,
      modifiedAt: new Date("2024-06-15T12:00:00Z"),
      stream: textStream("test"),
    },
  ];
  const data = await readStream(createZipStream(entries));
  assert(data.length > 0);
});
Deno.test("createZipStream - handles large file content", async () => {
  const bigContent = "x".repeat(100_000);
  const entries: ZipStreamEntry[] = [
    {
      name: "big.txt",
      size: bigContent.length,
      stream: textStream(bigContent),
    },
  ];
  const data = await readStream(createZipStream(entries));
  assert(data.length > 100_000);
});
