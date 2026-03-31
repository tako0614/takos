import { sha1, hexFromBuffer, hexToBytes, concatBytes } from '@/services/git-smart/core/sha1';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('sha1 - hashes empty blob to known value', async () => {
  // git hash-object -t blob --stdin < /dev/null → e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    const data = new TextEncoder().encode('blob 0\0');
    const hash = await sha1(data);
    assertEquals(hash, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
})

  Deno.test('sha1 - hashes non-empty data deterministically', async () => {
  const data = new TextEncoder().encode('hello');
    const hash1 = await sha1(data);
    const hash2 = await sha1(data);
    assertEquals(hash1, hash2);
    assert(/^[0-9a-f]{40}$/.test(hash1));
})



  Deno.test('hexFromBuffer / hexToBytes roundtrip - converts buffer to hex and back', () => {
  const original = new Uint8Array([0x00, 0xff, 0xab, 0x12, 0x34]);
    const hex = hexFromBuffer(original.buffer as ArrayBuffer);
    assertEquals(hex, '00ffab1234');
    const bytes = hexToBytes(hex);
    assertEquals(bytes, original);
})

  Deno.test('hexFromBuffer / hexToBytes roundtrip - handles a full SHA-1 hex string', () => {
  const hex = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
    const bytes = hexToBytes(hex);
    assertEquals(bytes.length, 20);
    const roundtrip = hexFromBuffer(bytes.buffer as ArrayBuffer);
    assertEquals(roundtrip, hex);
})



  Deno.test('concatBytes - returns empty Uint8Array for 0 arguments', () => {
  const result = concatBytes();
    assertEquals(result, new Uint8Array(0));
    assertEquals(result.length, 0);
})

  Deno.test('concatBytes - returns copy of single array', () => {
  const a = new Uint8Array([1, 2, 3]);
    const result = concatBytes(a);
    assertEquals(result, a);
    // Should be a different instance
    a[0] = 99;
    assertEquals(result[0], 1);
})

  Deno.test('concatBytes - concatenates multiple arrays', () => {
  const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    const result = concatBytes(a, b, c);
    assertEquals(result, new Uint8Array([1, 2, 3, 4, 5, 6]));
})

