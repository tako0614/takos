import { test } from "bun:test";
import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@takos/test/assert";
import { toBuffer } from "../object-store-body.ts";

test("toBuffer converts null to an empty ArrayBuffer", async () => {
  const result = await toBuffer(null);

  assertEquals(result.byteLength, 0);
});

test("toBuffer encodes strings as UTF-8", async () => {
  const result = await toBuffer("こんにちは 🌊");

  assertEquals(
    Array.from(new Uint8Array(result)),
    Array.from(new TextEncoder().encode("こんにちは 🌊")),
  );
});

test("toBuffer preserves an ArrayBuffer by reference", async () => {
  const source = new Uint8Array([1, 2, 3]).buffer;

  const result = await toBuffer(source);

  assertStrictEquals(result, source);
});

test("toBuffer slices an ArrayBufferView to its exact byte range", async () => {
  const source = new Uint8Array([0, 1, 2, 3, 4]).buffer;
  const view = new Uint8Array(source, 1, 3);

  const result = await toBuffer(view);

  assertNotStrictEquals(result, source);
  assertEquals(Array.from(new Uint8Array(result)), [1, 2, 3]);
});

test("toBuffer reads Blob bytes", async () => {
  const result = await toBuffer(new Blob([new Uint8Array([7, 8, 9])]));

  assertEquals(Array.from(new Uint8Array(result)), [7, 8, 9]);
});

test("toBuffer reads all chunks from a ReadableStream", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("first "));
      controller.enqueue(new TextEncoder().encode("second"));
      controller.close();
    },
  });

  const result = await toBuffer(stream);

  assertEquals(new TextDecoder().decode(result), "first second");
});
