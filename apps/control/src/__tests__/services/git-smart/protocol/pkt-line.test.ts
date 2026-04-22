import {
  delimPkt,
  encodePktLine,
  encodeSideBandData,
  flushPkt,
  parsePktLines,
  pktLineText,
} from "@/services/git-smart/protocol/pkt-line";

import { assertEquals } from "jsr:@std/assert";

const dec = new TextDecoder();

Deno.test('encodePktLine - encodes "hello\\\\n" with correct length prefix', () => {
  const result = encodePktLine("hello\n");
  const hex = dec.decode(result.subarray(0, 4));
  // "hello\n" = 6 bytes + 4 prefix = 10 = 0x000a
  assertEquals(hex, "000a");
  const payload = dec.decode(result.subarray(4));
  assertEquals(payload, "hello\n");
});

Deno.test("encodePktLine - encodes Uint8Array payload", () => {
  const data = new Uint8Array([1, 2, 3]);
  const result = encodePktLine(data);
  const hex = dec.decode(result.subarray(0, 4));
  // 3 bytes + 4 prefix = 7 = 0x0007
  assertEquals(hex, "0007");
  assertEquals(result.subarray(4), data);
});

Deno.test('flushPkt / delimPkt - flushPkt is "0000"', () => {
  const result = flushPkt();
  assertEquals(dec.decode(result), "0000");
  assertEquals(result.length, 4);
});

Deno.test('flushPkt / delimPkt - delimPkt is "0001"', () => {
  const result = delimPkt();
  assertEquals(dec.decode(result), "0001");
  assertEquals(result.length, 4);
});

Deno.test("parsePktLines - parses multiple data lines + flush", () => {
  const line1 = encodePktLine("line 1\n");
  const line2 = encodePktLine("line 2\n");
  const flush = flushPkt();
  const input = new Uint8Array([...line1, ...line2, ...flush]);
  const lines = parsePktLines(input);

  assertEquals(lines.length, 3);
  assertEquals(lines[0].type, "data");
  assertEquals(lines[1].type, "data");
  assertEquals(lines[2].type, "flush");
});

Deno.test("parsePktLines - parses delim packet", () => {
  const delim = delimPkt();
  const lines = parsePktLines(delim);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].type, "delim");
});

Deno.test("parsePktLines - handles empty input", () => {
  const lines = parsePktLines(new Uint8Array(0));
  assertEquals(lines.length, 0);
});

Deno.test("pktLineText - strips trailing newline", () => {
  const line = encodePktLine("hello\n");
  const parsed = parsePktLines(line);
  assertEquals(pktLineText(parsed[0]), "hello");
});

Deno.test("pktLineText - returns text without newline as-is", () => {
  const line = encodePktLine("hello");
  const parsed = parsePktLines(line);
  assertEquals(pktLineText(parsed[0]), "hello");
});

Deno.test("pktLineText - returns empty string for flush packet", () => {
  assertEquals(pktLineText({ type: "flush" }), "");
});

Deno.test("encodeSideBandData - prefixes channel byte to payload", () => {
  const data = new Uint8Array([0xAA, 0xBB]);
  const result = encodeSideBandData(1, data);
  const parsed = parsePktLines(result);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].type, "data");
  // First byte of data should be channel
  assertEquals(parsed[0].data![0], 1);
  // Remaining bytes are the payload
  assertEquals(parsed[0].data!.subarray(1), data);
});

Deno.test("encodeSideBandData - uses channel 2 for progress", () => {
  const data = new Uint8Array([0x01]);
  const result = encodeSideBandData(2, data);
  const parsed = parsePktLines(result);
  assertEquals(parsed[0].data![0], 2);
});

Deno.test("encode → parse → text roundtrip - roundtrips a message", () => {
  const original = "want abcdef1234567890abcdef1234567890abcdef12\n";
  const encoded = encodePktLine(original);
  const parsed = parsePktLines(encoded);
  assertEquals(parsed.length, 1);
  assertEquals(pktLineText(parsed[0]), original.replace(/\n$/, ""));
});
