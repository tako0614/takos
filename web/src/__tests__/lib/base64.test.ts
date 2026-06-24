import { base64ToBytes, bytesToBase64 } from "../../lib/base64.ts";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";

test("base64 - round-trips arbitrary binary bytes (R2 upload/download path)", () => {
  // PNG magic + bytes that are invalid UTF-8 (0xff 0xfe) — the case that the
  // old `file.text()` upload path silently corrupted.
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01,
  ]);
  assertEquals(base64ToBytes(bytesToBase64(png)), png);
});

test("base64 - round-trips multibyte UTF-8 text bytes", () => {
  const bytes = new TextEncoder().encode("héllo 日本語 🚀\n");
  assertEquals(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test("base64 - round-trips an empty buffer", () => {
  const empty = new Uint8Array([]);
  assertEquals(bytesToBase64(empty), "");
  assertEquals(base64ToBytes(""), empty);
});

test("base64 - handles a large buffer without call-stack overflow", () => {
  // Exceeds the 0x8000 chunk boundary to exercise the chunked encoder.
  const big = new Uint8Array(0x20001);
  for (let i = 0; i < big.length; i++) big[i] = i % 256;
  assertEquals(base64ToBytes(bytesToBase64(big)), big);
});
