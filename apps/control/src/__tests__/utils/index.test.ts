import {
  base64UrlEncode,
  base64UrlDecode,
} from '@/utils/index';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('base64UrlEncode / base64UrlDecode - round-trips simple data', () => {
  const data = new TextEncoder().encode('hello world');
    const encoded = base64UrlEncode(data);
    const decoded = base64UrlDecode(encoded);
    assertEquals(new TextDecoder().decode(decoded), 'hello world');
})
  Deno.test('base64UrlEncode / base64UrlDecode - produces URL-safe characters (no +, /, =)', () => {
  // Use data that would produce +, / in standard base64
    const data = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const encoded = base64UrlEncode(data);
    assert(!(encoded).includes('+'));
    assert(!(encoded).includes('/'));
    assert(!(encoded).includes('='));
})
  Deno.test('base64UrlEncode / base64UrlDecode - round-trips empty data', () => {
  const encoded = base64UrlEncode(new Uint8Array([]));
    const decoded = base64UrlDecode(encoded);
    assertEquals(decoded.length, 0);
})
  Deno.test('base64UrlEncode / base64UrlDecode - round-trips ArrayBuffer input', () => {
  const data = new TextEncoder().encode('test');
    const encoded = base64UrlEncode(data.buffer as ArrayBuffer);
    const decoded = base64UrlDecode(encoded);
    assertEquals(new TextDecoder().decode(decoded), 'test');
})
  Deno.test('base64UrlEncode / base64UrlDecode - round-trips binary data with all byte values', () => {
  const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const encoded = base64UrlEncode(data);
    const decoded = base64UrlDecode(encoded);
    assertEquals(Array.from(decoded), Array.from(data));
})
  Deno.test('base64UrlEncode / base64UrlDecode - decode handles padding correctly', () => {
  // "a" in base64 is "YQ==" -- base64url should be "YQ"
    const decoded = base64UrlDecode('YQ');
    assertEquals(new TextDecoder().decode(decoded), 'a');
})
  Deno.test('base64UrlEncode / base64UrlDecode - decode handles already-padded input', () => {
  // Some implementations pass padded base64url
    const decoded = base64UrlDecode('YQ==');
    assertEquals(new TextDecoder().decode(decoded), 'a');
})